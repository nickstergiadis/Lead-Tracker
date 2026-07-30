import { STATUSES, normalizeStatus } from "./status.mjs";

export function isRealTimestamp(value) {
  return typeof value === "string" && value.trim() !== "" && !Number.isNaN(new Date(value).getTime());
}

export function isOpenLead(lead) {
  return ![STATUSES.COMPLETED, STATUSES.LOST].includes(lead._status || normalizeStatus(lead.status));
}

export function calculateMetrics(records, now = new Date()) {
  const todayOrOverdue = (lead) => isOpenLead(lead) && ["today", "overdue"].includes(lead._followUp?.state);
  const overdue = (lead) => isOpenLead(lead) && lead._followUp?.state === "overdue";
  const bookedThisMonth = (lead) => {
    if (!isRealTimestamp(lead.bookedAt)) return false;
    const booked = new Date(lead.bookedAt);
    return booked.getFullYear() === now.getFullYear() && booked.getMonth() === now.getMonth();
  };
  const hasTrackedLoss = (lead) => (lead.activities || []).some(
    (activity) => activity.type === "Lost" && isRealTimestamp(activity.activityAt)
  );
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
