function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  const action = p.action || 'wedding';
  
  if (action === 'wedding') {
    const slug = String(p.slug || '').trim().toLowerCase();
    if (!slug) {
      return responseJSON({ success: false, error: 'Wedding slug is required' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const weddingsSheet = ss.getSheetByName('Weddings');
    if (!weddingsSheet) {
      return responseJSON({ success: false, error: 'Required sheet not found: Weddings' });
    }
    const weddings = getSheetData(weddingsSheet);

    const matches = weddings.filter(w => {
      const rowSlug = String(w.slug || w.wedding_slug || w.slug_auto || w.slug__auto_ || '').trim().toLowerCase();
      const rowId = String(w.wedding_id || '').trim().toLowerCase();
      return rowSlug === slug || rowId === slug;
    });

    if (matches.length === 0) {
      return responseJSON({ success: false, error: 'Wedding record not found' });
    }

    if (matches.length > 1) {
      return responseJSON({ success: false, error: 'Wedding identifier is ambiguous' });
    }

    const wedding = matches[0];
    const allEvents = getSheetData(ss.getSheetByName('Events'));
    const weddingId = String(wedding.wedding_id || '').trim().toLowerCase();
    const events = weddingId
      ? allEvents.filter(ev => String(ev.wedding_id || '').trim().toLowerCase() === weddingId)
      : [];
                            
    const allThemes = getSheetData(ss.getSheetByName('Themes'));
    const weddingTheme = String(wedding.theme || '').trim().toLowerCase();
    const theme = allThemes.find(t => String(t.theme || '').trim().toLowerCase() === weddingTheme) || allThemes[0];
    
    return responseJSON({
      success: true,
      wedding: wedding,
      events: events,
      theme: theme
    });
  }

  return responseJSON({ success: false, error: 'Invalid action' });
}

function doPost(e) {
  const p = e && e.parameter ? e.parameter : {};
  if (String(p.action || '').toLowerCase() !== 'rsvp') {
    return responseJSON({ success: false, error: 'Invalid action' });
  }

  const slug = String(p.slug || '').trim().toLowerCase();
  const guestName = String(p.guest_name || '').trim();
  const answer = String(p.response || '').trim().toLowerCase();
  const attendees = Number(p.attendees);
  const capacity = Number(p.capacity);
  const invitationId = String(p.invitation_id || '').trim();

  if (!slug || slug.length > 120) return responseJSON({ success: false, error: 'A valid wedding link is required.' });
  if (!guestName || guestName.length > 100) return responseJSON({ success: false, error: 'Guest name must be between 1 and 100 characters.' });
  if (answer !== 'attending' && answer !== 'declining') return responseJSON({ success: false, error: 'Choose attending or declining.' });
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) {
    return responseJSON({ success: false, error: 'Invitation guest limit is invalid.' });
  }
  if (answer === 'attending' && (!Number.isInteger(attendees) || attendees < 1 || attendees > capacity)) {
    return responseJSON({ success: false, error: 'Guest count exceeds the invitation limit.' });
  }
  if (invitationId && !/^[a-zA-Z0-9_-]{8,80}$/.test(invitationId)) {
    return responseJSON({ success: false, error: 'Invitation identifier is invalid.' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const weddingsSheet = ss.getSheetByName('Weddings');
  if (!weddingsSheet) return responseJSON({ success: false, error: 'Required sheet not found: Weddings' });
  const matches = getSheetData(weddingsSheet).filter(wedding => {
    const rowSlug = String(wedding.slug || wedding.wedding_slug || wedding.slug_auto || wedding.slug__auto_ || '').trim().toLowerCase();
    const rowId = String(wedding.wedding_id || '').trim().toLowerCase();
    return rowSlug === slug || rowId === slug;
  });
  if (matches.length !== 1) return responseJSON({ success: false, error: 'Wedding record was not found or is ambiguous.' });

  const weddingId = String(matches[0].wedding_id || slug).trim();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return responseJSON({ success: false, error: 'The RSVP service is busy. Please try again.' });
  try {
    let responsesSheet = ss.getSheetByName('RSVPs');
    if (!responsesSheet) {
      responsesSheet = ss.insertSheet('RSVPs');
      responsesSheet.appendRow(['submitted_at', 'wedding_id', 'slug', 'invitation_id', 'guest_name', 'response', 'attendees', 'capacity']);
    }
    const headers = ['submitted_at', 'wedding_id', 'slug', 'invitation_id', 'guest_name', 'response', 'attendees', 'capacity'];
    if (responsesSheet.getLastRow() === 0) {
      responsesSheet.appendRow(headers);
    }
    const actualHeaders = responsesSheet.getRange(1, 1, 1, headers.length).getValues()[0]
      .map(value => String(value).trim().toLowerCase());
    if (headers.some((header, index) => actualHeaders[index] !== header)) {
      return responseJSON({ success: false, error: 'RSVPs sheet has unexpected columns; expected the documented RSVP headers.' });
    }

    const uniqueId = invitationId || guestName.toLowerCase();
    const storedUniqueId = /^[=+\-@]/.test(uniqueId) ? `'${uniqueId}` : uniqueId;
    const lastRow = responsesSheet.getLastRow();
    const existing = lastRow > 1 ? responsesSheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];
    const matchingRow = existing.findIndex(row =>
      String(row[1]).trim().toLowerCase() === weddingId.toLowerCase()
      && String(row[3]).trim() === storedUniqueId
    );
    const storedGuestName = /^[=+\-@]/.test(guestName) ? `'${guestName}` : guestName;
    const row = [
      new Date(),
      weddingId,
      slug,
      storedUniqueId,
      storedGuestName,
      answer,
      answer === 'attending' ? attendees : 0,
      capacity
    ];

    if (matchingRow >= 0) {
      responsesSheet.getRange(matchingRow + 2, 1, 1, row.length).setValues([row]);
    } else {
      responsesSheet.appendRow(row);
    }
  } finally {
    lock.releaseLock();
  }

  return responseJSON({ success: true, message: 'Your RSVP has been saved.' });
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return '';

  const utcMs = Date.UTC(1899, 11, 30) + (n * 86400000);
  const dt = new Date(utcMs);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeSheetDate(value) {
  if (value === null || value === undefined) return '';

  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1000) {
      return excelSerialToIso(value);
    }
    return ''; 
  }

  let raw = String(value).trim();
  if (!raw) return '';

  // Excel numeric serial stored as a string (e.g. "45191").
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const num = Number(raw);
    if (Math.abs(num) > 1000) {
      return excelSerialToIso(num);
    }
  }

  // Already normalized ISO date from spreadsheet formula or prior pass.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  // ISO-like datetime string: keep only the YYYY-MM-DD portion, never the UTC offset.
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const year = isoMatch[1];
    const month = String(isoMatch[2]).padStart(2, '0');
    const day = String(isoMatch[3]).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // DD-MMM-YYYY, DD/MM/YYYY, DD-MM-YYYY, DD MMM YYYY, YYYY/MM/DD etc.
  const monthMap = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
  };

  const m = raw.match(/^(\d{1,2})[\s/\-]+([A-Za-z]{3,9})[\s/\-]+(\d{4})$/i)
    || raw.match(/^(\d{4})[\s/\-]+(\d{1,2})[\s/\-]+(\d{1,2})$/)
    || raw.match(/^(\d{1,2})[\s/\-]+(\d{1,2})[\s/\-]+(\d{4})$/);

  if (m) {
    let year, month, day;

    if (m[1].length === 4) {
      year = m[1];
      month = m[2];
      day = m[3];
    } else {
      const first = Number(m[1]);
      const second = String(m[2]).toLowerCase();
      const third = Number(m[3]);

      if (/^[a-z]+$/i.test(second)) {
        year = third;
        month = monthMap[second.slice(0, 3)] || '01';
        day = first;
      } else {
        year = third;
        month = String(first).padStart(2, '0');
        day = String(second).padStart(2, '0');
      }
    }

    const normalizedMonth = String(Number(month)).padStart(2, '0');
    const normalizedDay = String(Number(day)).padStart(2, '0');
    return `${year}-${normalizedMonth}-${normalizedDay}`;
  }

  return raw;
}

