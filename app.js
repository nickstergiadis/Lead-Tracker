import { STATUS_VALUES as statuses, STATUS_MIGRATIONS, normalizeStatus } from "./business/status.mjs";
import { classifyFollowUp, formatLocalCalendarDate } from "./business/follow-up.mjs";
import { calculateMetrics, isOpenLead } from "./business/metrics.mjs";
import { normalizeEmailForMatch, normalizePhoneForMatch, phonesMatch } from "./business/duplicates.mjs";
import { ACTIVITY_TYPES } from "./business/activity.mjs";
import { serializeLeadsToCsv } from "./business/csv.mjs";

const STORAGE_KEY = "restoreAtHomeLeads";
const priorities = ["Low", "Medium", "High"];
const PRIORITY_RANK = Object.freeze({ High: 0, Medium: 1, Low: 2 });
const MISSING_DATE_RANK = Number.POSITIVE_INFINITY;
const DEFAULT_SORT = "newest";
const SEARCH_FIELDS = Object.freeze(["name", "phone", "email", "location", "condition", "referralSource", "notes", "nextAction"]);
const leadTypes = ["New patient", "Returning patient"];
const CONTACT_METHODS = Object.freeze(["Phone", "Email", "Text", "In person", "Other"]);
const activityTypes = Object.freeze(Object.values(ACTIVITY_TYPES));
let leads = [];
let filteredLeads = [];
let contactDialogTrigger = null;
let activeMetricFilter = "";
let saveInProgress = false;
let pendingDuplicateSave = null;
let storageRecoveryError = "";
let currentUser = null;
const $ = (id) => document.getElementById(id);

function searchableText(lead) {
  return SEARCH_FIELDS.map((field) => String(lead[field] || "").toLocaleLowerCase()).join(" ");
}
function normalizeLead(rawLead) {
  if (!rawLead || typeof rawLead !== "object" || Array.isArray(rawLead)) throw new TypeError("Invalid lead record");
  const originalStatus = rawLead.status;
  const normalizedStatus = normalizeStatus(originalStatus);
  const activities = Array.isArray(rawLead.activities)
    ? rawLead.activities.filter((activity) => activity && typeof activity === "object").map((activity) => ({
      id: activity.id || crypto.randomUUID(),
      leadId: activity.leadId || rawLead.id,
      type: activityTypes.includes(activity.type) ? activity.type : ACTIVITY_TYPES.STATUS_CHANGED,
      activityAt: activity.activityAt || activity.createdAt || rawLead.createdAt || new Date().toISOString(),
      contactMethod: CONTACT_METHODS.includes(activity.contactMethod) ? activity.contactMethod : "",
      note: typeof activity.note === "string" ? activity.note : "",
      createdAt: activity.createdAt || new Date().toISOString()
    })) : [];
  const normalizedLead = {
    ...rawLead,
    status: normalizedStatus,
    nextAction: typeof rawLead.nextAction === "string" ? rawLead.nextAction : "",
    lastContactedAt: typeof rawLead.lastContactedAt === "string" ? rawLead.lastContactedAt : "",
    lastContactMethod: CONTACT_METHODS.includes(rawLead.lastContactMethod) ? rawLead.lastContactMethod : "",
    bookedAt: typeof rawLead.bookedAt === "string" ? rawLead.bookedAt : "",
    activities
  };
  // Preserve unknown legacy statuses so a migration can revisit them without data loss.
  if (normalizedStatus !== originalStatus && !Object.hasOwn(STATUS_MIGRATIONS, originalStatus)) normalizedLead.legacyStatus = originalStatus;
  return normalizedLead;
}
function loadLegacyLeads() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // A missing key is first use. An empty or otherwise invalid stored value is
    // persisted data that needs recovery and must not be replaced with examples.
    if (saved === null) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new TypeError("Stored leads must be an array");
    return parsed.map(normalizeLead);
  } catch {
    storageRecoveryError = "Saved lead data could not be loaded. The stored data was left unchanged; recover or clear it before saving.";
    console.error("Saved lead data could not be loaded; storage was left unchanged.");
    return [];
  }
}
async function api(path, options = {}, { preserveAuthView = false } = {}) { const response = await fetch(`/api${path}`, { credentials: "same-origin", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options }); if (response.status === 401 && !preserveAuthView) { showAuthenticatedView(false); throw new Error("Authentication required"); } const body = await response.json().catch(() => ({})); if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { fields: body.fields, status: response.status }); return body; }
async function refreshLeads() { const result = await api("/leads"); leads = result.leads.map(normalizeLead); render(); }
function timestampRank(value) {
  const timestamp = new Date(String(value || "")).getTime();
  return Number.isNaN(timestamp) ? MISSING_DATE_RANK : timestamp;
}
function compareDateRanks(a, b, direction = 1) {
  const aMissing = a === MISSING_DATE_RANK;
  const bMissing = b === MISSING_DATE_RANK;
  if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
  return (a - b) * direction;
}
function prepareLead(lead, now = new Date()) {
  return {
    ...lead,
    _searchableText: searchableText(lead),
    _status: normalizeStatus(lead.status),
    _followUp: classifyFollowUp(lead.nextFollowUp, now),
    _createdTime: timestampRank(lead.createdAt),
    _priorityRank: PRIORITY_RANK[lead.priority] ?? Object.keys(PRIORITY_RANK).length
  };
}
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function normalizePhone(phone) { return normalizePhoneForMatch(phone); }
function isValidPhone(phone) { return /^\d{7,15}$/.test(normalizePhoneForMatch(phone)); }
function isValidEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

