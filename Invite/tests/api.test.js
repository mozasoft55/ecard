import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeddingBySlug, submitRsvp } from '../api.js';

test('fetchWeddingBySlug returns wedding data and a normalized event list', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async url => {
    assert.equal(new URL(url).searchParams.get('slug'), 'demo');
    return Response.json({ success: true, wedding: { bride_name: 'Ayesha' }, events: { malformed: true } });
  };

  const result = await fetchWeddingBySlug(' demo ');
  assert.equal(result.wedding.bride_name, 'Ayesha');
  assert.deepEqual(result.events, []);
});

test('fetchWeddingBySlug normalizes dates and rejects unsafe map and theme values', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({
    success: true,
    wedding: {
      date: '27-Oct-2026',
      time: '7 PM',
      map_url: 'javascript:alert(1)',
      theme_colors: { primary: '#123456', accent: 'red; } body { display:none' }
    },
    events: [
      { event_name: 'Nikah', event_date: '2026-02-30', event_time: '99:99' },
      null
    ]
  });

  const result = await fetchWeddingBySlug('demo');
  assert.equal(result.wedding.date, '2026-10-27');
  assert.equal(result.wedding.time, '7:00 PM');
  assert.equal(result.wedding.map_url, '');
  assert.deepEqual(result.wedding.theme_colors, { primary: '#123456' });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event_date, '');
  assert.equal(result.events[0].event_time, '');
});

test('fetchWeddingBySlug rejects missing and unknown weddings', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requested = false;
  globalThis.fetch = async () => {
    requested = true;
    return Response.json({ success: false, error: 'Wedding record not found' });
  };

  await assert.rejects(fetchWeddingBySlug('  '), /wedding link is required/i);
  assert.equal(requested, false);
  await assert.rejects(fetchWeddingBySlug('unknown'), /Wedding record not found/);
});

test('submitRsvp sends validated form data and returns the API result', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.match(options.headers['Content-Type'], /^application\/x-www-form-urlencoded/);
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('action'), 'rsvp');
    assert.equal(body.get('guest_name'), 'Nadia Rahman');
    assert.equal(body.get('attendees'), '2');
    return Response.json({ success: true, message: 'Saved' });
  };

  const result = await submitRsvp({
    slug: 'demo',
    guestName: ' Nadia Rahman ',
    response: 'attending',
    attendees: 2,
    invitationId: '1234567890abcdef',
    capacity: 2
  });
  assert.equal(result.message, 'Saved');
});

test('submitRsvp rejects invalid attendee counts before making a request', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requested = false;
  globalThis.fetch = async () => { requested = true; };

  await assert.rejects(submitRsvp({
    slug: 'demo', guestName: 'Nadia', response: 'attending',
    attendees: 3, capacity: 2
  }), /between 1 and 2/);
  assert.equal(requested, false);
});

test('submitRsvp reports server-declared failures', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ success: false, error: 'Guest count exceeds limit.' });

  await assert.rejects(submitRsvp({
    slug: 'demo', guestName: 'Nadia', response: 'declining',
    attendees: 0, capacity: 2
  }), /Guest count exceeds limit/);
});
