import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLead } from "../app.js";

const validLead = { id: "lead-1", name: "Jane", phone: "5551234567", email: "jane@example.com", location: "Denver", referralSource: "Web", condition: "Inquiry", status: "New inquiry", priority: "High", leadType: "New patient", nextFollowUp: "2026-08-01", nextAction: "Call", lastContactedAt: "", lastContactMethod: "", bookedAt: "", notes: "", createdAt: "2026-07-31T12:00:00.000Z", updatedAt: "2026-07-31T12:00:00.000Z", activities: [] };

test("accepts and normalizes a complete lead backup record", () => {
  assert.equal(normalizeLead(validLead).name, "Jane");
  const legacy = normalizeLead({ ...validLead, id: undefined, updatedAt: undefined });
  assert.ok(legacy.id);
  assert.equal(legacy.updatedAt, legacy.createdAt);
});

test("rejects malformed lead backup records before import", () => {
  assert.throws(() => normalizeLead({ ...validLead, phone: "bad" }), /invalid contact/i);
  assert.throws(() => normalizeLead({ ...validLead, priority: "Urgent" }), /invalid priority/i);
  assert.throws(() => normalizeLead({ ...validLead, status: "Unknown" }), /invalid status/i);
  assert.throws(() => normalizeLead({ ...validLead, activities: [{ type: "Made up" }] }), /invalid activity/i);
});