async function init() {
  statuses.forEach((status) => [$("status"), $("filter-status")].forEach((el) => el.add(new Option(status, status))));
  priorities.forEach((priority) => [$("priority"), $("filter-priority")].forEach((el) => el.add(new Option(priority, priority))));
  leadTypes.forEach((type) => [$("leadType"), $("filter-lead-type")].forEach((el) => el.add(new Option(type, type))));
  CONTACT_METHODS.forEach((method) => $("lastContactMethod").add(new Option(method, method)));
  CONTACT_METHODS.forEach((method) => $("contact-method").add(new Option(method, method)));
  bindEvents();
  try { const result = await api("/session"); currentUser = result.user; showAuthenticatedView(true); await refreshLeads(); } catch { showAuthenticatedView(false); }
}
function bindEvents() {
  $("login-form").addEventListener("submit", handleLogin);
  bindAuthNavigation("show-register", "register-view");
  bindAuthNavigation("show-recover", "recover-view");
  bindAuthNavigation("register-back", "login-view");
  bindAuthNavigation("recover-back", "login-view");
  bindAuthSubmit("register-form", handleRegister);
  bindAuthSubmit("recover-form", handleRecover);
  $("recovery-saved").addEventListener("change", (event) => { $("finish-recovery").disabled = !event.target.checked; });
  $("finish-recovery").addEventListener("click", finishRecovery);
  $("print-recovery").addEventListener("click", () => window.print());
  $("download-recovery").addEventListener("click", downloadRecoveryCode);
  $("security-toggle").addEventListener("click", loadSecurity);
  $("password-change-form").addEventListener("submit", changePassword);
  $("recovery-regenerate-form").addEventListener("submit", regenerateRecoveryCode);
  $("revoke-other-sessions").addEventListener("click", revokeOtherSessions);
  $("invitation-form").addEventListener("submit", createInvitation);
  $("invitation-list").addEventListener("click", revokeInvitation);
  $("admin-user-list").addEventListener("click", disableUser);
  $("logout").addEventListener("click", async () => { await api("/logout", { method: "POST", body: "{}" }).catch(() => {}); showAuthenticatedView(false); });
  $("lead-form").addEventListener("submit", handleSave);
  $("add-lead-disclosure").addEventListener("click", toggleLeadForm);
  $("lead-form").addEventListener("input", clearDuplicateWarning);
  $("save-anyway").addEventListener("click", () => pendingDuplicateSave && persistLead(pendingDuplicateSave));
  $("review-duplicate").addEventListener("click", reviewDuplicate);
  $("cancel-edit").addEventListener("click", resetForm);
  ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup", "sort-by"].forEach((id) => $(id).addEventListener("input", render));
  $("clear-filters").addEventListener("click", clearFilters);
  document.querySelector(".dashboard").addEventListener("click", handleMetricFilter);
  $("export-all").addEventListener("click", () => exportServerCsv());
  $("export-filtered").addEventListener("click", () => exportCsv(filteredLeads, "restore-at-home-filtered-leads.csv"));
  $("import-browser").addEventListener("click", importBrowserRecords);
  $("lead-list").addEventListener("click", handleLeadListClick);
  $("contact-form").addEventListener("submit", handleContactSave);
  $("contact-dialog").addEventListener("keydown", trapDialogFocus);
  $("contact-dialog").addEventListener("close", restoreContactDialogFocus);
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", closeContactDialog));
  document.addEventListener("click", closeOpenMenus);
  document.addEventListener("keydown", handleGlobalKeydown);
}
function authSetupError(message) {
  const error = $("login-error");
  if (error) error.textContent = message;
  else console.error(message);
}
function bindAuthNavigation(controlId, viewId) {
  const control = $(controlId);
  if (!control) { authSetupError(`Authentication control #${controlId} is unavailable.`); return; }
  control.addEventListener("click", () => {
    if (!$(viewId)) { authSetupError(`The requested authentication form (#${viewId}) is unavailable.`); return; }
    showAuthPanel(viewId);
  });
}
function bindAuthSubmit(formId, handler) {
  const form = $(formId);
  if (!form) { authSetupError(`Authentication form #${formId} is unavailable.`); return; }
  form.addEventListener("submit", handler);
}
function toggleLeadForm() {
  const button = $("add-lead-disclosure");
  const opening = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(opening));
  $("lead-form").classList.toggle("is-open", opening);
  if (opening) $("name").focus();
}
async function handleLogin(event) {
  event.preventDefault();
  try { await api("/login", { method: "POST", body: JSON.stringify({ username: $("login-username").value, password: $("password").value }) }); currentUser = (await api("/session")).user; $("password").value = ""; showAuthenticatedView(true); await refreshLeads(); } catch { $("login-error").textContent = "Sign-in failed."; }
}
const AUTH_VIEWS = Object.freeze(["login-view", "register-view", "recover-view", "recovery-code-view"]);
const AUTH_ERRORS = Object.freeze(["login-error", "register-error", "recover-error"]);
const SENSITIVE_AUTH_FIELDS = Object.freeze({ "login-view": ["password"], "register-view": ["register-invitation", "register-password", "register-confirm"], "recover-view": ["recover-code", "recover-password"], "recovery-code-view": ["one-time-recovery-code"] });
const AUTH_FOCUS = Object.freeze({ "login-view": "login-username", "register-view": "register-invitation", "recover-view": "recover-username", "recovery-code-view": "one-time-recovery-code" });
function showAuthPanel(id) {
  if (!AUTH_VIEWS.includes(id) || !$(id)) { authSetupError(`The requested authentication form (#${id}) is unavailable.`); return false; }
  for (const viewId of AUTH_VIEWS) {
    const view = $(viewId);
    if (!view) { authSetupError(`Authentication view #${viewId} is unavailable.`); continue; }
    const active = viewId === id;
    view.classList.toggle("hidden", !active);
    view.setAttribute("aria-hidden", String(!active));
    if (!active) for (const fieldId of SENSITIVE_AUTH_FIELDS[viewId] || []) { const field = $(fieldId); if (field) field.value = ""; }
  }
  for (const errorId of AUTH_ERRORS) { const error = $(errorId); if (error) error.textContent = ""; }
  const focusTarget = $(AUTH_FOCUS[id]);
  if (focusTarget) focusTarget.focus();
  else authSetupError(`The first field for #${id} is unavailable.`);
  return true;
}
function showRecoveryCode(code, authenticated) { $("one-time-recovery-code").textContent = code; $("recovery-code-view").dataset.authenticated = String(authenticated); $("recovery-saved").checked = false; $("finish-recovery").disabled = true; showAuthPanel("recovery-code-view"); }
async function handleRegister(event) { event.preventDefault(); const form = event.currentTarget; $("register-error").textContent = ""; if (!form.checkValidity()) { form.reportValidity(); $("register-error").textContent = "Complete every registration field using the requested format."; return; } if ($("register-password").value !== $("register-confirm").value) { $("register-error").textContent = "Passwords must match."; $("register-confirm").focus(); return; } try { const result = await api("/register", { method: "POST", body: JSON.stringify({ invitationCode: $("register-invitation").value, username: $("register-username").value, displayName: $("register-display-name").value, password: $("register-password").value, passwordConfirmation: $("register-confirm").value }) }, { preserveAuthView: true }); if (!result.recoveryCode) throw new Error("Registration succeeded without a recovery code. Contact an administrator before continuing."); form.reset(); showRecoveryCode(result.recoveryCode, true); } catch (error) { $("register-error").textContent = error.message || "Registration failed. Try again later."; } }
async function handleRecover(event) { event.preventDefault(); const form = event.currentTarget; $("recover-error").textContent = ""; if (!form.checkValidity()) { form.reportValidity(); $("recover-error").textContent = "Complete every recovery field using the requested format."; return; } try { const result = await api("/recover-account", { method: "POST", body: JSON.stringify({ username: $("recover-username").value, recoveryCode: $("recover-code").value, newPassword: $("recover-password").value }) }, { preserveAuthView: true }); if (!result.recoveryCode) throw new Error("Recovery succeeded without a replacement recovery code. Contact an administrator before continuing."); form.reset(); showRecoveryCode(result.recoveryCode, false); } catch (error) { $("recover-error").textContent = error.message || "Recovery failed. Check your details or try again later."; } }
function downloadRecoveryCode() { const code = $("one-time-recovery-code").textContent; const blob = new Blob([`Restore at Home recovery code\n\n${code}\n\nStore this offline. It can be used only once.\n`], { type: "text/plain" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "restore-at-home-recovery-code.txt"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0); }
async function finishRecovery() { $("one-time-recovery-code").textContent = ""; if ($("recovery-code-view").dataset.authenticated === "true") { showAuthenticatedView(true); await refreshLeads(); } else showAuthPanel("login-view"); }
async function loadSecurity(forceOpen = false) { $("security-view").classList.toggle("hidden", forceOpen ? false : !$("security-view").classList.contains("hidden")); if ($("security-view").classList.contains("hidden")) return; const result = await api("/security/sessions"); $("session-list").innerHTML = result.sessions.map((session) => `<p>${escapeHtml(session.user_agent || "Unknown device")} — ${session.current ? "current" : "active"}</p>`).join(""); }
async function changePassword(event) { event.preventDefault(); try { await api("/security/password", { method: "POST", body: JSON.stringify({ currentPassword: $("current-password").value, newPassword: $("new-password").value }) }); event.target.reset(); $("security-message").textContent = "Password changed."; } catch { $("security-message").textContent = "Password change failed."; } }
async function regenerateRecoveryCode(event) { event.preventDefault(); try { const result = await api("/security/recovery-code", { method: "POST", body: JSON.stringify({ currentPassword: $("recovery-current-password").value }) }); event.target.reset(); showRecoveryCode(result.recoveryCode, true); } catch { $("security-message").textContent = "Recovery code regeneration failed."; } }
async function revokeOtherSessions() { await api("/security/sessions/others", { method: "DELETE" }); $("security-message").textContent = "Other sessions revoked."; await loadSecurity(true); }
async function loadAdmin() { if (currentUser?.role !== "admin") return; const [invitations, users] = await Promise.all([api("/admin/invitations"), api("/admin/users")]); $("admin-view").classList.remove("hidden"); $("invitation-list").innerHTML = invitations.invitations.map((item) => `<p>${new Date(item.expires_at).toLocaleString()} — ${item.consumed_at ? "used" : item.revoked_at ? "revoked" : `<button class="secondary" data-invitation-id="${item.id}">Revoke</button>`}</p>`).join(""); $("admin-user-list").innerHTML = users.users.map((item) => `<p>${escapeHtml(item.display_name)} (${escapeHtml(item.username_normalized)}) — ${item.role}, ${item.status} ${item.status === "active" ? `<button class="secondary" data-user-id="${item.id}">Disable</button>` : ""}</p>`).join(""); }
async function createInvitation(event) { event.preventDefault(); const result = await api("/admin/invitations", { method: "POST", body: JSON.stringify({ expiresInHours: $("invitation-hours").value }) }); $("new-invitation-code").textContent = `Copy this invitation now: ${result.invitation.code}`; await loadAdmin(); }
async function revokeInvitation(event) { const id = event.target.dataset.invitationId; if (!id) return; await api(`/admin/invitations/${id}`, { method: "DELETE" }); await loadAdmin(); }
async function disableUser(event) { const id = event.target.dataset.userId; if (!id || !confirm("Disable this account and revoke all sessions?")) return; try { await api(`/admin/users/${id}/disable`, { method: "POST", body: "{}" }); await loadAdmin(); } catch (error) { $("admin-message").textContent = error.message; } }
function showAuthenticatedView(authed) {
  if (!authed) showAuthPanel("login-view"); else AUTH_VIEWS.forEach((id) => { $(id).classList.add("hidden"); $(id).setAttribute("aria-hidden", "true"); });
  $("app-view").classList.toggle("hidden", !authed);
  if (authed) {
    render();
    $("import-browser").classList.toggle("hidden", !localStorage.getItem(STORAGE_KEY));
    if (storageRecoveryError) announce(storageRecoveryError);
    loadAdmin().catch(() => { $("admin-view").classList.add("hidden"); });
  }
}
function getFormData() {
  return { name: $("name").value.trim(), phone: $("phone").value.trim(), email: $("email").value.trim(), location: $("location").value.trim(), referralSource: $("referralSource").value.trim(), condition: $("condition").value.trim(), status: $("status").value, priority: $("priority").value, leadType: $("leadType").value, nextFollowUp: $("nextFollowUp").value, nextAction: $("nextAction").value.trim(), lastContactedAt: $("lastContactedAt").value, lastContactMethod: $("lastContactMethod").value, notes: $("notes").value.trim() };
}
function validateLead(lead) {
  const errors = {};
  [["name", "Enter a name."], ["phone", "Enter a phone number."], ["location", "Enter a location."], ["condition", "Enter a condition or reason."], ["status", "Choose a status."], ["priority", "Choose a priority."], ["leadType", "Choose a lead type."]].forEach(([field, message]) => { if (!lead[field]) errors[field] = message; });
  if (lead.phone && !isValidPhone(lead.phone)) errors.phone = "Enter a valid phone number with 7 to 15 digits.";
  if (!isValidEmail(lead.email)) errors.email = "Enter a valid email address or leave email blank.";
  return errors;
}
function handleSave(event) {
  event.preventDefault();
  if (saveInProgress) return;
  const fields = getFormData();
  const errors = validateLead(fields);
  showValidationErrors(errors);
  if (Object.keys(errors).length) { announce("Lead could not be saved. Check the highlighted fields."); return; }
  const currentId = $("lead-id").value;
  const duplicate = leads.find((lead) => lead.id !== currentId && ((fields.phone && phonesMatch(fields.phone, lead.phone)) || (normalizeEmailForMatch(fields.email) && normalizeEmailForMatch(fields.email) === normalizeEmailForMatch(lead.email))));
  if (duplicate) {
    pendingDuplicateSave = { fields, existingId: currentId };
    $("duplicate-message").textContent = `${duplicate.name} has a matching ${phonesMatch(fields.phone, duplicate.phone) ? "phone number" : "email address"}.`;
    $("duplicate-warning").dataset.leadId = duplicate.id;
    $("duplicate-warning").classList.remove("hidden");
    $("review-duplicate").focus();
    announce(`Possible duplicate found for ${duplicate.name}. Review it or choose Save anyway.`);
    return;
  }
  persistLead({ fields, existingId: currentId });
}
async function persistLead({ fields, existingId }) {
  if (saveInProgress) return;
  saveInProgress = true;
  $("save-lead").disabled = true;
  $("save-anyway").disabled = true;
  try {
    const existing = leads.find((lead) => lead.id === existingId);
    await api(existing ? `/leads/${existing.id}` : "/leads", { method: existing ? "PUT" : "POST", body: JSON.stringify(fields) });
    await refreshLeads();
    resetForm();
    render();
    announce(`${fields.name} ${existing ? "updated" : "created"} successfully.`);
  } catch {
    console.error("Unable to save lead changes.");
    $("form-error").textContent = "The lead could not be saved. Your entries have been preserved; try again.";
    announce("Lead could not be saved. Your entries have been preserved.");
  } finally {
    saveInProgress = false;
    $("save-lead").disabled = false;
    $("save-anyway").disabled = false;
  }
}
function showValidationErrors(errors = {}) {
  ["name", "phone", "email", "location", "condition", "status", "priority", "leadType"].forEach((field) => {
    $(`${field}-error`).textContent = errors[field] || "";
    $(field).setAttribute("aria-invalid", String(Boolean(errors[field])));
  });
  $("form-error").textContent = Object.keys(errors).length ? "Please correct the highlighted fields." : "";
  const firstInvalid = Object.keys(errors)[0];
  if (firstInvalid) $(firstInvalid).focus();
}
function clearDuplicateWarning() { pendingDuplicateSave = null; $("duplicate-warning").classList.add("hidden"); }
function reviewDuplicate() {
  const id = $("duplicate-warning").dataset.leadId;
  const lead = leads.find((item) => item.id === id);
  if (!lead) return;
  $("search").value = lead.name;
  render();
  document.querySelector(`[data-lead-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  announce(`${lead.name} is shown in the leads list. Your form entries are unchanged.`);
}
function resetForm() { $("lead-form").reset(); $("lead-id").value = ""; $("form-title").textContent = "Add lead"; $("save-lead").textContent = "Save lead"; $("cancel-edit").classList.add("hidden"); $("edit-history").classList.add("hidden"); showValidationErrors(); clearDuplicateWarning(); }
function editLead(id) {
  const lead = leads.find((l) => l.id === id);
  Object.entries(lead).forEach(([key, value]) => { if ($(key) && !["lastContactedAt"].includes(key)) $(key).value = value; });
  $("lastContactedAt").value = toDateTimeLocal(lead.lastContactedAt);
  $("lead-id").value = id; $("form-title").textContent = "Edit lead"; $("save-lead").textContent = "Update lead"; $("cancel-edit").classList.remove("hidden");
  $("edit-history").classList.remove("hidden"); $("edit-history").innerHTML = activityHistoryMarkup(lead);
  $("lead-form").classList.add("is-open");
  $("add-lead-disclosure").setAttribute("aria-expanded", "true");
  scrollTo({ top: 0, behavior: "smooth" });
}
function toDateTimeLocal(value) { if (!value) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return Number.isNaN(date.getTime()) ? "" : new Date(date - offset).toISOString().slice(0, 16); }
async function deleteLead(id) {
  if (!confirm("Delete this lead?")) return;
  try { await api(`/leads/${id}`, { method: "DELETE" }); await refreshLeads(); announce("Lead deleted successfully."); } catch { announce("The lead could not be deleted. Try again."); }
}
function handleLeadListClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action || !$("lead-list").contains(action)) return;
  const card = action.closest("[data-lead-id]");
  const id = card?.dataset.leadId;
  if (!id) return;
  const handlers = {
    edit: () => editLead(id),
    delete: () => deleteLead(id),
    contact: () => openContactDialog(id, action),
    disclose: () => toggleCardDetails(card, action),
    more: () => toggleMoreMenu(card, action)
  };
  handlers[action.dataset.action]?.();
}
function toggleCardDetails(card, button) {
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  card.classList.toggle("is-expanded", !expanded);
  button.textContent = expanded ? "Show details" : "Hide details";
}
function toggleMoreMenu(card, button) {
  const menu = card.querySelector(".more-menu");
  const opening = menu.hidden;
  closeOpenMenus();
  menu.hidden = !opening;
  button.setAttribute("aria-expanded", String(opening));
  if (opening) menu.querySelector("button")?.focus();
}
function closeOpenMenus(event) {
  if (event?.target.closest(".more-actions")) return;
  document.querySelectorAll(".more-menu:not([hidden])").forEach((menu) => {
    menu.hidden = true;
    menu.previousElementSibling?.setAttribute("aria-expanded", "false");
  });
}
function handleGlobalKeydown(event) {
  if (event.key !== "Escape" || $("contact-dialog").open) return;
  const menu = document.querySelector(".more-menu:not([hidden])");
  if (!menu) return;
  const trigger = menu.previousElementSibling;
  closeOpenMenus();
  trigger?.focus();
}
function openContactDialog(id, trigger) {
  const lead = leads.find((item) => item.id === id);
  if (!lead) return;
  contactDialogTrigger = trigger;
  $("contact-form").reset();
  $("contact-lead-id").value = id;
  $("contact-lead-name").textContent = lead.name;
  $("contact-date").value = toDateTimeLocal(new Date().toISOString());
  $("contact-error").textContent = "";
  $("contact-dialog").showModal();
  $("contact-method").focus();
}
function closeContactDialog() { $("contact-dialog").close(); }
function restoreContactDialogFocus() {
  if (contactDialogTrigger?.isConnected) contactDialogTrigger.focus();
  contactDialogTrigger = null;
}
function trapDialogFocus(event) {
  if (event.key === "Escape") { event.preventDefault(); closeContactDialog(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]')].filter((element) => !element.hidden);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
async function handleContactSave(event) {
  event.preventDefault();
  const id = $("contact-lead-id").value;
  const method = $("contact-method").value;
  const localDate = $("contact-date").value;
  const note = $("contact-note").value.trim();
  const contactedDate = new Date(localDate);
  if (!CONTACT_METHODS.includes(method) || !localDate || Number.isNaN(contactedDate.getTime())) {
    $("contact-error").textContent = "Choose a contact method and valid date and time.";
    return;
  }
  const existing = leads.find((lead) => lead.id === id);
  if (!existing) { $("contact-error").textContent = "This lead is no longer available."; return; }
  const contactedAt = contactedDate.toISOString();
  try { await api(`/leads/${id}/activity`, { method: "POST", body: JSON.stringify({ activityAt: contactedAt, contactMethod: method, note }) }); await refreshLeads(); } catch { $("contact-error").textContent = "Contact activity could not be saved. Try again."; return; }
  closeContactDialog();
  render();
  announce(`${existing.name} marked contacted.`);
}
function announce(message) {
  $("app-feedback").textContent = "";
  requestAnimationFrame(() => { $("app-feedback").textContent = message; });
}
function getFilteredLeads() {
  const q = String($("search").value || "").toLocaleLowerCase();
  const metricPredicate = calculateMetrics(preparedLeads).predicates[activeMetricFilter] || (() => true);
  return preparedLeads.filter(metricPredicate).filter((lead) => lead._searchableText.includes(q))
    .filter((lead) => !$("filter-status").value || lead._status === $("filter-status").value)
    .filter((lead) => !$("filter-referral").value || lead.referralSource === $("filter-referral").value)
    .filter((lead) => !$("filter-priority").value || lead.priority === $("filter-priority").value)
    .filter((lead) => !$("filter-lead-type").value || (lead.leadType || "New patient") === $("filter-lead-type").value)
    .filter((lead) => !$("filter-followup").value || lead.nextFollowUp === $("filter-followup").value)
    .sort(sortLeads);
}
function sortLeads(a, b) {
  const sort = $("sort-by").value;
  const followUpRank = (lead) => lead._followUp.dayDifference ?? MISSING_DATE_RANK;
  const stableTieBreak = () => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }) || String(a.id || "").localeCompare(String(b.id || ""));
  let order = 0;
  if (sort === "oldest") order = compareDateRanks(a._createdTime, b._createdTime);
  else if (sort === "followup-soonest") order = compareDateRanks(followUpRank(a), followUpRank(b));
  else if (sort === "most-overdue") order = compareDateRanks(followUpRank(a), followUpRank(b));
  else if (sort === "highest-priority") order = a._priorityRank - b._priorityRank;
  else if (sort === "name") order = String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  else order = compareDateRanks(a._createdTime, b._createdTime, -1);
  return order || stableTieBreak();
}
let preparedLeads = [];
function render() { updateReferralFilters(); preparedLeads = leads.map((lead) => prepareLead(lead)); filteredLeads = getFilteredLeads(); renderDashboard(); renderDailyActions(); renderLeads(); renderActiveFilterCount(); }
function updateReferralFilters() {
  const current = $("filter-referral").value;
  $("filter-referral").innerHTML = '<option value="">All referral sources</option>';
  $("referral-options").innerHTML = "";
  [...new Set(leads.map((l) => l.referralSource).filter(Boolean))].sort().forEach((source) => { $("filter-referral").add(new Option(source, source)); $("referral-options").append(new Option(source)); });
  $("filter-referral").value = current;
}
function renderDashboard() {
  const metrics = calculateMetrics(preparedLeads);
  $("open-leads").textContent = metrics.open;
  $("action-leads").textContent = metrics.needsAction;
  $("overdue-leads").textContent = metrics.overdue;
  $("booked-month-leads").textContent = metrics.bookedThisMonth;
  $("conversion-rate").textContent = `${Number(metrics.conversionRate.toFixed(1))}%`;
  document.querySelectorAll("[data-metric-filter]").forEach((card) => card.setAttribute("aria-pressed", String(card.dataset.metricFilter === activeMetricFilter)));
}
function followUpChip(followUp) {
  const exactDate = followUp.exactDate ? ` — ${followUp.exactDate}` : "";
  return `<span class="badge followup-badge followup-${followUp.state}" title="${escapeHtml(followUp.relativeLabel + exactDate)}" aria-label="${escapeHtml(followUp.relativeLabel + exactDate)}">${escapeHtml(followUp.relativeLabel)}</span>`;
}
function renderDailyActions() {
  const actionLeads = preparedLeads.filter((lead) => {
    const state = lead._followUp.state;
    return isOpenLead(lead) && (state === "overdue" || state === "today");
  }).sort((a, b) => {
    const dayOrder = a._followUp.dayDifference - b._followUp.dayDifference;
    return dayOrder || a._priorityRank - b._priorityRank || a.name.localeCompare(b.name);
  });
  $("daily-action-empty").classList.toggle("hidden", actionLeads.length > 0);
  $("daily-action-list").innerHTML = actionLeads.map((lead) => {
    const followUp = lead._followUp;
    return `<article class="daily-action-row"><div class="daily-action-summary"><strong>${escapeHtml(lead.name)}</strong><span class="muted daily-action-detail">${escapeHtml(lead.condition)}</span></div><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${escapeHtml(lead.priority)}</span>${followUpChip(followUp)}<span class="exact-date">${escapeHtml(followUp.exactDate)}</span></article>`;
  }).join("");
}
function renderLeads() {
  $("result-count").textContent = filteredLeads.length;
  $("empty-state").classList.toggle("hidden", filteredLeads.length > 0);
  $("lead-list").innerHTML = filteredLeads.map(leadCardMarkup).join("");
}
function renderActiveFilterCount() {
  const controlIds = ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup"];
  const count = controlIds.filter((id) => Boolean($(id).value)).length + Number(Boolean(activeMetricFilter)) + Number($("sort-by").value !== DEFAULT_SORT);
  $("active-filter-count").textContent = count;
  $("active-filter-count").classList.toggle("hidden", count === 0);
}
function handleMetricFilter(event) {
  const card = event.target.closest("[data-metric-filter]");
  if (!card) return;
  activeMetricFilter = activeMetricFilter === card.dataset.metricFilter ? "" : card.dataset.metricFilter;
  render();
  card.focus();
  const label = activeMetricFilter ? card.querySelector("strong").textContent : "All leads";
  announce(`${label} filter applied. ${filteredLeads.length} ${filteredLeads.length === 1 ? "lead" : "leads"} showing.`);
}
function leadCardMarkup(lead) {
  const status = lead._status;
  const followUp = lead._followUp;
  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const id = escapeHtml(lead.id);
  const phoneUrl = lead.phone && isValidPhone(lead.phone) ? `tel:${encodeURIComponent(normalizePhone(lead.phone))}` : "";
  const emailUrl = lead.email && isValidEmail(lead.email) ? `mailto:${encodeURIComponent(lead.email)}` : "";
  const contactLink = (url, label, value) => url ? `<a class="quick-link" href="${url}" aria-label="${label} ${escapeHtml(lead.name)}"><span aria-hidden="true">${label === "Call" ? "☎" : "✉"}</span><span>${label}</span><small>${escapeHtml(value)}</small></a>` : `<span class="contact-unavailable" aria-label="${label} unavailable">${label} unavailable</span>`;
  return `<article class="lead-card" data-lead-id="${id}"><div class="mobile-summary"><div><h3>${escapeHtml(lead.name)}</h3><div class="summary-chips"><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${escapeHtml(lead.priority)}</span><span class="badge status-${slug(status)}">${escapeHtml(status)}</span>${followUpChip(followUp)}</div></div><button type="button" class="disclosure-button ghost" data-action="disclose" aria-expanded="false" aria-controls="lead-details-${id}">Show details</button></div><div id="lead-details-${id}" class="lead-card-details"><header><div><h3>${escapeHtml(lead.name)}</h3><p class="condition">${escapeHtml(lead.condition)}</p></div><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${escapeHtml(lead.priority)}</span></header><div class="badges"><span class="badge status-${slug(status)}">${escapeHtml(status)}</span><span class="badge type-${slug(lead.leadType || "New patient")}">${escapeHtml(lead.leadType || "New patient")}</span>${lead.referralSource ? `<span class="badge referral-badge">${escapeHtml(lead.referralSource)}</span>` : ""}${followUpChip(followUp)}${followUp.exactDate ? `<span class="exact-date">${escapeHtml(followUp.exactDate)}</span>` : ""}</div><div class="contact-actions">${contactLink(phoneUrl, "Call", lead.phone)}${contactLink(emailUrl, "Email", lead.email)}</div><dl class="card-grid"><div><dt>Location</dt><dd>${escapeHtml(lead.location)}</dd></div><div><dt>Created</dt><dd>${formatDateTime(lead.createdAt)}</dd></div><div><dt>Last contact</dt><dd>${lead.lastContactedAt ? `${formatDateTime(lead.lastContactedAt)}${lead.lastContactMethod ? ` · ${escapeHtml(lead.lastContactMethod)}` : ""}` : "Not recorded"}</dd></div><div><dt>Next action</dt><dd>${escapeHtml(lead.nextAction || "None set")}</dd></div></dl>${lead.notes ? `<p class="lead-notes"><strong>Notes:</strong> ${escapeHtml(lead.notes)}</p>` : ""}${activityHistoryMarkup(lead)}<div class="card-actions"><button type="button" data-action="contact">Mark contacted</button><button type="button" class="secondary" data-action="edit">Edit</button><div class="more-actions"><button type="button" class="ghost" data-action="more" aria-expanded="false" aria-haspopup="menu">More <span aria-hidden="true">▾</span></button><div class="more-menu" role="menu" hidden><button type="button" class="danger-action" role="menuitem" data-action="delete">Delete lead</button></div></div></div></div></article>`;
}
function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : escapeHtml(date.toLocaleString()); }
function activityHistoryMarkup(lead) {
  const sorted = [...lead.activities].sort((a, b) => new Date(b.activityAt) - new Date(a.activityAt));
  const items = (activities) => activities.length ? `<ol class="activity-list">${activities.map((activity) => `<li><strong>${escapeHtml(activity.type)}</strong><time datetime="${escapeHtml(activity.activityAt)}">${formatDateTime(activity.activityAt)}</time>${activity.contactMethod ? `<span>${escapeHtml(activity.contactMethod)}</span>` : ""}${activity.note ? `<p>${escapeHtml(activity.note)}</p>` : ""}</li>`).join("")}</ol>` : '<p class="muted">No activity recorded.</p>';
  return `<section class="activity-history" aria-label="Activity history"><h4>Recent activity</h4>${items(sorted.slice(0, 3))}${sorted.length > 3 ? `<details><summary>View full history (${sorted.length})</summary>${items(sorted)}</details>` : ""}</section>`;
}
function clearFilters() { ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup"].forEach((id) => $(id).value = ""); $("sort-by").value = DEFAULT_SORT; activeMetricFilter = ""; render(); announce(`${filteredLeads.length} leads showing. Filters cleared.`); }
function exportCsv(rows, filename) {
  const blob = new Blob([serializeLeadsToCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click(); URL.revokeObjectURL(url);
}
async function exportServerCsv() { const response=await fetch("/api/export",{credentials:"same-origin"}); if(response.status===401){showAuthenticatedView(false);return;} if(!response.ok){announce("Export failed.");return;} const blob=await response.blob(),url=URL.createObjectURL(blob),link=Object.assign(document.createElement("a"),{href:url,download:"restore-at-home-all-leads.csv"});link.click();URL.revokeObjectURL(url); }
async function importBrowserRecords() {
  const records = loadLegacyLeads();
  if (storageRecoveryError) { announce(storageRecoveryError); return; }
  try {
    const preview = await api("/import/preview", { method: "POST", body: JSON.stringify({ leads: records }) });
    if (!confirm(`Browser backup preview: ${preview.total} records (${preview.valid} valid, ${preview.invalid} invalid). Import valid data only if every record is valid? A JSON backup will download first; browser data will remain unchanged.`)) return;
    if (preview.invalid) { announce("Import cancelled. Correct invalid browser records first."); return; }
    const backup = new Blob([JSON.stringify(records, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(backup); Object.assign(document.createElement("a"), { href: url, download: `restore-at-home-browser-backup-${formatLocalCalendarDate()}.json` }).click(); URL.revokeObjectURL(url);
    const result = await api("/import", { method: "POST", body: JSON.stringify({ leads: records }) });
    await refreshLeads(); announce(`${result.imported} browser records imported. The original browser backup was preserved.`);
  } catch (error) { announce(error.message || "Import failed; browser data was not changed."); }
}
if (typeof document !== "undefined") init();

export { api, bindAuthNavigation, handleRecover, handleRegister, showAuthPanel };
