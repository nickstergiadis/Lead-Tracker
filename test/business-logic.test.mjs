import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStatus, STATUSES } from "../business/status.mjs";
import { classifyFollowUp, compareFollowUpSoonest, compareMostOverdue, formatRelativeContact } from "../business/follow-up.mjs";
import { calculateMetrics } from "../business/metrics.mjs";
import { leadsMatch, normalizeEmailForMatch, normalizePhoneForMatch, phonesMatch } from "../business/duplicates.mjs";
import { ACTIVITY_TYPES, buildAutomaticActivities } from "../business/activity.mjs";
import { serializeLeadsToCsv } from "../business/csv.mjs";

test("normalizes every known legacy status and safely defaults unknown values", () => {
  assert.equal(normalizeStatus("New"), STATUSES.NEW_INQUIRY);
  assert.equal(normalizeStatus("Follow-up needed"), STATUSES.WAITING_FOR_REPLY);
  assert.equal(normalizeStatus("Not a fit"), STATUSES.LOST);
  assert.equal(normalizeStatus("Contacted"), STATUSES.CONTACTED);
  assert.equal(normalizeStatus("old custom value"), STATUSES.NEW_INQUIRY);
});

test("classifies local calendar boundaries independently of time of day", () => {
  const lateToday = new Date(2026, 6, 30, 23, 59, 59);
  assert.equal(classifyFollowUp("2026-07-29", lateToday).state, "overdue");
  assert.equal(classifyFollowUp("2026-07-30", lateToday).state, "today");
  assert.equal(classifyFollowUp("2026-07-31", lateToday).state, "future");
  assert.equal(classifyFollowUp("2026-02-30", lateToday).state, "none");
});

test("formats last contact relatively using local calendar days", () => {
  const now = new Date(2026, 6, 30, 23, 30);
  assert.equal(formatRelativeContact(new Date(2026, 6, 30, 8), now), "Today");
  assert.equal(formatRelativeContact(new Date(2026, 6, 29, 23, 59), now), "Yesterday");
  assert.equal(formatRelativeContact(new Date(2026, 6, 25, 12), now), "5 days ago");
  assert.equal(formatRelativeContact("not-a-date", now), "Not recorded");
});

test("Follow-up soonest puts upcoming work before overdue work and missing dates", () => {
  const leads = [
    { name: "missing", _followUp: { dayDifference: null } },
    { name: "long overdue", _followUp: { dayDifference: -8 } },
    { name: "future", _followUp: { dayDifference: 3 } },
    { name: "recently overdue", _followUp: { dayDifference: -1 } },
    { name: "today", _followUp: { dayDifference: 0 } }
  ];
  assert.deepEqual(leads.sort(compareFollowUpSoonest).map(({ name }) => name), ["today", "future", "recently overdue", "long overdue", "missing"]);
});

test("Most overdue puts the longest missed follow-up first, then upcoming work", () => {
  const leads = [
    { name: "missing", _followUp: { dayDifference: null } },
    { name: "today", _followUp: { dayDifference: 0 } },
    { name: "recently overdue", _followUp: { dayDifference: -1 } },
    { name: "future", _followUp: { dayDifference: 3 } },
    { name: "long overdue", _followUp: { dayDifference: -8 } }
  ];
  assert.deepEqual(leads.sort(compareMostOverdue).map(({ name }) => name), ["long overdue", "recently overdue", "today", "future", "missing"]);
});

test("returns zero conversion when there are no tracked outcomes", () => {
  const result = calculateMetrics([{ status: "New inquiry", activities: [], _followUp: { state: "future" } }]);
  assert.equal(result.qualifiedCount, 0);
  assert.equal(result.conversionRate, 0);
});

test("uses real booking timestamps and tracked loss history for conversion", () => {
  const result = calculateMetrics([
    { status: "Booked", bookedAt: "2026-07-10T10:00:00Z", activities: [], _followUp: { state: "none" } },
    { status: "Lost", bookedAt: "", activities: [{ type: "Lost", activityAt: "2026-07-11T10:00:00Z" }], _followUp: { state: "none" } },
    { status: "Lost", bookedAt: "", activities: [], _followUp: { state: "none" } }
  ], new Date(2026, 6, 30));
  assert.equal(result.qualifiedCount, 2);
  assert.equal(result.conversionRate, 50);
  assert.equal(result.bookedThisMonth, 1);
});

test("normalizes phone and email values for conservative duplicate matching", () => {
  assert.equal(normalizePhoneForMatch("(416) 555-0199"), "4165550199");
  assert.ok(phonesMatch("+1 416 555 0199", "416-555-0199"));
  assert.equal(phonesMatch("+44 20 7946 0958", "20 7946 0958"), false);
  assert.equal(normalizeEmailForMatch("  PAT@Example.COM "), "pat@example.com");
  assert.ok(leadsMatch({ email: "PAT@example.com" }, { email: " pat@EXAMPLE.com " }));
  assert.equal(leadsMatch({ email: "" }, { email: "" }), false);
});

test("constructs automatic lead, status, and follow-up activities", () => {
  let sequence = 0;
  const options = { now: "2026-07-30T12:00:00.000Z", id: () => `activity-${++sequence}` };
  const created = buildAutomaticActivities(null, { id: "lead-1", status: "New inquiry" }, options);
  assert.equal(created[0].type, ACTIVITY_TYPES.LEAD_CREATED);
  const changed = buildAutomaticActivities(
    { id: "lead-1", status: "Contacted", nextFollowUp: "2026-07-30" },
    { id: "lead-1", status: "Booked", nextFollowUp: "2026-08-01" }, options
  );
  assert.deepEqual(changed.map(({ type }) => type), [ACTIVITY_TYPES.BOOKED, ACTIVITY_TYPES.FOLLOW_UP_CHANGED]);
  assert.equal(changed[1].note, "2026-07-30 → 2026-08-01");
});

test("serializes absent fields, legacy statuses, timestamps, and spreadsheet BOM", () => {
  const csv = serializeLeadsToCsv([{ name: "Legacy lead", status: "New", createdAt: "2026-07-29T08:00:00Z" }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"Legacy lead","","","","","","New inquiry"/);
  assert.ok(csv.includes('"2026-07-29T08:00:00.000Z"'));
});

test("CSV escaping quotes commas and preserves embedded CR/LF", () => {
  const csv = serializeLeadsToCsv([{ name: "Doe, Jane", notes: 'Said "call"\r\ntomorrow' }], { includeBom: false });
  assert.ok(csv.includes('"Doe, Jane"'));
  assert.ok(csv.includes('"Said ""call""\r\ntomorrow"'));
});
