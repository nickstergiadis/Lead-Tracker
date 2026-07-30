export const ACTIVITY_TYPES = Object.freeze({
  LEAD_CREATED: "Lead created", STATUS_CHANGED: "Status changed",
  FOLLOW_UP_CHANGED: "Follow-up changed", CONTACTED: "Contacted",
  BOOKED: "Booked", COMPLETED: "Completed", LOST: "Lost"
});

export function createActivity({ leadId, type, activityAt, contactMethod = "", note = "", id, createdAt }) {
  if (!leadId || !type || !activityAt || !id || !createdAt) throw new TypeError("Activity identifiers, type, and timestamps are required");
  return { id, leadId, type, activityAt, contactMethod, note, createdAt };
}

export function buildAutomaticActivities(previous, next, { id, now }) {
  const activities = [];
  const add = (type, note = "") => activities.push(createActivity({
    id: id(), leadId: next.id, type, activityAt: now, note, createdAt: now
  }));
  if (!previous) add(ACTIVITY_TYPES.LEAD_CREATED);
  else {
    if (previous.status !== next.status) add(
      [ACTIVITY_TYPES.BOOKED, ACTIVITY_TYPES.COMPLETED, ACTIVITY_TYPES.LOST].includes(next.status)
        ? next.status : ACTIVITY_TYPES.STATUS_CHANGED,
      `${previous.status} → ${next.status}`
    );
    if ((previous.nextFollowUp || "") !== (next.nextFollowUp || "")) {
      add(ACTIVITY_TYPES.FOLLOW_UP_CHANGED, `${previous.nextFollowUp || "No date"} → ${next.nextFollowUp || "No date"}`);
    }
  }
  return activities;
}
