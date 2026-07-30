export function normalizePhoneForMatch(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function normalizeEmailForMatch(email) {
  return String(email || "").trim().toLocaleLowerCase();
}

export function phonesMatch(first, second) {
  const a = normalizePhoneForMatch(first);
  const b = normalizePhoneForMatch(second);
  if (!a || !b) return false;
  if (a === b) return true;
  const explicitNanp = (value, digits) => String(value || "").trim().startsWith("+1") && digits.length === 11;
  return (explicitNanp(first, a) && b.length === 10 && a.slice(1) === b)
    || (explicitNanp(second, b) && a.length === 10 && b.slice(1) === a);
}

export function leadsMatch(first, second) {
  const firstEmail = normalizeEmailForMatch(first?.email);
  const secondEmail = normalizeEmailForMatch(second?.email);
  return phonesMatch(first?.phone, second?.phone)
    || (Boolean(firstEmail) && firstEmail === secondEmail);
}