function getSheetData(sheet) {
  if (!sheet) return [];

  const range = sheet.getDataRange();
  const rawRange = range.getValues();

  if (rawRange.length < 2) return [];

  const headers = rawRange[0].map(h => {
    const rawHeader = String(h).trim().toLowerCase();
    const isAuto = /\s*\(auto\)\s*$/.test(rawHeader);
    const header = rawHeader.replace(/\s*\(auto\)\s*$/, '')
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    return isAuto ? `${header}_auto` : header;
  });

  return rawRange.slice(1).map(row => {
    const obj = {};

    headers.forEach((h, idx) => {
      let val = row[idx];

      if (typeof val === 'string') {
        val = val.trim();
      }

      const isDateField = /(^|_)date$/.test(h) || h.includes('date') || h.includes('day');
      if (isDateField && val !== '' && val !== null && val !== undefined) {
        val = normalizeSheetDate(val);
      }
      if (h.includes('time') && typeof val === 'number' && Number.isFinite(val)) {
        val = normalizeSheetTime(val);
      }

      obj[h] = val;
    });

    return obj;
  });
}

function normalizeSheetTime(value) {
  const totalMinutes = Math.round((((value % 1) + 1) % 1) * 1440) % 1440;
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = String(totalMinutes % 60).padStart(2, '0');
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minute} ${period}`;
}

function debugDateNormalization() {
  const samples = [
    '27-Oct-2026',
    '24-Oct-2026',
    '2026-10-27',
    45191,
    '45191',
    new Date(2026, 9, 27, 12, 0, 0)
  ];

  Logger.log(JSON.stringify(samples.map(v => ({ input: String(v), normalized: normalizeSheetDate(v) }))));
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
