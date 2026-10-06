import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeSheet {
  constructor(rows = []) { this.rows = rows; }
  getDataRange() { return { getValues: () => this.rows }; }
  getLastRow() { return this.rows.length; }
  appendRow(row) { this.rows.push(row); }
  getRange(row, column, rowCount, columnCount) {
    return {
      getValues: () => this.rows.slice(row - 1, row - 1 + rowCount)
        .map(values => values.slice(column - 1, column - 1 + columnCount)),
      setValues: values => values.forEach((value, index) => { this.rows[row - 1 + index] = value; })
    };
  }
}

function loadAppsScript() {
  const weddings = new FakeSheet([['slug', 'wedding_id'], ['demo', 'w1']]);
  const sheets = { Weddings: weddings };
  const spreadsheet = {
    getSheetByName: name => sheets[name] || null,
    insertSheet: name => (sheets[name] = new FakeSheet())
  };
  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    Date,
    String,
    Number,
    Math,
    Logger: { log() {} }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), context);
  return { context, sheets };
}

const request = (overrides = {}) => ({
  parameter: {
    action: 'rsvp',
    slug: 'demo',
    guest_name: 'Ayesha',
    response: 'attending',
    attendees: '2',
    capacity: '2',
    invitation_id: '1234567890abcdef',
    ...overrides
  }
});
const parse = output => JSON.parse(output.text);

test('doPost rejects an RSVP above the invitation capacity', () => {
  const { context, sheets } = loadAppsScript();
  const result = parse(context.doPost(request({ attendees: '3' })));
  assert.equal(result.success, false);
  assert.equal(sheets.RSVPs, undefined);
});

test('doPost saves a response and updates the same invitation instead of duplicating it', () => {
  const { context, sheets } = loadAppsScript();
  assert.equal(parse(context.doPost(request())).success, true);
  assert.equal(sheets.RSVPs.rows.length, 2);
  assert.equal(parse(context.doPost(request({ response: 'declining', attendees: '0' }))).success, true);
  assert.equal(sheets.RSVPs.rows.length, 2);
  assert.equal(sheets.RSVPs.rows[1][5], 'declining');
});

test('doPost rejects unknown weddings and malformed RSVP sheets', () => {
  const missingWedding = loadAppsScript();
  assert.equal(parse(missingWedding.context.doPost(request({ slug: 'missing' }))).success, false);

  const malformedSheet = loadAppsScript();
  malformedSheet.sheets.RSVPs = new FakeSheet([['unrelated', 'headers']]);
  const result = parse(malformedSheet.context.doPost(request()));
  assert.equal(result.success, false);
  assert.match(result.error, /unexpected columns/);
});

test('doPost stores formula-like guest names as plain text', () => {
  const { context, sheets } = loadAppsScript();
  const result = parse(context.doPost(request({ guest_name: '=IMPORTXML("https://example.invalid","//x")' })));
  assert.equal(result.success, true);
  assert.equal(sheets.RSVPs.rows[1][4], '\'=IMPORTXML("https://example.invalid","//x")');
});

test('doGet wedding action remains available', () => {
  const { context } = loadAppsScript();
  const result = parse(context.doGet({ parameter: { action: 'wedding', slug: 'demo' } }));
  assert.equal(result.success, true);
  assert.equal(result.wedding.wedding_id, 'w1');
});
