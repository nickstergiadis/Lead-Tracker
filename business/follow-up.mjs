export function localDateParts(date = new Date()) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

export function formatLocalCalendarDate(date = new Date()) {
  const { year, month, day } = localDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day, date };
}

function calendarDayNumber({ year, month, day }) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function classifyFollowUp(value, now = new Date()) {
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

export function formatRelativeContact(value, now = new Date()) {
  const contact = new Date(value);
  if (!value || Number.isNaN(contact.getTime())) return "Not recorded";
  const dayDifference = calendarDayNumber(localDateParts(contact)) - calendarDayNumber(localDateParts(now));
  if (dayDifference === 0) return "Today";
  if (dayDifference === -1) return "Yesterday";
  if (dayDifference === 1) return "Tomorrow";
  return dayDifference < 0 ? `${Math.abs(dayDifference)} days ago` : `In ${dayDifference} days`;
}

function followUpRank(lead) {
  return lead?._followUp?.dayDifference ?? Number.POSITIVE_INFINITY;
}

export function compareFollowUpSoonest(a, b) {
  const aRank = followUpRank(a);
  const bRank = followUpRank(b);
  if (aRank === bRank) return 0;
  const aBucket = aRank === Number.POSITIVE_INFINITY ? 2 : aRank >= 0 ? 0 : 1;
  const bBucket = bRank === Number.POSITIVE_INFINITY ? 2 : bRank >= 0 ? 0 : 1;
  if (aBucket !== bBucket) return aBucket - bBucket;
  return aBucket === 0 ? aRank - bRank : bRank - aRank;
}

export function compareMostOverdue(a, b) {
  const aRank = followUpRank(a);
  const bRank = followUpRank(b);
  if (aRank === bRank) return 0;
  const aBucket = aRank < 0 ? 0 : 1;
  const bBucket = bRank < 0 ? 0 : 1;
  if (aBucket !== bBucket) return aBucket - bBucket;
  return aRank - bRank;
}
