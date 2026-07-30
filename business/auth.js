const crypto = require("node:crypto");

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;

function normalizeUsername(value) {
  return typeof value === "string" ? value.trim().normalize("NFKC").toLowerCase() : "";
}

function validateUsername(value) {
  const normalized = normalizeUsername(value);
  return { normalized, valid: normalized.length >= 3 && normalized.length <= 32 && USERNAME_RE.test(normalized) };
}

function passwordIsStrong(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128) return false;
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return `scrypt$${salt.toString("base64url")}$${crypto.scryptSync(password, salt, 32, { N: 16384 }).toString("base64url")}`;
}

function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded || "").split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText || typeof password !== "string") return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(saltText, "base64url"), expected.length, { N: 16384 });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function generateRecoveryCode(bytes = crypto.randomBytes(16)) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) throw new TypeError("Recovery codes require at least 128 bits");
  return bytes.toString("hex").toUpperCase().match(/.{1,4}/g).join("-");
}

function normalizeRecoveryCode(value) { return String(value || "").replace(/[^a-fA-F0-9]/g, "").toUpperCase(); }
function hashRecoveryCode(value, pepper) {
  if (!pepper) throw new Error("RECOVERY_CODE_PEPPER is required");
  return crypto.createHmac("sha256", pepper).update(normalizeRecoveryCode(value)).digest("base64url");
}
function safeEqualText(a, b) {
  const left = Buffer.from(String(a || "")); const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = { normalizeUsername, validateUsername, passwordIsStrong, hashPassword, verifyPassword, generateRecoveryCode, normalizeRecoveryCode, hashRecoveryCode, safeEqualText };
