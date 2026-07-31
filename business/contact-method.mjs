export const CONTACT_METHODS = Object.freeze(["Phone call", "Voicemail", "Email", "Text message", "Other"]);

export const CONTACT_METHOD_MIGRATIONS = Object.freeze({
  Phone: "Phone call",
  Text: "Text message",
  "In person": "Other"
});

export function normalizeContactMethod(value) {
  if (CONTACT_METHODS.includes(value)) return value;
  return CONTACT_METHOD_MIGRATIONS[value] || "";
}

export function normalizeLeadContactMethods(lead) {
  return {
    ...lead,
    lastContactMethod: normalizeContactMethod(lead.lastContactMethod),
    activities: Array.isArray(lead.activities) ? lead.activities.map((activity) => ({
      ...activity,
      contactMethod: normalizeContactMethod(activity.contactMethod)
    })) : lead.activities
  };
}
