const STORAGE_KEY = "restoreAtHomeLeads";
const AUTH_KEY = "restoreAtHomeAuth";
const DEMO_PASSWORD = "restore-demo";
const STATUSES = Object.freeze({
  NEW_INQUIRY: "New inquiry",
  CONTACTED: "Contacted",
  WAITING_FOR_REPLY: "Waiting for reply",
  BOOKED: "Booked",
  COMPLETED: "Completed",
  LOST: "Lost"
});
const statuses = Object.freeze(Object.values(STATUSES));
const STATUS_MIGRATIONS = Object.freeze({
  New: STATUSES.NEW_INQUIRY,
  "Follow-up needed": STATUSES.WAITING_FOR_REPLY,
  "Not a fit": STATUSES.LOST
});
const priorities = ["Low", "Medium", "High"];
const PRIORITY_RANK = Object.freeze({ High: 0, Medium: 1, Low: 2 });
const MISSING_DATE_RANK = Number.POSITIVE_INFINITY;
const DEFAULT_SORT = "newest";
const SEARCH_FIELDS = Object.freeze(["name", "phone", "email", "location", "condition", "referralSource", "notes", "nextAction"]);
const leadTypes = ["New patient", "Returning patient"];
const CONTACT_METHODS = Object.freeze(["Phone", "Email", "Text", "In person", "Other"]);
const ACTIVITY_TYPES = Object.freeze({
  LEAD_CREATED: "Lead created",
  STATUS_CHANGED: "Status changed",
  FOLLOW_UP_CHANGED: "Follow-up changed",
  CONTACTED: "Contacted",
  BOOKED: "Booked",
  COMPLETED: "Completed",
  LOST: "Lost"
});
const activityTypes = Object.freeze(Object.values(ACTIVITY_TYPES));
const demoLeads = [
  { id: crypto.randomUUID(), createdAt: "2026-06-20T09:00:00.000Z", name: "Amelia Grant", phone: "303-555-0198", email: "amelia@example.com", location: "Boulder", referralSource: "Google", condition: "Hip pain after fall", status: "New", priority: "High", leadType: "New patient", nextFollowUp: "2026-06-27", notes: "Prefers morning calls." },
  { id: crypto.randomUUID(), createdAt: "2026-06-18T14:30:00.000Z", name: "Marcus Lee", phone: "720-555-0144", email: "marcus@example.com", location: "Denver", referralSource: "Physician", condition: "Post-op knee rehab", status: "Booked", priority: "Medium", leadType: "Returning patient", nextFollowUp: "2026-06-29", notes: "Booked initial visit." },
  { id: crypto.randomUUID(), createdAt: "2026-06-16T11:15:00.000Z", name: "Priya Shah", phone: "970-555-0122", email: "", location: "Longmont", referralSource: "Friend", condition: "Balance and gait support", status: "Follow-up needed", priority: "High", leadType: "New patient", nextFollowUp: "2026-06-24", notes: "Left voicemail; call again." }
];
let leads = [];
let filteredLeads = [];
let contactDialogTrigger = null;
let activeMetricFilter = "";
let saveInProgress = false;
let pendingDuplicateSave = null;
const $ = (id) => document.getElementById(id);

