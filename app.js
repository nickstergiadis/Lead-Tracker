const STORAGE_KEY = "restoreAtHomeLeads";
const AUTH_KEY = "restoreAtHomeAuth";
const DEMO_PASSWORD = "restore-demo";
const statuses = ["New", "Contacted", "Booked", "Follow-up needed", "Not a fit", "Lost"];
const priorities = ["Low", "Medium", "High"];
const demoLeads = [
  { id: crypto.randomUUID(), createdAt: "2026-06-20T09:00:00.000Z", name: "Amelia Grant", phone: "303-555-0198", email: "amelia@example.com", location: "Boulder", referralSource: "Google", condition: "Hip pain after fall", status: "New", priority: "High", nextFollowUp: "2026-06-27", notes: "Prefers morning calls." },
  { id: crypto.randomUUID(), createdAt: "2026-06-18T14:30:00.000Z", name: "Marcus Lee", phone: "720-555-0144", email: "marcus@example.com", location: "Denver", referralSource: "Physician", condition: "Post-op knee rehab", status: "Booked", priority: "Medium", nextFollowUp: "2026-06-29", notes: "Booked initial visit." },
  { id: crypto.randomUUID(), createdAt: "2026-06-16T11:15:00.000Z", name: "Priya Shah", phone: "970-555-0122", email: "", location: "Longmont", referralSource: "Friend", condition: "Balance and gait support", status: "Follow-up needed", priority: "High", nextFollowUp: "2026-06-24", notes: "Left voicemail; call again." }
];
let leads = loadLeads();
let filteredLeads = [];
const $ = (id) => document.getElementById(id);

