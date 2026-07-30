const test = require("node:test");
const assert = require("node:assert/strict");
const { serializeLeadsToCsv } = require("../app.js");

test("serializes every cell and safely represents absent legacy fields", () => {
  const csv = serializeLeadsToCsv([{ name: "Legacy lead", status: "New" }], { includeBom: false });
  const [header, record] = csv.split("\n");

  assert.match(header, /^"Name","Phone","Email"/);
  assert.match(header, /"Follow-up date \(YYYY-MM-DD\)"/);
  assert.match(header, /"Created date\/time \(ISO 8601\)"$/);
  assert.equal(record.split(",").length, 16);
  assert.match(record, /^"Legacy lead","","","","","","New inquiry"/);
});

test("quotes commas, doubles quotes, and preserves CR/LF line breaks inside cells", () => {
  const csv = serializeLeadsToCsv([{
    name: "Doe, Jane",
    notes: 'She said "call back"\r\nTomorrow',
    status: "Contacted"
  }], { includeBom: false });

  assert.ok(csv.includes('"Doe, Jane"'));
  assert.ok(csv.includes('"She said ""call back""\r\nTomorrow"'));
});

test("normalizes legacy statuses and formats timestamps as ISO 8601", () => {
  const csv = serializeLeadsToCsv([{
    status: "Follow-up needed",
    nextFollowUp: "2026-08-02",
    lastContactedAt: "2026-07-30T09:15:00Z",
    bookedAt: "2026-07-31T10:00:00Z",
    createdAt: "2026-07-29T08:00:00Z"
  }], { includeBom: false });

  assert.ok(csv.includes('"Waiting for reply"'));
  assert.ok(csv.includes('"2026-08-02"'));
  assert.ok(csv.includes('"2026-07-30T09:15:00.000Z"'));
  assert.ok(csv.includes('"2026-07-31T10:00:00.000Z"'));
  assert.ok(csv.includes('"2026-07-29T08:00:00.000Z"'));
});

test("prefixes spreadsheet exports with a UTF-8 BOM by default", () => {
  assert.ok(serializeLeadsToCsv([]).startsWith("\uFEFF"));
});
