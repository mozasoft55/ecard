const API_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzVWoKa7p1IuP5w0CzQeAZmt0A8XHezxL4OkAygELlu8UWsODC1mbg1yp3KimIB4Do/exec';
const REQUEST_TIMEOUT_MS = 15000;

function cleanText(value, maxLength) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, maxLength);
}

function isValidIsoDate(value) {
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return false;
  const date = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return date.getFullYear() === Number(parts[1])
    && date.getMonth() === Number(parts[2]) - 1
    && date.getDate() === Number(parts[3]);
}

function normalizeDate(value) {
  const raw = cleanText(value, 40);
  if (isValidIsoDate(raw)) return raw;
  const namedMonth = raw.match(/^(\d{1,2})[\s/-]+([A-Za-z]{3,9})[\s/-]+(\d{4})$/);
  const numeric = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  let iso = '';
  if (namedMonth) {
    const month = new Date(`${namedMonth[2]} 1, 2000`).getMonth();
    if (!Number.isNaN(month)) {
      iso = `${namedMonth[3]}-${String(month + 1).padStart(2, '0')}-${namedMonth[1].padStart(2, '0')}`;
    }
  } else if (numeric) {
    iso = `${numeric[3]}-${numeric[2].padStart(2, '0')}-${numeric[1].padStart(2, '0')}`;
  } else {
    const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]/);
    if (isoDate) iso = `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  }
  return isValidIsoDate(iso) ? iso : '';
}

function normalizeTime(value) {
  const raw = cleanText(value, 40);
  const twelveHour = raw.match(/^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([AP]M)$/i);
  if (twelveHour) return `${Number(twelveHour[1])}:${twelveHour[2] || '00'} ${twelveHour[3].toUpperCase()}`;
  const twentyFourHour = raw.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHour) return raw;
  return '';
}

function normalizeHttpUrl(value) {
  const raw = cleanText(value, 2000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeWeddingRecord(wedding) {
  const cleanColor = value => /^#[\da-f]{6}$/i.test(String(value || '')) ? String(value) : undefined;
  const colors = wedding.theme_colors && typeof wedding.theme_colors === 'object'
    ? Object.fromEntries(Object.entries(wedding.theme_colors).map(([key, value]) => [key, cleanColor(value)]).filter(([, value]) => value))
    : undefined;
  return {
    ...wedding,
    bride_name: cleanText(wedding.bride_name, 100),
    groom_name: cleanText(wedding.groom_name, 100),
    bride_full: cleanText(wedding.bride_full, 140),
    groom_full: cleanText(wedding.groom_full, 140),
    date: normalizeDate(wedding.date),
    time: normalizeTime(wedding.time),
    venue: cleanText(wedding.venue, 180),
    address: cleanText(wedding.address, 500),
    map_url: normalizeHttpUrl(wedding.map_url),
    rsvp_contacts: cleanText(wedding.rsvp_contacts, 1200),
    rsvp_number: cleanText(wedding.rsvp_number, 40).replace(/[^\d+]/g, ''),
    theme_colors: colors,
    message: cleanText(wedding.message, 1200),
    share_message: cleanText(wedding.share_message, 1200),
    template_id: cleanText(wedding.template_id, 30),
    theme: cleanText(wedding.theme, 40)
  };
}

export async function fetchWeddingBySlug(slug) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug || normalizedSlug.length > 120) {
    throw new Error('A wedding link is required.');
  }

  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'wedding');
  url.searchParams.set('slug', normalizedSlug);
  url.searchParams.set('_', String(Date.now()));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Wedding service returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    if (!data || data.success !== true || !data.wedding || typeof data.wedding !== 'object') {
      throw new Error(data?.error || 'Wedding record not found.');
    }

    return {
      ...data,
      wedding: normalizeWeddingRecord(data.wedding),
      events: Array.isArray(data.events) ? data.events
        .filter(event => event && typeof event === 'object' && !Array.isArray(event))
        .map(event => ({
          ...event,
          event_name: cleanText(event.event_name, 100),
          event_date: normalizeDate(event.event_date),
          event_time: normalizeTime(event.event_time),
          note: cleanText(event.note, 300)
        }))
        : []
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The wedding service took too long to respond. Please try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitRsvp({ slug, guestName, response, attendees, invitationId, capacity }) {
  const normalizedSlug = String(slug || '').trim();
  const normalizedName = String(guestName || '').trim();
  const normalizedResponse = String(response || '').trim().toLowerCase();
  const count = Number(attendees);
  const maxGuests = Number(capacity);

  if (!normalizedSlug) throw new Error('A wedding link is required to send your RSVP.');
  if (!normalizedName || normalizedName.length > 100) throw new Error('Enter a guest name up to 100 characters.');
  if (!['attending', 'declining'].includes(normalizedResponse)) throw new Error('Choose whether you can attend.');
  if (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 20) throw new Error('This invitation has an invalid guest limit.');
  if (normalizedResponse === 'attending' && (!Number.isInteger(count) || count < 1 || count > maxGuests)) {
    throw new Error(`Guest count must be between 1 and ${maxGuests}.`);
  }

  const url = new URL(API_ENDPOINT);
  const form = new URLSearchParams({
    action: 'rsvp',
    slug: normalizedSlug,
    guest_name: normalizedName,
    response: normalizedResponse,
    attendees: String(normalizedResponse === 'attending' ? count : 0),
    invitation_id: String(invitationId || '').slice(0, 80),
    capacity: String(maxGuests)
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const result = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: form.toString()
    });
    if (!result.ok) {
      if (result.status === 404 || result.status === 405) {
        throw new Error('RSVP is not enabled on the wedding service yet. Deploy the latest Apps Script code and try again.');
      }
      throw new Error(`RSVP service returned HTTP ${result.status}.`);
    }
    let data;
    try {
      data = await result.json();
    } catch {
      throw new Error('RSVP service returned an unreadable response. Deploy the latest Apps Script code and try again.');
    }
    if (!data || data.success !== true) throw new Error(data?.error || 'Your RSVP could not be saved.');
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The RSVP service took too long to respond. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
