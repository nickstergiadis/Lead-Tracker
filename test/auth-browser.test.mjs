import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const { bindAuthNavigation, handleRecover, handleRegister, showAuthPanel } = await import("../app.js");
const { Event, EventTarget, Response } = globalThis;

class FakeClassList {
  constructor(hidden = false) { this.values = new Set(hidden ? ["hidden"] : []); }
  toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class FakeElement extends EventTarget {
  constructor({ hidden = false, value = "", valid = true } = {}) { super(); this.classList = new FakeClassList(hidden); this.value = value; this.valid = valid; this.textContent = ""; this.dataset = {}; this.attributes = {}; this.checked = false; this.disabled = false; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { globalThis.document.activeElement = this; }
  click() { this.dispatchEvent(new Event("click")); }
  checkValidity() { return this.valid; }
  reportValidity() { this.reported = true; }
  reset() { this.resetCalled = true; }
}

function installAuthDocument() {
  const ids = {};
  for (const id of ["login-view", "register-view", "recover-view", "recovery-code-view"]) ids[id] = new FakeElement({ hidden: id !== "login-view" });
  for (const id of ["login-error", "register-error", "recover-error", "login-username", "register-invitation", "register-username", "register-display-name", "register-password", "register-confirm", "recover-username", "recover-code", "recover-password", "one-time-recovery-code", "recovery-saved", "finish-recovery", "show-register", "show-recover", "register-back", "recover-back"]) ids[id] = new FakeElement();
  ids["register-form"] = new FakeElement(); ids["recover-form"] = new FakeElement();
  globalThis.document = { activeElement: null, getElementById: (id) => ids[id] || null };
  return ids;
}

test("authentication markup exposes stable, typed controls and labelled hidden forms", () => {
  for (const id of ["show-register", "show-recover", "register-back", "recover-back"]) assert.match(html, new RegExp(`<button id="${id}"[^>]*type="button"`));
  for (const [label, input] of [["register-invitation", "register-invitation"], ["register-username", "register-username"], ["register-display-name", "register-display-name"], ["register-password", "register-password"], ["register-confirm", "register-confirm"], ["recover-username", "recover-username"], ["recover-code", "recover-code"], ["recover-password", "recover-password"]]) assert.match(html, new RegExp(`<label for="${label}"`)), input;
  assert.match(html, /id="register-view"[^>]*hidden[^>]*aria-hidden="true"/);
  assert.match(html, /id="recover-view"[^>]*hidden[^>]*aria-hidden="true"/);
});

test("mouse and keyboard activation open each form and Back returns to sign-in", () => {
  const ids = installAuthDocument();
  bindAuthNavigation("show-register", "register-view"); bindAuthNavigation("show-recover", "recover-view"); bindAuthNavigation("register-back", "login-view"); bindAuthNavigation("recover-back", "login-view");
  ids["show-register"].click(); assert.equal(ids["register-view"].classList.contains("hidden"), false); assert.equal(globalThis.document.activeElement, ids["register-invitation"]);
  ids["register-back"].dispatchEvent(new Event("click")); assert.equal(ids["login-view"].classList.contains("hidden"), false);
  ids["show-recover"].dispatchEvent(new Event("click")); assert.equal(ids["recover-view"].attributes["aria-hidden"], "false"); assert.equal(globalThis.document.activeElement, ids["recover-username"]);
  ids["recover-back"].click(); assert.equal(globalThis.document.activeElement, ids["login-username"]);
});

test("registration handles invalid input, server errors, and success without leaving the active form on 401", async () => {
  const ids = installAuthDocument(); showAuthPanel("register-view");
  ids["register-form"].valid = false;
  await handleRegister({ preventDefault() {}, currentTarget: ids["register-form"] });
  assert.match(ids["register-error"].textContent, /Complete every/); assert.equal(ids["register-view"].classList.contains("hidden"), false);
  ids["register-form"].valid = true; ids["register-password"].value = ids["register-confirm"].value = "Long-Unique-Password42!";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "Invitation expired" }), { status: 401, headers: { "Content-Type": "application/json" } });
  await handleRegister({ preventDefault() {}, currentTarget: ids["register-form"] }); assert.equal(ids["register-error"].textContent, "Invitation expired"); assert.equal(ids["register-view"].classList.contains("hidden"), false);
  globalThis.fetch = async () => new Response(JSON.stringify({ recoveryCode: "ONE-TIME-CODE" }), { status: 201, headers: { "Content-Type": "application/json" } });
  await handleRegister({ preventDefault() {}, currentTarget: ids["register-form"] }); assert.equal(ids["one-time-recovery-code"].textContent, "ONE-TIME-CODE"); assert.equal(ids["recovery-code-view"].classList.contains("hidden"), false);
});

test("recovery submits its public route, reports failures, and displays the replacement code once", async () => {
  const ids = installAuthDocument(); showAuthPanel("recover-view"); let requested;
  globalThis.fetch = async (url) => { requested = url; return new Response("not available", { status: 503 }); };
  await handleRecover({ preventDefault() {}, currentTarget: ids["recover-form"] }); assert.match(ids["recover-error"].textContent, /Request failed \(503\)/); assert.equal(ids["recover-view"].classList.contains("hidden"), false);
  globalThis.fetch = async (url) => { requested = url; return new Response(JSON.stringify({ recoveryCode: "REPLACEMENT" }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  await handleRecover({ preventDefault() {}, currentTarget: ids["recover-form"] }); assert.equal(requested, "/api/recover-account"); assert.equal(ids["one-time-recovery-code"].textContent, "REPLACEMENT");
});
