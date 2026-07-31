import { normalizeStatus } from "./status.mjs";
import { normalizeContactMethod } from "./contact-method.mjs";

const toIso8601 = (value) => {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

export const CSV_COLUMNS = Object.freeze([
  ["Name", "name"], ["Phone", "phone"], ["Email", "email"], ["Location", "location"],
  ["Condition", "condition"], ["Notes", "notes"], ["Status", (lead) => normalizeStatus(lead.status)],
  ["Priority", "priority"], ["Lead type", "leadType"], ["Referral source", "referralSource"],
  ["Next action", "nextAction"], ["Follow-up date (YYYY-MM-DD)", "nextFollowUp"],
  ["Last contacted date/time (ISO 8601)", (lead) => toIso8601(lead.lastContactedAt)],
  ["Last contact method", (lead) => normalizeContactMethod(lead.lastContactMethod)], ["Booked date/time (ISO 8601)", (lead) => toIso8601(lead.bookedAt)],
  ["Created date/time (ISO 8601)", (lead) => toIso8601(lead.createdAt)]
]);

export function serializeLeadsToCsv(records, { includeBom = true } = {}) {
  const escapeCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [CSV_COLUMNS.map(([heading]) => heading), ...records.map((lead) =>
    CSV_COLUMNS.map(([, accessor]) => typeof accessor === "function" ? accessor(lead) : lead[accessor]))];
  return `${includeBom ? "\uFEFF" : ""}${rows.map((row) => row.map(escapeCell).join(",")).join("\n")}`;
}
