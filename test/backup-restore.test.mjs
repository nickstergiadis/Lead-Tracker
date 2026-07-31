import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyBackup, createBackup, parseBackup } from "../business/backup.mjs";
import { normalizeLead } from "../app.js";

const fixtureUrl = new URL("./fixtures/fictional-leads-backup.json", import.meta.url);
const disposableProfile = () => new Map();

test("a JSON export restores every lead field and activity in a separate profile", async () => {
  const source = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const exported = JSON.parse(JSON.stringify(createBackup(source.leads, source.exportedAt)));
  const separateProfileStorage = disposableProfile();
  separateProfileStorage.set("restoreAtHomeLeads", JSON.stringify(applyBackup([], parseBackup(exported, normalizeLead), "replace")));

  const restored = JSON.parse(separateProfileStorage.get("restoreAtHomeLeads"));
  assert.deepEqual(restored, source.leads);
  assert.equal(restored.length, 4);
  assert.deepEqual(restored.map(({ status }) => status), ["New inquiry", "Contacted", "Booked", "Lost"]);
  assert.equal(restored.flatMap(({ activities }) => activities).length, 5);
});

test("Replace discards disposable profile data", async () => {
  const backup = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const disposable = [{ ...backup.leads[0], id: "disposable", name: "Disposable Lead" }];
  const restored = applyBackup(disposable, parseBackup(backup, normalizeLead), "replace");
  assert.deepEqual(restored, backup.leads);
  assert.equal(restored.some(({ id }) => id === "disposable"), false);
});

test("Merge keeps distinct profile data and lets the imported same-ID record win", async () => {
  const backup = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const localOnly = { ...backup.leads[0], id: "local-only", name: "Local Only" };
  const staleSameId = { ...backup.leads[0], name: "Stale Local Name", activities: [] };
  const restored = applyBackup([localOnly, staleSameId], parseBackup(backup, normalizeLead), "merge");
  assert.equal(restored.length, backup.leads.length + 1);
  assert.deepEqual(restored.find(({ id }) => id === backup.leads[0].id), backup.leads[0]);
  assert.deepEqual(restored.find(({ id }) => id === localOnly.id), localOnly);
});
