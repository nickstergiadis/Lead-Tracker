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
let leads = loadLeads();
let filteredLeads = [];
const $ = (id) => document.getElementById(id);

function normalizeStatus(value) {
  if (statuses.includes(value)) return value;
  return Object.hasOwn(STATUS_MIGRATIONS, value) ? STATUS_MIGRATIONS[value] : STATUSES.NEW_INQUIRY;
}
function isClosedStatus(value) {
  return [STATUSES.BOOKED, STATUSES.COMPLETED, STATUSES.LOST].includes(normalizeStatus(value));
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
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function normalizePhone(phone) { return phone.replace(/[\s().-]/g, ""); }
function isValidPhone(phone) { return /^\+?\d{7,15}$/.test(normalizePhone(phone)); }
function isValidEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function init() {
  statuses.forEach((status) => [$("status"), $("filter-status")].forEach((el) => el.add(new Option(status, status))));
  priorities.forEach((priority) => [$("priority"), $("filter-priority")].forEach((el) => el.add(new Option(priority, priority))));
  leadTypes.forEach((type) => [$("leadType"), $("filter-lead-type")].forEach((el) => el.add(new Option(type, type))));
  CONTACT_METHODS.forEach((method) => $("lastContactMethod").add(new Option(method, method)));
  bindEvents();
  showAuthenticatedView();
}
function bindEvents() {
  $("login-form").addEventListener("submit", handleLogin);
  $("logout").addEventListener("click", () => { sessionStorage.removeItem(AUTH_KEY); showAuthenticatedView(); });
  $("lead-form").addEventListener("submit", handleSave);
  $("cancel-edit").addEventListener("click", resetForm);
  ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup", "sort-by"].forEach((id) => $(id).addEventListener("input", render));
  $("clear-filters").addEventListener("click", clearFilters);
  $("export-all").addEventListener("click", () => exportCsv(leads, "restore-at-home-all-leads.csv"));
  $("export-filtered").addEventListener("click", () => exportCsv(filteredLeads, "restore-at-home-filtered-leads.csv"));
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
  if (!lead.name || !lead.phone || !lead.location || !lead.condition || !lead.status || !lead.priority || !lead.leadType) return "Please complete all required fields.";
  if (!isValidPhone(lead.phone)) return "Enter a valid phone number with 7 to 15 digits.";
  if (!isValidEmail(lead.email)) return "Enter a valid email address or leave email blank.";
  return "";
}
function handleSave(event) {
  event.preventDefault();
  const fields = getFormData();
  const error = validateLead(fields);
  if (error) { $("form-error").textContent = error; return; }
  const existing = leads.find((lead) => lead.id === $("lead-id").value);
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
  saveLeads(); resetForm(); render();
}
function createActivity(leadId, type, activityAt = new Date().toISOString(), contactMethod = "", note = "") {
  return { id: crypto.randomUUID(), leadId, type, activityAt, contactMethod: CONTACT_METHODS.includes(contactMethod) ? contactMethod : "", note, createdAt: new Date().toISOString() };
}
function describeFollowUpChange(previous, next) { return `${previous || "No date"} → ${next || "No date"}`; }
function resetForm() { $("lead-form").reset(); $("lead-id").value = ""; $("form-title").textContent = "Add lead"; $("save-lead").textContent = "Save lead"; $("cancel-edit").classList.add("hidden"); $("edit-history").classList.add("hidden"); $("form-error").textContent = ""; }
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
function getFilteredLeads() {
  const q = $("search").value.toLowerCase();
  const fields = ["name", "phone", "email", "location", "condition", "notes", "nextAction"];
  return leads.filter((lead) => fields.some((field) => String(lead[field] || "").toLowerCase().includes(q)))
    .filter((lead) => !$("filter-status").value || normalizeStatus(lead.status) === $("filter-status").value)
    .filter((lead) => !$("filter-referral").value || lead.referralSource === $("filter-referral").value)
    .filter((lead) => !$("filter-priority").value || lead.priority === $("filter-priority").value)
    .filter((lead) => !$("filter-lead-type").value || (lead.leadType || "New patient") === $("filter-lead-type").value)
    .filter((lead) => !$("filter-followup").value || lead.nextFollowUp === $("filter-followup").value)
    .sort(sortLeads);
}
function sortLeads(a, b) {
  const sort = $("sort-by").value;
  if (sort === "followup") return (a.nextFollowUp || "9999-12-31").localeCompare(b.nextFollowUp || "9999-12-31");
  if (sort === "status") return statuses.indexOf(normalizeStatus(a.status)) - statuses.indexOf(normalizeStatus(b.status));
  if (sort === "priority") return priorities.indexOf(b.priority) - priorities.indexOf(a.priority);
  return new Date(b.createdAt) - new Date(a.createdAt);
}
function render() { updateReferralFilters(); filteredLeads = getFilteredLeads(); renderDashboard(); renderDailyActions(); renderLeads(); }
function updateReferralFilters() {
  const current = $("filter-referral").value;
  $("filter-referral").innerHTML = '<option value="">All referral sources</option>';
  $("referral-options").innerHTML = "";
  [...new Set(leads.map((l) => l.referralSource).filter(Boolean))].sort().forEach((source) => { $("filter-referral").add(new Option(source, source)); $("referral-options").append(new Option(source)); });
  $("filter-referral").value = current;
}
function renderDashboard() {
  $("total-leads").textContent = leads.length;
  $("booked-leads").textContent = leads.filter((l) => normalizeStatus(l.status) === STATUSES.BOOKED).length;
  $("followup-leads").textContent = leads.filter((l) => normalizeStatus(l.status) === STATUSES.WAITING_FOR_REPLY).length;
  $("overdue-leads").textContent = leads.filter((l) => classifyFollowUp(l.nextFollowUp).state === "overdue" && !isClosedStatus(l.status)).length;
  $("upcoming-leads").textContent = leads.filter((l) => ["today", "future"].includes(classifyFollowUp(l.nextFollowUp).state)).length;
}
function followUpChip(followUp) {
  const exactDate = followUp.exactDate ? ` — ${followUp.exactDate}` : "";
  return `<span class="badge followup-badge followup-${followUp.state}" title="${escapeHtml(followUp.relativeLabel + exactDate)}" aria-label="${escapeHtml(followUp.relativeLabel + exactDate)}">${escapeHtml(followUp.relativeLabel)}</span>`;
}
function renderDailyActions() {
  const priorityRank = { High: 0, Medium: 1, Low: 2 };
  const actionLeads = leads.filter((lead) => {
    const state = classifyFollowUp(lead.nextFollowUp).state;
    return !isClosedStatus(lead.status) && (state === "overdue" || state === "today");
  }).sort((a, b) => {
    const dayOrder = classifyFollowUp(a.nextFollowUp).dayDifference - classifyFollowUp(b.nextFollowUp).dayDifference;
    return dayOrder || (priorityRank[a.priority] ?? 3) - (priorityRank[b.priority] ?? 3) || a.name.localeCompare(b.name);
  });
  $("daily-action-empty").classList.toggle("hidden", actionLeads.length > 0);
  $("daily-action-list").innerHTML = actionLeads.map((lead) => {
    const followUp = classifyFollowUp(lead.nextFollowUp);
    return `<article class="daily-action-row"><div class="daily-action-summary"><strong>${escapeHtml(lead.name)}</strong><span class="muted daily-action-detail">${escapeHtml(lead.condition)}</span></div><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${escapeHtml(lead.priority)}</span>${followUpChip(followUp)}<span class="exact-date">${escapeHtml(followUp.exactDate)}</span></article>`;
  }).join("");
}
function renderLeads() {
  $("result-count").textContent = filteredLeads.length;
  $("empty-state").classList.toggle("hidden", filteredLeads.length > 0);
  $("lead-list").innerHTML = filteredLeads.map((lead) => { const status = normalizeStatus(lead.status); const followUp = classifyFollowUp(lead.nextFollowUp); return `<article class="lead-card"><header><div><h3>${escapeHtml(lead.name)}</h3><p class="muted">${escapeHtml(lead.condition)}</p></div><span class="badge priority-pill priority-${lead.priority.toLowerCase()}">${lead.priority}</span></header><div class="badges"><span class="badge status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}">${escapeHtml(status)}</span><span class="badge type-${(lead.leadType || "New patient").toLowerCase().replace(/[^a-z0-9]+/g, "-")}">${escapeHtml(lead.leadType || "New patient")}</span>${lead.referralSource ? `<span class="badge referral-badge">${escapeHtml(lead.referralSource)}</span>` : ""}${followUpChip(followUp)}${followUp.exactDate ? `<span class="exact-date">${escapeHtml(followUp.exactDate)}</span>` : ""}</div><div class="card-grid"><span>☎ ${escapeHtml(lead.phone)}</span><span>✉ ${escapeHtml(lead.email || "No email")}</span><span>📍 ${escapeHtml(lead.location)}</span><span>Created ${formatDateTime(lead.createdAt)}</span><span><strong>Next action:</strong> ${escapeHtml(lead.nextAction || "None set")}</span><span><strong>Last contact:</strong> ${lead.lastContactedAt ? `${formatDateTime(lead.lastContactedAt)}${lead.lastContactMethod ? ` · ${escapeHtml(lead.lastContactMethod)}` : ""}` : "Not recorded"}</span></div>${lead.notes ? `<p>${escapeHtml(lead.notes)}</p>` : ""}<details class="lead-details"><summary>Activity details</summary>${activityHistoryMarkup(lead)}</details><div class="card-actions"><button class="secondary" onclick="editLead('${lead.id}')">Edit</button><button class="ghost" onclick="deleteLead('${lead.id}')">Delete</button></div></article>`; }).join("");
}
function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : escapeHtml(date.toLocaleString()); }
function activityHistoryMarkup(lead) {
  const sorted = [...lead.activities].sort((a, b) => new Date(b.activityAt) - new Date(a.activityAt));
  const items = (activities) => activities.length ? `<ol class="activity-list">${activities.map((activity) => `<li><strong>${escapeHtml(activity.type)}</strong><time datetime="${escapeHtml(activity.activityAt)}">${formatDateTime(activity.activityAt)}</time>${activity.contactMethod ? `<span>${escapeHtml(activity.contactMethod)}</span>` : ""}${activity.note ? `<p>${escapeHtml(activity.note)}</p>` : ""}</li>`).join("")}</ol>` : '<p class="muted">No activity recorded.</p>';
  return `<section class="activity-history" aria-label="Activity history"><h4>Recent activity</h4>${items(sorted.slice(0, 3))}${sorted.length > 3 ? `<details><summary>View full history (${sorted.length})</summary>${items(sorted)}</details>` : ""}</section>`;
}
function clearFilters() { ["search", "filter-status", "filter-referral", "filter-priority", "filter-lead-type", "filter-followup"].forEach((id) => $(id).value = ""); $("sort-by").value = "newest"; render(); }
function exportCsv(rows, filename) {
  const headers = ["Name", "Phone", "Email", "Location", "Referral source", "Lead type", "Condition", "Status", "Lead priority", "Next follow-up date", "Notes", "Created at"];
  const csvRows = [headers, ...rows.map((l) => [l.name, l.phone, l.email, l.location, l.referralSource, l.leadType || "New patient", l.condition, normalizeStatus(l.status), l.priority, l.nextFollowUp, l.notes, l.createdAt])]
    .map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click(); URL.revokeObjectURL(url);
}
init();
