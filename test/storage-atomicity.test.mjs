import test from "node:test";
import assert from "node:assert/strict";
import { testHooks } from "../app.js";

const baseLead = Object.freeze({
  id: "lead-1", name: "Jane", phone: "5551234567", email: "jane@example.com", location: "Denver",
  referralSource: "Web", condition: "Inquiry", status: "New inquiry", priority: "High", leadType: "New patient",
  nextFollowUp: "", nextAction: "Call", lastContactedAt: "", lastContactMethod: "", bookedAt: "", notes: "Original",
  createdAt: "2026-07-31T12:00:00.000Z", updatedAt: "2026-07-31T12:00:00.000Z", activities: []
});

function installEnvironment(values = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, value: "", textContent: "", disabled: false });
    return elements.get(id);
  };
  for (const [id, value] of Object.entries(values)) Object.assign(element(id), { value });
  globalThis.document = { getElementById: element };
  globalThis.requestAnimationFrame = (callback) => callback();
  globalThis.localStorage = { setItem() { throw new Error("quota exceeded"); } };
  return { element };
}

function fields(overrides = {}) {
  return { name: "Pat", phone: "5559876543", email: "pat@example.com", location: "Boston", referralSource: "Web",
    condition: "Consult", status: "New inquiry", priority: "Medium", leadType: "New patient", nextFollowUp: "",
    nextAction: "Call", lastContactedAt: "", lastContactMethod: "", notes: "Keep this value", ...overrides };
}

function assertOriginalState(original) {
  assert.strictEqual(testHooks.getLeads(), original, "the active array is not replaced when storage throws");
  assert.deepEqual(testHooks.getLeads(), [baseLead]);
}

for (const operation of ["create", "update"]) {
  test(`${operation} retains in-memory state and form values when localStorage throws`, () => {
    const { element } = installEnvironment({ name: "Keep form name", notes: "Keep form notes" });
    const original = [{ ...baseLead }];
    testHooks.setLeads(original);

    testHooks.persistLead({ fields: fields(), existingId: operation === "update" ? baseLead.id : "" });

    assertOriginalState(original);
    assert.equal(element("name").value, "Keep form name");
    assert.equal(element("notes").value, "Keep form notes");
    assert.match(element("form-error").textContent, /entries have been preserved/i);
  });
}

test("mark contacted retains in-memory state and dialog values when localStorage throws", () => {
  const { element } = installEnvironment({
    "contact-lead-id": baseLead.id, "contact-method": "Phone", "contact-date": "2026-07-31T13:00", "contact-note": "Keep note"
  });
  const original = [{ ...baseLead }];
  testHooks.setLeads(original);

  testHooks.handleContactSave({ preventDefault() {} });

  assertOriginalState(original);
  assert.equal(element("contact-note").value, "Keep note");
  assert.match(element("contact-error").textContent, /could not be saved/i);
});

test("delete retains in-memory state when localStorage throws", () => {
  installEnvironment();
  globalThis.confirm = () => true;
  const original = [{ ...baseLead }];
  testHooks.setLeads(original);

  testHooks.deleteLead(baseLead.id);

  assertOriginalState(original);
});

for (const mode of ["replace", "merge"]) {
  test(`${mode} import retains in-memory state when localStorage throws`, async () => {
    installEnvironment();
    const confirmations = mode === "replace" ? [true, true] : [false, true];
    globalThis.confirm = () => confirmations.shift();
    const original = [{ ...baseLead }];
    testHooks.setLeads(original);
    const importedLead = { ...baseLead, id: "lead-2", name: "Imported", phone: "5551112222" };
    const input = { value: "backup.json", files: [{ text: async () => JSON.stringify({ format: "restore-at-home-leads", version: 1, leads: [importedLead] }) }] };

    await testHooks.importJson({ target: input });

    assertOriginalState(original);
    assert.match(globalThis.document.getElementById("app-feedback").textContent, /existing data was not changed/i);
  });
}
