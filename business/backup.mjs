export const BACKUP_FORMAT = "restore-at-home-leads";
export const BACKUP_VERSION = 1;

export function createBackup(leads, exportedAt = new Date().toISOString()) {
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt, leads };
}

export function parseBackup(value, normalizeLead) {
  if (!value || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION || !Array.isArray(value.leads)) {
    throw new TypeError("This is not a supported Restore at Home backup.");
  }
  const leads = value.leads.map(normalizeLead);
  if (new Set(leads.map((lead) => lead.id)).size !== leads.length) {
    throw new TypeError("The backup contains duplicate lead IDs.");
  }
  return leads;
}

export function applyBackup(currentLeads, importedLeads, mode) {
  if (mode === "replace") return [...importedLeads];
  if (mode !== "merge") throw new TypeError("Backup mode must be replace or merge.");
  return [...new Map([...currentLeads, ...importedLeads].map((lead) => [lead.id, lead])).values()];
}
