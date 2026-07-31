import { STATUS_VALUES as statuses, STATUS_MIGRATIONS, normalizeStatus } from "./business/status.mjs";
import { classifyFollowUp, compareFollowUpSoonest, compareMostOverdue, formatLocalCalendarDate, formatRelativeContact } from "./business/follow-up.mjs";
import { calculateMetrics, isOpenLead } from "./business/metrics.mjs";
import { normalizeEmailForMatch, normalizePhoneForMatch, phonesMatch } from "./business/duplicates.mjs";
import { ACTIVITY_TYPES, buildAutomaticActivities } from "./business/activity.mjs";
import { serializeLeadsToCsv } from "./business/csv.mjs";
import { CONTACT_METHODS, normalizeContactMethod, normalizeLeadContactMethods } from "./business/contact-method.mjs";

const STORAGE_KEY = "restoreAtHomeLeads";
const priorities = ["Low", "Medium", "High"];
const PRIORITY_RANK = Object.freeze({ High: 0, Medium: 1, Low: 2 });
const MISSING_DATE_RANK = Number.POSITIVE_INFINITY;
const DEFAULT_SORT = "newest";
const SEARCH_FIELDS = Object.freeze(["name", "phone", "email", "location", "condition", "referralSource", "notes", "nextAction"]);
const leadTypes = ["New patient", "Returning patient"];
const activityTypes = Object.freeze(Object.values(ACTIVITY_TYPES));
let leads = [];
let filteredLeads = [];
let contactDialogTrigger = null;
let activeMetricFilter = "";
let saveInProgress = false;
let pendingDuplicateSave = null;
let storageRecoveryError = "";
const $ = (id) => document.getElementById(id);

