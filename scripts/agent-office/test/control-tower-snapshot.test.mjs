import test from "node:test";
import assert from "node:assert/strict";
import { buildControlTowerSnapshot, validateControlTowerSnapshot } from "../lib/control-tower-snapshot.mjs";

const input = {
  generatedAt: "2026-09-24T00:00:00.000Z",
  run: { id: "run-test-001", jobType: "daily-briefing", status: "WAITING_APPROVAL", startedAt: "2026-09-24T00:00:00.000Z", summary: "메일 user@example.org 확인" },
  steps: [{ id: "read-gmail", label: "Gmail 조회", status: "SUCCEEDED", message: "010-2345-6789" }],
  alerts: [],
  approvals: [{ id: "brief", title: "브리핑", summary: "주민번호 900101-1234567", status: "pending" }],
  artifacts: [{ id: "brief-md", name: "Daily Briefing", mediaType: "text/markdown", path: "artifacts/daily-briefing.md" }],
  sources: [{ sourceType: "gmail", sourceUrl: "https://mail.google.com/mail/u/0/#all/abc", detectedAt: "2026-09-24T00:00:00.000Z" }],
  privateData: { access_token: "never-show-this", apiKey: "never-show-this-either" },
  email: { from: "person@example.org", body: "full private body", snippet: "private snippet", attachment: "private-file" }
};

test("snapshot removes credential/body fields and masks common personal identifiers", () => {
  const result = buildControlTowerSnapshot(input);
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes("never-show-this"), false);
  assert.equal(serialized.includes("full private body"), false);
  assert.equal(serialized.includes("private snippet"), false);
  assert.equal(serialized.includes("person@example.org"), false);
  assert.equal(serialized.includes("010-2345-6789"), false);
  assert.equal(serialized.includes("900101-1234567"), false);
  assert.equal(result.run.status, "WAITING_APPROVAL");
});

test("snapshot validator accepts v1 contract and rejects unknown versions", () => {
  const snapshot = buildControlTowerSnapshot(input);
  assert.equal(validateControlTowerSnapshot(snapshot).ok, true);
  assert.equal(validateControlTowerSnapshot({ ...snapshot, schemaVersion: "9.0" }).ok, false);
  assert.equal(validateControlTowerSnapshot({ run: {} }).ok, false);
});
