import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const api = await readFile(new URL("../api/index.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
const migration = await readFile(new URL("../db/migrations/001_multi_user.sql", import.meta.url), "utf8");
const browser = await readFile(new URL("../app.js", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

test("all lead and activity mutations are scoped to the validated session owner",()=>{assert.equal(api.includes('const owner="primary"'),false);assert.match(api,/const owner=user\.user_id/);for(const fragment of ["WHERE l.owner_id=$1","WHERE id=$3 AND owner_id=$4","WHERE id=$15 AND owner_id=$16","WHERE id=$1 AND owner_id=$2"])assert.ok(api.includes(fragment),fragment);assert.match(api,/LEFT JOIN activities a ON a\.lead_id=l\.id AND a\.owner_id=\$1/);});
test("sessions are persisted, expiring, versioned, and individually revocable",()=>{for(const term of ["token_hash text NOT NULL UNIQUE","session_version integer NOT NULL","expires_at timestamptz NOT NULL"])assert.ok(schema.includes(term));assert.match(api,/s\.expires_at>now\(\) AND s\.session_version=u\.session_version/);assert.match(api,/DELETE FROM sessions WHERE id=\$1 AND user_id=\$2/);});
test("invitations are locked before atomic single-use consumption",()=>{assert.match(api,/registration_invitations[\s\S]*FOR UPDATE/);assert.match(api,/consumed_at=now\(\),consumed_by=\$1/);assert.match(api,/user\.role!=="admin"/);});
test("recovery is persistent-rate-limited, rotates codes, and revokes sessions",()=>{assert.ok(schema.includes("recovery_attempt_limits"));assert.match(api,/blocked_until/);assert.match(api,/session_version=session_version\+1/);assert.match(api,/DELETE FROM sessions WHERE user_id=\$1/);});
test("legacy migration preserves all primary ownership before foreign keys",()=>{assert.match(migration,/UPDATE leads SET owner_uuid=.*WHERE owner_id='primary'/);assert.match(migration,/UPDATE activities SET owner_uuid=.*WHERE owner_id='primary'/);assert.match(migration,/IF EXISTS\(SELECT 1 FROM leads WHERE owner_uuid IS NULL\).*activities WHERE owner_uuid IS NULL/);assert.ok(migration.indexOf("UPDATE leads SET owner_uuid")<migration.indexOf("ADD CONSTRAINT leads_owner_fk"));});
test("disabled accounts and final-administrator protection are server enforced",()=>{assert.match(api,/user\.status!=="active"/);assert.match(api,/role='admin' AND status='active'/);assert.match(api,/final active administrator cannot be disabled/i);});
test("browser authentication contracts exactly match public API routes",()=>{
  const contracts = [
    ["/login", "POST", ["username", "password"], 200],
    ["/register", "POST", ["invitationCode", "username", "displayName", "password", "passwordConfirmation"], 201],
    ["/recover-account", "POST", ["username", "recoveryCode", "newPassword"], 200]
  ];
  for (const [path, method, fields, status] of contracts) {
    assert.ok(browser.includes(`api("${path}", { method: "${method}"`), `${method} ${path} is called by the browser`);
    assert.ok(api.includes(`path==="${path}"&&req.method==="${method}"`), `${method} ${path} is implemented by the API`);
    for (const field of fields) assert.ok(browser.includes(`${field}:`), `${path} sends ${field}`);
    assert.match(api, new RegExp(`json\\(res,${status},`), `${path} exposes its documented success status`);
  }
  for (const property of ["recoveryCode", "authenticated", "user", "sessions", "invitations", "imported"]) assert.ok(browser.includes(property) && api.includes(property), `${property} agrees`);
});
test("every frontend API path has a backend route with the same HTTP method",()=>{
  const literalContracts = [
    ["/session","GET"],["/logout","POST"],["/security/password","POST"],["/security/recovery-code","POST"],
    ["/security/sessions","GET"],["/security/sessions/others","DELETE"],["/admin/invitations","GET"],
    ["/admin/invitations","POST"],["/admin/users","GET"],["/leads","GET"],["/leads","POST"],
    ["/import/preview","POST"],["/import","POST"],["/export","GET"]
  ];
  for(const [path,method] of literalContracts) {
    assert.ok(browser.includes(`api("${path}"`) || browser.includes(`fetch("/api${path}"`), `browser calls ${path}`);
    assert.ok(api.includes(`path==="${path}"&&req.method==="${method}"`), `API implements ${method} ${path}`);
  }
  assert.ok(browser.includes('existing ? "PUT" : "POST"') && api.includes('req.method==="PUT"'));
  assert.ok(browser.includes('method: "DELETE"') && api.includes('req.method==="DELETE"'));
  assert.match(browser,/api\(`\/leads\/\$\{[^}]+\}\/activity`/);assert.ok(api.includes("const match=path.match(") && api.includes("match[2]&&req.method===\"POST\""));
  assert.match(browser,/api\(`\/admin\/invitations\/\$\{id\}`/);assert.ok(api.includes("path.match(/^\\/admin\\/invitations"));
  assert.match(browser,/api\(`\/admin\/users\/\$\{id\}\/disable`/);assert.ok(api.includes("path.match(/^\\/admin\\/users"));
});
test("public auth rewrites precede the API catch-all and deployments fingerprint frontend assets",()=>{
  assert.deepEqual(vercel.rewrites.slice(0,2).map(route=>route.source), ["/api/register", "/api/recover-account"]);
  assert.equal(vercel.rewrites.at(-1).source, "/api/:path*");
  assert.equal(vercel.outputDirectory, "dist");
  assert.ok(vercel.headers.some(rule=>rule.source.includes("a-f0-9") && rule.headers.some(header=>header.value.includes("immutable"))));
});