function searchableText(lead) { return SEARCH_FIELDS.map((field) => String(lead[field] || "").toLocaleLowerCase()).join(" "); }
function normalizeLead(rawLead) {
  if (!rawLead || typeof rawLead !== "object" || Array.isArray(rawLead)) throw new TypeError("Invalid lead record");
  const requiredStrings = ["name", "phone", "location", "condition", "priority", "leadType"];
  if (requiredStrings.some((field) => typeof rawLead[field] !== "string" || !rawLead[field].trim())) throw new TypeError("A lead is missing required fields");
  if (!priorities.includes(rawLead.priority) || !leadTypes.includes(rawLead.leadType)) throw new TypeError("A lead has an invalid priority or type");
  if (!statuses.includes(rawLead.status) && !Object.hasOwn(STATUS_MIGRATIONS, rawLead.status)) throw new TypeError("A lead has an invalid status");
  if (!isValidPhone(rawLead.phone) || !isValidEmail(rawLead.email || "")) throw new TypeError("A lead has invalid contact details");
  if ([rawLead.createdAt, rawLead.updatedAt].some((value) => value && Number.isNaN(new Date(value).getTime()))) throw new TypeError("A lead has an invalid timestamp");
  if (rawLead.nextFollowUp && classifyFollowUp(rawLead.nextFollowUp).state === "none") throw new TypeError("A lead has an invalid follow-up date");
  if ([rawLead.lastContactedAt, rawLead.bookedAt].some((value) => value && Number.isNaN(new Date(value).getTime()))) throw new TypeError("A lead has an invalid contact or booking date");
  const originalStatus = rawLead.status;
  const normalizedStatus = normalizeStatus(originalStatus);
  const activities = Array.isArray(rawLead.activities) ? rawLead.activities.map((activity) => {
    if (!activity || typeof activity !== "object" || Array.isArray(activity) || !activityTypes.includes(activity.type)) throw new TypeError("A lead has an invalid activity");
    const activityAt = new Date(activity.activityAt);
    if (Number.isNaN(activityAt.getTime())) throw new TypeError("A lead has an invalid activity date");
    return { id: String(activity.id || crypto.randomUUID()), leadId: String(activity.leadId || rawLead.id), type: activity.type, activityAt: activityAt.toISOString(), contactMethod: normalizeContactMethod(activity.contactMethod), note: typeof activity.note === "string" ? activity.note : "", createdAt: activity.createdAt || activityAt.toISOString() };
  }) : [];
  const createdAt = rawLead.createdAt || new Date().toISOString();
  const normalizedLead = { ...rawLead, id: rawLead.id || crypto.randomUUID(), createdAt, updatedAt: rawLead.updatedAt || createdAt, status: normalizedStatus, email: typeof rawLead.email === "string" ? rawLead.email : "", referralSource: typeof rawLead.referralSource === "string" ? rawLead.referralSource : "", nextFollowUp: typeof rawLead.nextFollowUp === "string" ? rawLead.nextFollowUp : "", nextAction: typeof rawLead.nextAction === "string" ? rawLead.nextAction : "", lastContactedAt: typeof rawLead.lastContactedAt === "string" ? rawLead.lastContactedAt : "", lastContactMethod: normalizeContactMethod(rawLead.lastContactMethod), bookedAt: typeof rawLead.bookedAt === "string" ? rawLead.bookedAt : "", notes: typeof rawLead.notes === "string" ? rawLead.notes : "", activities };
  if (normalizedStatus !== originalStatus) normalizedLead.legacyStatus = originalStatus;
  return normalizedLead;
}
function loadLeads() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new TypeError("Stored leads must be an array");
    return parsed.map(normalizeLead);
  } catch {
    storageRecoveryError = "Saved lead data could not be loaded. It was left unchanged; import a valid backup or clear browser storage before saving.";
    console.error("Saved lead data could not be loaded; storage was left unchanged.");
    return [];
  }
}
function saveLeads(nextLeads) {
  if (storageRecoveryError) throw new Error(storageRecoveryError);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLeads));
}
function commitLeads(nextLeads) {
  saveLeads(nextLeads);
  leads = nextLeads;
}
function refreshLeads() { leads = loadLeads(); render(); }
function timestampRank(value) { const timestamp = new Date(String(value || "")).getTime(); return Number.isNaN(timestamp) ? MISSING_DATE_RANK : timestamp; }
function compareDateRanks(a, b, direction = 1) { const aMissing = a === MISSING_DATE_RANK; const bMissing = b === MISSING_DATE_RANK; if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1; return (a - b) * direction; }
function prepareLead(lead, now = new Date()) { return { ...lead, _searchableText: searchableText(lead), _status: normalizeStatus(lead.status), _followUp: classifyFollowUp(lead.nextFollowUp, now), _createdTime: timestampRank(lead.createdAt), _priorityRank: PRIORITY_RANK[lead.priority] ?? Object.keys(PRIORITY_RANK).length }; }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function normalizePhone(phone) { return normalizePhoneForMatch(phone); }
function isValidPhone(phone) { return /^\d{7,15}$/.test(normalizePhoneForMatch(phone)); }
function isValidEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function init() {
  statuses.forEach((status) => [$("status"), $("filter-status")].forEach((el) => el.add(new Option(status, status))));
  priorities.forEach((priority) => [$("priority"), $("filter-priority")].forEach((el) => el.add(new Option(priority, priority))));
  leadTypes.forEach((type) => [$("leadType"), $("filter-lead-type")].forEach((el) => el.add(new Option(type, type))));
  CONTACT_METHODS.forEach((method) => $("lastContactMethod").add(new Option(method, method)));
  CONTACT_METHODS.forEach((method) => $("contact-method").add(new Option(method, method)));
  bindEvents(); refreshLeads();
  if (storageRecoveryError) announce(storageRecoveryError);
}
function bindEvents() {
  $("lead-form").addEventListener("submit", handleSave);
  $("add-lead-disclosure").addEventListener("click", toggleLeadForm);
  $("lead-form").addEventListener("input", clearDuplicateWarning);
  $("save-anyway").addEventListener("click", () => pendingDuplicateSave && persistLead(pendingDuplicateSave));
  $("review-duplicate").addEventListener("click", reviewDuplicate);
  $("cancel-edit").addEventListener("click", resetForm);
  ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup", "sort-by"].forEach((id) => $(id).addEventListener("input", render));
  $("clear-filters").addEventListener("click", clearFilters);
  document.querySelector(".dashboard").addEventListener("click", handleMetricFilter);
  $("export-all").addEventListener("click", () => exportCsv(leads, "restore-at-home-all-leads.csv"));
  $("export-filtered").addEventListener("click", () => exportCsv(filteredLeads, "restore-at-home-filtered-leads.csv"));
  $("export-json").addEventListener("click", exportJson);
  $("import-json").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", importJson);
  $("lead-list").addEventListener("click", handleLeadActionClick);
  $("daily-action-list").addEventListener("click", handleLeadActionClick);
  $("contact-form").addEventListener("submit", handleContactSave);
  $("contact-dialog").addEventListener("keydown", trapDialogFocus);
  $("contact-dialog").addEventListener("close", restoreContactDialogFocus);
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", closeContactDialog));
  document.addEventListener("click", closeOpenMenus); document.addEventListener("keydown", handleGlobalKeydown);
}
function toggleLeadForm() { const button = $("add-lead-disclosure"); const opening = button.getAttribute("aria-expanded") !== "true"; button.setAttribute("aria-expanded", String(opening)); $("lead-form").classList.toggle("is-open", opening); if (opening) $("name").focus(); }
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
function persistLead({ fields, existingId }) {
  if (saveInProgress) return;
  saveInProgress = true;
  $("save-lead").disabled = true;
  $("save-anyway").disabled = true;
  try {
    const existing = leads.find((lead) => lead.id === existingId);
    const now = new Date().toISOString();
    const next = { ...fields, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now, bookedAt: fields.status === "Booked" ? existing?.bookedAt || now : existing?.bookedAt || "", activities: existing?.activities || [] };
    next.activities = [...next.activities, ...buildAutomaticActivities(existing || null, next, { id: () => crypto.randomUUID(), now })];
    const nextLeads = existing ? leads.map((lead) => lead.id === existing.id ? next : lead) : [next, ...leads];
    commitLeads(nextLeads);
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
function deleteLead(id) {
  if (!confirm("Delete this lead?")) return;
  try {
    const nextLeads = leads.filter((lead) => lead.id !== id);
    commitLeads(nextLeads);
    render(); announce("Lead deleted successfully.");
  } catch { announce("The lead could not be deleted. Try again."); }
}
function handleLeadActionClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action || !event.currentTarget.contains(action)) return;
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
function handleContactSave(event) {
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
  try {
    const activity = { id: crypto.randomUUID(), leadId: id, type: ACTIVITY_TYPES.CONTACTED, activityAt: contactedAt, contactMethod: method, note, createdAt: new Date().toISOString() };
    const nextLeads = leads.map((lead) => lead.id === id ? { ...lead, lastContactedAt: contactedAt, lastContactMethod: method, updatedAt: new Date().toISOString(), activities: [...lead.activities, activity] } : lead);
    commitLeads(nextLeads);
  } catch { $("contact-error").textContent = "Contact activity could not be saved. Try again."; return; }
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
  const stableTieBreak = () => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }) || String(a.id || "").localeCompare(String(b.id || ""));
  let order = 0;
  if (sort === "oldest") order = compareDateRanks(a._createdTime, b._createdTime);
  else if (sort === "followup-soonest") order = compareFollowUpSoonest(a, b);
  else if (sort === "most-overdue") order = compareMostOverdue(a, b);
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
function contactHref(lead, type) {
  if (type === "phone") return lead.phone && isValidPhone(lead.phone) ? `tel:${encodeURIComponent(normalizePhone(lead.phone))}` : "";
  return lead.email && isValidEmail(lead.email) ? `mailto:${encodeURIComponent(lead.email)}` : "";
}
function lastContactMarkup(lead) {
  if (!lead.lastContactedAt) return "Not recorded";
  const exact = formatDateTime(lead.lastContactedAt);
  const relative = formatRelativeContact(lead.lastContactedAt);
  const method = lead.lastContactMethod ? ` · ${escapeHtml(lead.lastContactMethod)}` : "";
  return `<time datetime="${escapeHtml(lead.lastContactedAt)}" title="${exact}" aria-label="Last contacted ${exact}">${escapeHtml(relative)}</time>${method}`;
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
    const id = escapeHtml(lead.id);
    const phoneUrl = contactHref(lead, "phone");
    const emailUrl = contactHref(lead, "email");
    const statusSlug = lead._status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const phone = phoneUrl ? `<a href="${phoneUrl}">${escapeHtml(lead.phone)}</a>` : `<span>${escapeHtml(lead.phone)}</span>`;
    return `<article class="daily-action-row" data-lead-id="${id}"><div class="daily-action-summary"><strong>${escapeHtml(lead.name)}</strong>${phone}<span class="muted daily-action-detail">Last contact: ${lastContactMarkup(lead)}</span></div><div class="daily-action-badges"><span class="badge status-${statusSlug}">${escapeHtml(lead._status)}</span>${followUpChip(followUp)}</div><div class="daily-action-buttons">${phoneUrl ? `<a class="quick-action" href="${phoneUrl}" aria-label="Call ${escapeHtml(lead.name)}">Call</a>` : '<span class="quick-action unavailable">Call unavailable</span>'}${emailUrl ? `<a class="quick-action" href="${emailUrl}" aria-label="Email ${escapeHtml(lead.name)}">Email</a>` : '<span class="quick-action unavailable">Email unavailable</span>'}<button type="button" data-action="contact">Mark contacted</button><button type="button" class="secondary" data-action="edit">Edit / review</button></div></article>`;
  }).join("");
}
function renderLeads() {
  $("result-count").textContent = filteredLeads.length;
  $("empty-state").classList.toggle("hidden", filteredLeads.length > 0);
  const hasStoredLeads = leads.length > 0;
  $("empty-state-title").textContent = hasStoredLeads ? "No leads match your current filters." : "No leads yet";
  $("empty-state-message").textContent = hasStoredLeads ? "Clear or adjust the filters to see more leads." : "Use the form to add your first lead.";
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
  const phoneUrl = contactHref(lead, "phone");
  const emailUrl = contactHref(lead, "email");
  const contactLink = (url, label, value) => url ? `<a class="quick-link" href="${url}" aria-label="${label} ${escapeHtml(lead.name)}"><span aria-hidden="true">${label === "Call" ? "☎" : "✉"}</span><span>${label}</span><small>${escapeHtml(value)}</small></a>` : `<span class="contact-unavailable" aria-label="${label} unavailable">${label} unavailable</span>`;
  return `<article class="lead-card" data-lead-id="${id}"><div class="mobile-summary"><div><h3>${escapeHtml(lead.name)}</h3><div class="summary-chips"><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${escapeHtml(lead.priority)}</span><span class="badge status-${slug(status)}">${escapeHtml(status)}</span>${followUpChip(followUp)}</div></div><button type="button" class="disclosure-button ghost" data-action="disclose" aria-expanded="false" aria-controls="lead-details-${id}">Show details</button></div><div id="lead-details-${id}" class="lead-card-details"><header><div><h3>${escapeHtml(lead.name)}</h3><p class="condition">${escapeHtml(lead.condition)}</p></div><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${escapeHtml(lead.priority)}</span></header><div class="badges"><span class="badge status-${slug(status)}">${escapeHtml(status)}</span><span class="badge type-${slug(lead.leadType || "New patient")}">${escapeHtml(lead.leadType || "New patient")}</span>${lead.referralSource ? `<span class="badge referral-badge">${escapeHtml(lead.referralSource)}</span>` : ""}${followUpChip(followUp)}${followUp.exactDate ? `<span class="exact-date">${escapeHtml(followUp.exactDate)}</span>` : ""}</div><div class="contact-actions">${contactLink(phoneUrl, "Call", lead.phone)}${contactLink(emailUrl, "Email", lead.email)}</div><dl class="card-grid"><div><dt>Location</dt><dd>${escapeHtml(lead.location)}</dd></div><div><dt>Created</dt><dd>${formatDateTime(lead.createdAt)}</dd></div><div><dt>Last contact</dt><dd>${lastContactMarkup(lead)}</dd></div><div><dt>Next action</dt><dd>${escapeHtml(lead.nextAction || "None set")}</dd></div></dl>${lead.notes ? `<p class="lead-notes"><strong>Notes:</strong> ${escapeHtml(lead.notes)}</p>` : ""}${activityHistoryMarkup(lead)}<div class="card-actions"><button type="button" data-action="contact">Mark contacted</button><button type="button" class="secondary" data-action="edit">Edit</button><div class="more-actions"><button type="button" class="ghost" data-action="more" aria-expanded="false" aria-haspopup="menu">More <span aria-hidden="true">▾</span></button><div class="more-menu" role="menu" hidden><button type="button" class="danger-action" role="menuitem" data-action="delete">Delete lead</button></div></div></div></div></article>`;
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
function downloadJson(value, filename) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); Object.assign(document.createElement("a"), { href: url, download: filename }).click(); URL.revokeObjectURL(url); }
function exportJson() { downloadJson({ format: "restore-at-home-leads", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), leads: leads.map(normalizeLeadContactMethods) }, `restore-at-home-leads-${formatLocalCalendarDate()}.json`); announce(`${leads.length} leads exported to JSON.`); }
async function importJson(event) {
  const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const imported = parseBackup(parsed, normalizeLead);
    const replace = confirm(`Validated ${imported.length} lead records. Select OK to replace current data, or Cancel to merge them with the current ${leads.length} records.`);
    const nextLeads = replace ? imported : [...new Map([...leads, ...imported].map((lead) => [lead.id, lead])).values()];
    if (!confirm(`${replace ? "Replace" : "Merge"} browser data with ${nextLeads.length} validated records? This cannot be undone unless you exported a backup.`)) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLeads)); storageRecoveryError = ""; leads = nextLeads; render(); announce(`${imported.length} leads imported successfully.`);
  } catch (error) { announce(`Import rejected: ${error.message || "invalid JSON"} Existing data was not changed.`); }
}
if (typeof document !== "undefined") init();

const testHooks = {
  getLeads: () => leads,
  setLeads(nextLeads) { leads = nextLeads; storageRecoveryError = ""; },
  persistLead,
  handleContactSave,
  deleteLead,
  importJson
};

export { normalizeLead, testHooks };
