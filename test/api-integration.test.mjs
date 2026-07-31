import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;
let adminClient;
let schema;
let handler;

function response() {
  return { statusCode: 200, headers: {}, status(code) { this.statusCode=code; return this; }, setHeader(key,value) { this.headers[key.toLowerCase()]=value; }, send(payload) { this.payload=payload; return this; } };
}
async function request(path, method="GET", body={}, cookie="") {
  const res=response();
  await handler({ method, body, query:{ route:path.replace(/^\//,"") }, url:`/api${path}`, headers:{ cookie, "user-agent":"integration-test", "x-forwarded-for":"127.0.0.1" } },res);
  const parsed=res.headers["content-type"]?.includes("json")?JSON.parse(res.payload):res.payload;
  return { status:res.statusCode, body:parsed, cookie:String(res.headers["set-cookie"]||"").split(";")[0] };
}

before(async()=>{
  if(!databaseUrl)return;
  adminClient=new pg.Client({connectionString:databaseUrl}); await adminClient.connect();
  schema=`test_${crypto.randomBytes(8).toString("hex")}`;
  await adminClient.query(`CREATE SCHEMA ${schema}`);
  await adminClient.query(`SET search_path TO ${schema},public`);
  const ddl=await readFile(new URL("../db/schema.sql",import.meta.url),"utf8"); await adminClient.query(ddl);
  const separator=databaseUrl.includes("?")?"&":"?";
  process.env.DATABASE_URL=`${databaseUrl}${separator}options=-csearch_path%3D${schema}%2Cpublic`;
  process.env.SESSION_SECRET="integration-session-secret"; process.env.RECOVERY_CODE_PEPPER="integration-recovery-pepper"; process.env.INVITATION_PEPPER="integration-invitation-pepper";
  handler=(await import(`../api/index.js?schema=${schema}`)).default;
});
after(async()=>{if(!databaseUrl)return;await handler.closePool();await adminClient.query(`DROP SCHEMA ${schema} CASCADE`);await adminClient.end();});

integration("registration, login, recovery, sessions, and account isolation work together",async()=>{
  const auth=handler.auth;
  const admin=(await adminClient.query("INSERT INTO users(username_normalized,display_name,password_hash,role) VALUES('admin','Admin',$1,'admin') RETURNING id",[auth.hashPassword("Admin-password-unique-42!")])).rows[0];
  const codes=["INVITE-ACCOUNT-A","INVITE-ACCOUNT-B"];
  for(const code of codes)await adminClient.query("INSERT INTO registration_invitations(code_hash,created_by,expires_at) VALUES($1,$2,now()+interval '1 hour')",[crypto.createHmac("sha256",process.env.INVITATION_PEPPER).update(code).digest("base64url"),admin.id]);
  const register=async(username,code)=>request("/register","POST",{invitationCode:code,username,displayName:username.toUpperCase(),password:"Strong-unique-password-42!",passwordConfirmation:"Strong-unique-password-42!"});
  const a=await register("account-a",codes[0]),b=await register("account-b",codes[1]); assert.equal(a.status,201);assert.equal(b.status,201);assert.ok(a.body.recoveryCode);
  const login=await request("/login","POST",{username:"ACCOUNT-A",password:"Strong-unique-password-42!"});assert.equal(login.status,200);assert.ok(login.cookie);
  const session=await request("/session","GET",{},login.cookie);assert.equal(session.status,200);assert.equal(session.body.user.username,"account-a");
  const lead={name:"Only A",phone:"5551234567",email:"a@example.com",location:"Home",referralSource:"",condition:"Inquiry",status:"New inquiry",priority:"Low",leadType:"New patient",nextFollowUp:"",nextAction:"",lastContactedAt:"",lastContactMethod:"",notes:""};
  assert.equal((await request("/leads","POST",lead,login.cookie)).status,201);
  assert.equal((await request("/leads","GET",{},b.cookie)).body.leads.length,0);
  const recovered=await request("/recover-account","POST",{username:"account-a",recoveryCode:a.body.recoveryCode,newPassword:"Replacement-password-84!"});assert.equal(recovered.status,200);assert.ok(recovered.body.recoveryCode);
  assert.equal((await request("/session","GET",{},login.cookie)).status,401);
  assert.equal((await request("/login","POST",{username:"account-a",password:"Replacement-password-84!"})).status,200);
});
