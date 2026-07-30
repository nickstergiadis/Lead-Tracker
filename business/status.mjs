export const STATUSES = Object.freeze({
  NEW_INQUIRY: "New inquiry",
  CONTACTED: "Contacted",
  WAITING_FOR_REPLY: "Waiting for reply",
  BOOKED: "Booked",
  COMPLETED: "Completed",
  LOST: "Lost"
});

export const STATUS_VALUES = Object.freeze(Object.values(STATUSES));

export const STATUS_MIGRATIONS = Object.freeze({
  New: STATUSES.NEW_INQUIRY,
  "Follow-up needed": STATUSES.WAITING_FOR_REPLY,
  "Not a fit": STATUSES.LOST
});

export function normalizeStatus(value) {
  if (STATUS_VALUES.includes(value)) return value;
  return Object.hasOwn(STATUS_MIGRATIONS, value)
    ? STATUS_MIGRATIONS[value]
    : STATUSES.NEW_INQUIRY;
}
