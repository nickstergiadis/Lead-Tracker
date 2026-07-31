import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to verify the production migration");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
await client.connect();
try {
  const requiredTables = ["users", "sessions", "registration_invitations", "recovery_attempt_limits", "leads", "activities"];
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1)",[requiredTables]);
  const found = new Set(tables.rows.map(row=>row.table_name));
  const missing = requiredTables.filter(table=>!found.has(table));
  if (missing.length) throw new Error(`Production migration is incomplete; missing tables: ${missing.join(", ")}`);
  const owners = await client.query("SELECT table_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='owner_id' AND table_name=ANY($1)",[["leads","activities"]]);
  if (owners.rowCount!==2 || owners.rows.some(column=>column.data_type!=="uuid" || column.is_nullable!=="NO")) throw new Error("Production migration is incomplete; lead/activity owner_id must be a non-null UUID");
  const foreignKeys = await client.query("SELECT count(*)::int AS count FROM information_schema.table_constraints WHERE constraint_schema=current_schema() AND constraint_type='FOREIGN KEY' AND table_name=ANY($1)",[["leads","activities"]]);
  if (foreignKeys.rows[0].count<2) throw new Error("Production migration is incomplete; ownership foreign keys are missing");
  console.log("Production authentication and ownership migration verified.");
} finally { await client.end(); }