function normalizeStatus(value) {
  if (statuses.includes(value)) return value;
  return Object.hasOwn(STATUS_MIGRATIONS, value) ? STATUS_MIGRATIONS[value] : STATUSES.NEW_INQUIRY;
}
const CSV_COLUMNS = Object.freeze([
  ["Name", "name"],
  ["Phone", "phone"],
  ["Email", "email"],
  ["Location", "location"],
  ["Condition", "condition"],
  ["Notes", "notes"],
  ["Status", (lead) => normalizeStatus(lead.status)],
  ["Priority", "priority"],
  ["Lead type", "leadType"],
  ["Referral source", "referralSource"],
  ["Next action", "nextAction"],
  ["Follow-up date (YYYY-MM-DD)", "nextFollowUp"],
  ["Last contacted date/time (ISO 8601)", (lead) => toIso8601(lead.lastContactedAt)],
  ["Last contact method", "lastContactMethod"],
  ["Booked date/time (ISO 8601)", (lead) => toIso8601(lead.bookedAt)],
  ["Created date/time (ISO 8601)", (lead) => toIso8601(lead.createdAt)]
]);
function toIso8601(value) {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function serializeLeadsToCsv(records, { includeBom = true } = {}) {
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [
    CSV_COLUMNS.map(([heading]) => heading),
    ...records.map((lead) => CSV_COLUMNS.map(([, accessor]) => typeof accessor === "function" ? accessor(lead) : lead[accessor]))
  ];
  return `${includeBom ? "\uFEFF" : ""}${rows.map((row) => row.map(escapeCell).join(",")).join("\n")}`;
}
function isOpenLead(lead) {
  return ![STATUSES.COMPLETED, STATUSES.LOST].includes(lead._status || normalizeStatus(lead.status));
}
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
function loadLeads() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return demoLeads.map(normalizeLead);
  try {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new TypeError("Stored leads must be an array");
    const normalized = parsed.map(normalizeLead);
    // Only migrate storage after the entire payload has parsed and normalized successfully.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    console.error("Unable to load stored leads; leaving storage unchanged.", error);
    return demoLeads.map(normalizeLead);
  }
}
function saveLeads() { localStorage.setItem(STORAGE_KEY, JSON.stringify(leads)); }
function localDateParts(date = new Date()) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}
function formatLocalCalendarDate(date = new Date()) {
  const { year, month, day } = localDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function parseCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day, date };
}
function calendarDayNumber({ year, month, day }) { return Math.floor(Date.UTC(year, month - 1, day) / 86400000); }
function classifyFollowUp(value, now = new Date()) {
  const followUp = parseCalendarDate(value);
  if (!followUp) return { state: "none", dayDifference: null, relativeLabel: "No follow-up date", exactDate: "" };
  const dayDifference = calendarDayNumber(followUp) - calendarDayNumber(localDateParts(now));
  const state = dayDifference < 0 ? "overdue" : dayDifference === 0 ? "today" : "future";
  const relativeLabel = dayDifference < -1 ? `${Math.abs(dayDifference)} days overdue`
    : dayDifference === -1 ? "1 day overdue"
      : dayDifference === 0 ? "Follow up today"
        : dayDifference === 1 ? "Tomorrow" : `In ${dayDifference} days`;
  const exactDate = followUp.date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return { state, dayDifference, relativeLabel, exactDate };
}
function isRealTimestamp(value) {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(new Date(value).getTime());
}
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
function calculateMetrics(records, now = new Date()) {
  const todayOrOverdue = (lead) => isOpenLead(lead) && ["today", "overdue"].includes(lead._followUp.state);
  const overdue = (lead) => isOpenLead(lead) && lead._followUp.state === "overdue";
  const bookedThisMonth = (lead) => {
    if (!isRealTimestamp(lead.bookedAt)) return false;
    const booked = new Date(lead.bookedAt);
    return booked.getFullYear() === now.getFullYear() && booked.getMonth() === now.getMonth();
  };
  const hasTrackedLoss = (lead) => lead.activities.some((activity) => activity.type === ACTIVITY_TYPES.LOST && isRealTimestamp(activity.activityAt));
  // Qualified outcomes are reconstructable closed-funnel events: a real bookedAt or a tracked Lost activity.
  const qualified = (lead) => isRealTimestamp(lead.bookedAt) || hasTrackedLoss(lead);
  const booked = records.filter((lead) => isRealTimestamp(lead.bookedAt)).length;
  const qualifiedCount = records.filter(qualified).length;
  return {
    open: records.filter(isOpenLead).length,
    needsAction: records.filter(todayOrOverdue).length,
    overdue: records.filter(overdue).length,
    bookedThisMonth: records.filter(bookedThisMonth).length,
    conversionRate: qualifiedCount ? (booked / qualifiedCount) * 100 : 0,
    qualifiedCount,
    predicates: { open: isOpenLead, "needs-action": todayOrOverdue, overdue, "booked-month": bookedThisMonth, conversion: qualified }
  };
}
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function normalizePhoneForMatch(phone) { return String(phone || "").replace(/\D/g, ""); }
function normalizeEmailForMatch(email) { return String(email || "").trim().toLocaleLowerCase(); }
function phonesMatch(first, second) {
  const a = normalizePhoneForMatch(first);
  const b = normalizePhoneForMatch(second);
  if (!a || !b) return false;
  if (a === b) return true;
  // Only compare a national significant number when the country code is explicit and
  // unambiguous: +1 plus ten NANP digits versus those same ten digits. We deliberately
  // do not strip arbitrary country codes because the stored records have no country metadata.
  const explicitNanp = (value, digits) => String(value || "").trim().startsWith("+1") && digits.length === 11;
  return explicitNanp(first, a) && b.length === 10 && a.slice(1) === b
    || explicitNanp(second, b) && a.length === 10 && b.slice(1) === a;
}
function normalizePhone(phone) { return normalizePhoneForMatch(phone); }
function isValidPhone(phone) { return /^\d{7,15}$/.test(normalizePhoneForMatch(phone)); }
function isValidEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function init() {
  leads = loadLeads();
  statuses.forEach((status) => [$("status"), $("filter-status")].forEach((el) => el.add(new Option(status, status))));
  priorities.forEach((priority) => [$("priority"), $("filter-priority")].forEach((el) => el.add(new Option(priority, priority))));
  leadTypes.forEach((type) => [$("leadType"), $("filter-lead-type")].forEach((el) => el.add(new Option(type, type))));
  CONTACT_METHODS.forEach((method) => $("lastContactMethod").add(new Option(method, method)));
  CONTACT_METHODS.forEach((method) => $("contact-method").add(new Option(method, method)));
  bindEvents();
  showAuthenticatedView();
}
function bindEvents() {
  $("login-form").addEventListener("submit", handleLogin);
  $("logout").addEventListener("click", () => { sessionStorage.removeItem(AUTH_KEY); showAuthenticatedView(); });
  $("lead-form").addEventListener("submit", handleSave);
  $("lead-form").addEventListener("input", clearDuplicateWarning);
  $("save-anyway").addEventListener("click", () => pendingDuplicateSave && persistLead(pendingDuplicateSave));
  $("review-duplicate").addEventListener("click", reviewDuplicate);
  $("cancel-edit").addEventListener("click", resetForm);
  ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup", "sort-by"].forEach((id) => $(id).addEventListener("input", render));
  $("clear-filters").addEventListener("click", clearFilters);
  document.querySelector(".dashboard").addEventListener("click", handleMetricFilter);
  $("export-all").addEventListener("click", () => exportCsv(leads, "restore-at-home-all-leads.csv"));
  $("export-filtered").addEventListener("click", () => exportCsv(filteredLeads, "restore-at-home-filtered-leads.csv"));
  $("lead-list").addEventListener("click", handleLeadListClick);
  $("contact-form").addEventListener("submit", handleContactSave);
  $("contact-dialog").addEventListener("keydown", trapDialogFocus);
  $("contact-dialog").addEventListener("close", restoreContactDialogFocus);
  document.querySelectorAll("[data-dialog-close]").forEach((button) => button.addEventListener("click", closeContactDialog));
  document.addEventListener("click", closeOpenMenus);
  document.addEventListener("keydown", handleGlobalKeydown);
}
function handleLogin(event) {
  event.preventDefault();
  if ($("password").value === DEMO_PASSWORD) { sessionStorage.setItem(AUTH_KEY, "true"); $("password").value = ""; showAuthenticatedView(); }
  else $("login-error").textContent = "Incorrect password.";
}
function showAuthenticatedView() {
  const authed = sessionStorage.getItem(AUTH_KEY) === "true";
  $("login-view").classList.toggle("hidden", authed);
  $("app-view").classList.toggle("hidden", !authed);
  if (authed) render();
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
function persistLead({ fields, existingId }) {
  if (saveInProgress) return;
  saveInProgress = true;
  $("save-lead").disabled = true;
  $("save-anyway").disabled = true;
  const previousLeads = leads;
  try {
    const existing = leads.find((lead) => lead.id === existingId);
  if (existing) {
    const now = new Date().toISOString();
    const activities = [...existing.activities];
    if (existing.status !== fields.status) {
      const specializedType = ({ [STATUSES.BOOKED]: ACTIVITY_TYPES.BOOKED, [STATUSES.COMPLETED]: ACTIVITY_TYPES.COMPLETED, [STATUSES.LOST]: ACTIVITY_TYPES.LOST })[fields.status];
      activities.push(createActivity(existing.id, specializedType || ACTIVITY_TYPES.STATUS_CHANGED, now, "", `${existing.status} → ${fields.status}`));
    }
    if (existing.nextFollowUp !== fields.nextFollowUp) activities.push(createActivity(existing.id, ACTIVITY_TYPES.FOLLOW_UP_CHANGED, now, "", describeFollowUpChange(existing.nextFollowUp, fields.nextFollowUp)));
    if (existing.lastContactedAt !== fields.lastContactedAt || existing.lastContactMethod !== fields.lastContactMethod) {
      activities.push(createActivity(existing.id, ACTIVITY_TYPES.CONTACTED, fields.lastContactedAt ? new Date(fields.lastContactedAt).toISOString() : now, fields.lastContactMethod, "Contact details updated"));
    }
    const updated = { ...existing, ...fields, activities };
    if (fields.status === STATUSES.BOOKED && !updated.bookedAt) updated.bookedAt = now;
    leads = leads.map((lead) => lead.id === existing.id ? updated : lead);
  } else {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const lead = normalizeLead({ id, createdAt: now, ...fields, bookedAt: fields.status === STATUSES.BOOKED ? now : "", activities: [createActivity(id, ACTIVITY_TYPES.LEAD_CREATED, now)] });
    leads = [lead, ...leads];
  }
    saveLeads();
    resetForm();
    render();
    announce(`${fields.name} ${existing ? "updated" : "created"} successfully.`);
  } catch (error) {
    leads = previousLeads;
    console.error("Unable to save lead.", error);
    $("form-error").textContent = "The lead could not be saved. Your entries have been preserved; try again.";
    announce("Lead could not be saved. Your entries have been preserved.");
  } finally {
    saveInProgress = false;
    $("save-lead").disabled = false;
    $("save-anyway").disabled = false;
  }
}
function createActivity(leadId, type, activityAt = new Date().toISOString(), contactMethod = "", note = "") {
  return { id: crypto.randomUUID(), leadId, type, activityAt, contactMethod: CONTACT_METHODS.includes(contactMethod) ? contactMethod : "", note, createdAt: new Date().toISOString() };
}
function describeFollowUpChange(previous, next) { return `${previous || "No date"} → ${next || "No date"}`; }
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
  scrollTo({ top: 0, behavior: "smooth" });
}
function toDateTimeLocal(value) { if (!value) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return Number.isNaN(date.getTime()) ? "" : new Date(date - offset).toISOString().slice(0, 16); }
function deleteLead(id) { if (confirm("Delete this lead?")) { leads = leads.filter((l) => l.id !== id); saveLeads(); render(); } }
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
  const details = card.querySelector(".lead-card-details");
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
  const updated = { ...existing, lastContactedAt: contactedAt, lastContactMethod: method, activities: [...existing.activities, createActivity(id, ACTIVITY_TYPES.CONTACTED, contactedAt, method, note)] };
  const nextLeads = leads.map((lead) => lead.id === id ? updated : lead);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLeads));
    leads = nextLeads;
  } catch (error) {
    console.error("Unable to save contact activity.", error);
    $("contact-error").textContent = "Contact activity could not be saved. Try again.";
    return;
  }
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
if (typeof document !== "undefined") init();
if (typeof module !== "undefined" && module.exports) module.exports = { normalizeStatus, serializeLeadsToCsv };
