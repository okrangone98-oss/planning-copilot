import test from "node:test";
import assert from "node:assert/strict";
import { parseControlTowerSnapshot } from "../lib/control-tower-snapshot.mjs";
import { loadControlTowerState, saveControlTowerSnapshot } from "../lib/control-tower-storage.mjs";

const snapshot = {
  schemaVersion: "1.0",
  generatedAt: "2026-09-24T00:00:00.000Z",
  run: { id: "run-import-001", jobType: "agent-office-command", status: "WAITING_APPROVAL", startedAt: "2026-09-24T00:00:00.000Z", summary: "사무국 산출물 검토" },
  steps: [],
  alerts: [],
  approvals: [],
  artifacts: [],
  sources: []
};

class MemoryStorage {
  value = null;
  getItem() { return this.value; }
  setItem(_key, value) { this.value = String(value); }
  removeItem() { this.value = null; }
}

test("snapshot parser accepts the supported schema", () => {
  const result = parseControlTowerSnapshot(JSON.stringify(snapshot));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.run.id, snapshot.run.id);
});

test("bad JSON and unknown versions fail without replacing a valid saved snapshot", () => {
  const storage = new MemoryStorage();
  saveControlTowerSnapshot(snapshot, storage);

  assert.equal(parseControlTowerSnapshot("{").ok, false);
  assert.equal(parseControlTowerSnapshot(JSON.stringify({ ...snapshot, schemaVersion: "9.0" })).ok, false);
  assert.equal(loadControlTowerState(storage).snapshot.run.id, snapshot.run.id);
});
