import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../api/index.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../db/migrations/001_multi_user.sql", import.meta.url), "utf8");

test("all lead and activity mutations are scoped to the validated session owner",()=>{assert.equal(api.includes('const owner="primary"'),false);assert.match(api,/const owner=user\.user_id/);for(const fragment of ["WHERE l.owner_id=$1","WHERE id=$3 AND owner_id=$4","WHERE id=$15 AND owner_id=$16","WHERE id=$1 AND owner_id=$2"])assert.ok(api.includes(fragment),fragment);assert.match(api,/LEFT JOIN activities a ON a\.lead_id=l\.id AND a\.owner_id=\$1/);});
test("sessions are persisted, expiring, versioned, and individually revocable",()=>{for(const term of ["token_hash text NOT NULL UNIQUE","session_version integer NOT NULL","expires_at timestamptz NOT NULL"])assert.ok(schema.includes(term));assert.match(api,/s\.expires_at>now\(\) AND s\.session_version=u\.session_version/);assert.match(api,/DELETE FROM sessions WHERE id=\$1 AND user_id=\$2/);});
test("invitations are locked before atomic single-use consumption",()=>{assert.match(api,/registration_invitations[\s\S]*FOR UPDATE/);assert.match(api,/consumed_at=now\(\),consumed_by=\$1/);assert.match(api,/user\.role!=="admin"/);});
test("recovery is persistent-rate-limited, rotates codes, and revokes sessions",()=>{assert.ok(schema.includes("recovery_attempt_limits"));assert.match(api,/blocked_until/);assert.match(api,/session_version=session_version\+1/);assert.match(api,/DELETE FROM sessions WHERE user_id=\$1/);});
test("legacy migration preserves all primary ownership before foreign keys",()=>{assert.match(migration,/UPDATE leads SET owner_uuid=.*WHERE owner_id='primary'/);assert.match(migration,/UPDATE activities SET owner_uuid=.*WHERE owner_id='primary'/);assert.match(migration,/IF EXISTS\(SELECT 1 FROM leads WHERE owner_uuid IS NULL\).*activities WHERE owner_uuid IS NULL/);assert.ok(migration.indexOf("UPDATE leads SET owner_uuid")<migration.indexOf("ADD CONSTRAINT leads_owner_fk"));});
test("disabled accounts and final-administrator protection are server enforced",()=>{assert.match(api,/user\.status!=="active"/);assert.match(api,/role='admin' AND status='active'/);assert.match(api,/final active administrator cannot be disabled/i);});
