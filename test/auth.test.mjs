import test from "node:test";
import assert from "node:assert/strict";
import auth from "../business/auth.js";

test("normalizes usernames and enforces conservative rules",()=>{assert.equal(auth.normalizeUsername("  Alice.Smith  "),"alice.smith");assert.equal(auth.validateUsername("ab").valid,false);assert.equal(auth.validateUsername("Alice Smith").valid,false);assert.equal(auth.validateUsername("alice_42").valid,true);});
test("normalized usernames provide a stable uniqueness key",()=>{assert.equal(auth.normalizeUsername("ALICE"),auth.normalizeUsername(" alice "));});
test("strong passwords and salted hashes are verified safely",()=>{assert.equal(auth.passwordIsStrong("short"),false);const hash=auth.hashPassword("Long-Unique-Password42!");assert.equal(auth.verifyPassword("Long-Unique-Password42!",hash),true);assert.equal(auth.verifyPassword("wrong",hash),false);});
test("recovery codes contain at least 128 bits and normalize readable groups",()=>{const bytes=Buffer.alloc(16,0xab),code=auth.generateRecoveryCode(bytes);assert.equal(code,"ABAB-ABAB-ABAB-ABAB-ABAB-ABAB-ABAB-ABAB");assert.equal(auth.normalizeRecoveryCode(code),"AB".repeat(16));assert.throws(()=>auth.generateRecoveryCode(Buffer.alloc(15)));});
test("keyed recovery hashes compare without storing the code",()=>{const hash=auth.hashRecoveryCode("AAAA-BBBB-CCCC-DDDD","pepper");assert.equal(hash.includes("AAAA"),false);assert.equal(auth.safeEqualText(hash,auth.hashRecoveryCode("aaaabbbbccccdddd","pepper")),true);assert.equal(auth.safeEqualText(hash,auth.hashRecoveryCode("FFFF-BBBB-CCCC-DDDD","pepper")),false);});
