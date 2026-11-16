import test from "node:test";
import assert from "node:assert/strict";
import { clearControlTowerState, loadControlTowerState, saveControlTowerApproval, saveControlTowerSnapshot } from "../lib/control-tower-storage.mjs";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const snapshot = {
  schemaVersion: "1.0",
  generatedAt: "2026-09-24T00:00:00.000Z",
  run: { id: "run-test-001", jobType: "daily-briefing", status: "WAITING_APPROVAL", startedAt: "2026-09-24T00:00:00.000Z", summary: "업무 브리핑 1건" },
  steps: [],
  alerts: [],
  approvals: [{ id: "approval-1", title: "브리핑", summary: "검토", status: "pending" }],
  artifacts: [],
  sources: []
};

test("control tower snapshot and approval overlay survive reload under an isolated key", () => {
  const storage = new MemoryStorage();
  storage.setItem("planningCopilotProject", "keep-project");
  storage.setItem("planningCopilotApprovalItems", "keep-approvals");

  saveControlTowerSnapshot(snapshot, storage);
  saveControlTowerApproval(snapshot.run.id, "approval-1", "approved", storage);
  const loaded = loadControlTowerState(storage);

  assert.equal(loaded.snapshot.run.id, snapshot.run.id);
  assert.equal(loaded.approvals["run-test-001:approval-1"], "approved");
  assert.equal(storage.getItem("planningCopilotProject"), "keep-project");
  assert.equal(storage.getItem("planningCopilotApprovalItems"), "keep-approvals");
});

test("invalid state loads empty and clear removes only the control tower key", () => {
  const storage = new MemoryStorage();
  storage.setItem("planningCopilotControlTower", "{");
  storage.setItem("planningCopilotProject", "keep-project");

  assert.deepEqual(loadControlTowerState(storage), { snapshot: null, approvals: {} });
  clearControlTowerState(storage);
  assert.equal(storage.getItem("planningCopilotControlTower"), null);
  assert.equal(storage.getItem("planningCopilotProject"), "keep-project");
});
