import crypto from "node:crypto";
import pg from "pg";
import auth from "../business/auth.js";

const [usernameInput, displayName, password] = process.argv.slice(2);
const { normalized, valid } = auth.validateUsername(usernameInput);
if (!process.env.DATABASE_URL || !process.env.BOOTSTRAP_TOKEN || process.env.BOOTSTRAP_TOKEN !== process.env.BOOTSTRAP_CONFIRM_TOKEN) throw new Error("Set matching BOOTSTRAP_TOKEN and BOOTSTRAP_CONFIRM_TOKEN for this one-time command");
if (!valid || !displayName || !auth.passwordIsStrong(password)) throw new Error("Usage: node scripts/bootstrap-admin.mjs <username> <display-name> <strong-password>");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const count = await client.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND status='active' AND password_hash<>'bootstrap-required'");
  if (count.rows[0].n) throw new Error("Bootstrap is permanently closed because an active administrator already exists");
  const legacy = await client.query("SELECT id FROM users WHERE username_normalized='legacy-admin' AND password_hash='bootstrap-required' FOR UPDATE");
  const recoveryCode = auth.generateRecoveryCode(crypto.randomBytes(16));
  if (legacy.rowCount) await client.query("UPDATE users SET username_normalized=$1,display_name=$2,password_hash=$3,recovery_code_hash=$4,role='admin',status='active',updated_at=now() WHERE id=$5",[normalized,displayName,auth.hashPassword(password),auth.hashRecoveryCode(recoveryCode,process.env.RECOVERY_CODE_PEPPER),legacy.rows[0].id]);
  else await client.query("INSERT INTO users(username_normalized,display_name,password_hash,recovery_code_hash,role) VALUES($1,$2,$3,$4,'admin')",[normalized,displayName,auth.hashPassword(password),auth.hashRecoveryCode(recoveryCode,process.env.RECOVERY_CODE_PEPPER)]);
  await client.query("COMMIT");
  process.stdout.write(`Administrator created. Save this one-time recovery code now:\n${recoveryCode}\n`);
} catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); await pool.end(); }