function loadLeads() { const saved = localStorage.getItem(STORAGE_KEY); return saved ? JSON.parse(saved) : demoLeads; }
function saveLeads() { localStorage.setItem(STORAGE_KEY, JSON.stringify(leads)); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function escapeHtml(value = "") { return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function normalizePhone(phone) { return phone.replace(/[\s().-]/g, ""); }
function isValidPhone(phone) { return /^\+?\d{7,15}$/.test(normalizePhone(phone)); }
function isValidEmail(email) { return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function init() {
  statuses.forEach((status) => [$("status"), $("filter-status")].forEach((el) => el.add(new Option(status, status))));
  priorities.forEach((priority) => [$("priority"), $("filter-priority")].forEach((el) => el.add(new Option(priority, priority))));
  bindEvents();
  showAuthenticatedView();
}
function bindEvents() {
  $("login-form").addEventListener("submit", handleLogin);
  $("logout").addEventListener("click", () => { sessionStorage.removeItem(AUTH_KEY); showAuthenticatedView(); });
  $("lead-form").addEventListener("submit", handleSave);
  $("cancel-edit").addEventListener("click", resetForm);
  ["search", "filter-status", "filter-referral", "filter-priority", "filter-followup", "sort-by"].forEach((id) => $(id).addEventListener("input", render));
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
  return { id: $("lead-id").value || crypto.randomUUID(), createdAt: $("lead-id").value ? leads.find((l) => l.id === $("lead-id").value)?.createdAt : new Date().toISOString(), name: $("name").value.trim(), phone: $("phone").value.trim(), email: $("email").value.trim(), location: $("location").value.trim(), referralSource: $("referralSource").value.trim(), condition: $("condition").value.trim(), status: $("status").value, priority: $("priority").value, nextFollowUp: $("nextFollowUp").value, notes: $("notes").value.trim() };
}
function validateLead(lead) {
  if (!lead.name || !lead.phone || !lead.location || !lead.condition || !lead.status || !lead.priority) return "Please complete all required fields.";
  if (!isValidPhone(lead.phone)) return "Enter a valid phone number with 7 to 15 digits.";
  if (!isValidEmail(lead.email)) return "Enter a valid email address or leave email blank.";
  return "";
}
function handleSave(event) {
  event.preventDefault();
  const lead = getFormData();
  const error = validateLead(lead);
  if (error) { $("form-error").textContent = error; return; }
  leads = leads.some((l) => l.id === lead.id) ? leads.map((l) => (l.id === lead.id ? lead : l)) : [lead, ...leads];
  saveLeads(); resetForm(); render();
}
function resetForm() { $("lead-form").reset(); $("lead-id").value = ""; $("form-title").textContent = "Add lead"; $("save-lead").textContent = "Save lead"; $("cancel-edit").classList.add("hidden"); $("form-error").textContent = ""; }
function editLead(id) { const lead = leads.find((l) => l.id === id); Object.entries(lead).forEach(([key, value]) => { if ($(key)) $(key).value = value; }); $("lead-id").value = id; $("form-title").textContent = "Edit lead"; $("save-lead").textContent = "Update lead"; $("cancel-edit").classList.remove("hidden"); scrollTo({ top: 0, behavior: "smooth" }); }
function deleteLead(id) { if (confirm("Delete this lead?")) { leads = leads.filter((l) => l.id !== id); saveLeads(); render(); } }
function getFilteredLeads() {
  const q = $("search").value.toLowerCase();
  const fields = ["name", "phone", "email", "location", "condition", "notes"];
  return leads.filter((lead) => fields.some((field) => lead[field].toLowerCase().includes(q)))
    .filter((lead) => !$("filter-status").value || lead.status === $("filter-status").value)
    .filter((lead) => !$("filter-referral").value || lead.referralSource === $("filter-referral").value)
    .filter((lead) => !$("filter-priority").value || lead.priority === $("filter-priority").value)
    .filter((lead) => !$("filter-followup").value || lead.nextFollowUp === $("filter-followup").value)
    .sort(sortLeads);
}
function sortLeads(a, b) {
  const sort = $("sort-by").value;
  if (sort === "followup") return (a.nextFollowUp || "9999-12-31").localeCompare(b.nextFollowUp || "9999-12-31");
  if (sort === "status") return a.status.localeCompare(b.status);
  if (sort === "priority") return priorities.indexOf(b.priority) - priorities.indexOf(a.priority);
  return new Date(b.createdAt) - new Date(a.createdAt);
}
function render() { updateReferralFilters(); filteredLeads = getFilteredLeads(); renderDashboard(); renderLeads(); }
function updateReferralFilters() {
  const current = $("filter-referral").value;
  $("filter-referral").innerHTML = '<option value="">All referral sources</option>';
  $("referral-options").innerHTML = "";
  [...new Set(leads.map((l) => l.referralSource).filter(Boolean))].sort().forEach((source) => { $("filter-referral").add(new Option(source, source)); $("referral-options").append(new Option(source)); });
  $("filter-referral").value = current;
}
function renderDashboard() {
  const today = todayISO();
  $("total-leads").textContent = leads.length;
  $("booked-leads").textContent = leads.filter((l) => l.status === "Booked").length;
  $("followup-leads").textContent = leads.filter((l) => l.status === "Follow-up needed").length;
  $("overdue-leads").textContent = leads.filter((l) => l.nextFollowUp && l.nextFollowUp < today && l.status !== "Booked").length;
  $("upcoming-leads").textContent = leads.filter((l) => l.nextFollowUp && l.nextFollowUp >= today).length;
}
function renderLeads() {
  $("result-count").textContent = filteredLeads.length;
  $("empty-state").classList.toggle("hidden", filteredLeads.length > 0);
  $("lead-list").innerHTML = filteredLeads.map((lead) => `<article class="lead-card"><header><div><h3>${escapeHtml(lead.name)}</h3><p class="muted">${escapeHtml(lead.condition)}</p></div><span class="badge ${lead.priority.toLowerCase()}">${lead.priority}</span></header><div class="badges"><span class="badge">${lead.status}</span>${lead.referralSource ? `<span class="badge">${escapeHtml(lead.referralSource)}</span>` : ""}${lead.nextFollowUp ? `<span class="badge">Follow up ${lead.nextFollowUp}</span>` : ""}</div><div class="card-grid"><span>☎ ${escapeHtml(lead.phone)}</span><span>✉ ${escapeHtml(lead.email || "No email")}</span><span>📍 ${escapeHtml(lead.location)}</span><span>Created ${new Date(lead.createdAt).toLocaleDateString()}</span></div>${lead.notes ? `<p>${escapeHtml(lead.notes)}</p>` : ""}<div class="card-actions"><button class="secondary" onclick="editLead('${lead.id}')">Edit</button><button class="ghost" onclick="deleteLead('${lead.id}')">Delete</button></div></article>`).join("");
}
function clearFilters() { ["search", "filter-status", "filter-referral", "filter-priority", "filter-followup"].forEach((id) => $(id).value = ""); $("sort-by").value = "newest"; render(); }
function exportCsv(rows, filename) {
  const headers = ["Name", "Phone", "Email", "Location", "Referral source", "Condition", "Status", "Lead priority", "Next follow-up date", "Notes", "Created at"];
  const csvRows = [headers, ...rows.map((l) => [l.name, l.phone, l.email, l.location, l.referralSource, l.condition, l.status, l.priority, l.nextFollowUp, l.notes, l.createdAt])]
    .map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click(); URL.revokeObjectURL(url);
}
init();
