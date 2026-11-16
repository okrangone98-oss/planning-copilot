import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../harness.mjs";

test("CLI parses the two supported job types and mock mode", () => {
  assert.deepEqual(parseArgs(["--job", "daily-briefing", "--mock"]), {
    jobType: "daily-briefing",
    mode: "mock",
    command: ""
  });
  assert.deepEqual(parseArgs(["--job", "agent-office-command", "--command", "홍보 기획"]), {
    jobType: "agent-office-command",
    mode: "oauth",
    command: "홍보 기획"
  });
});

test("CLI rejects missing commands and unknown switches with Korean guidance", () => {
  assert.throws(() => parseArgs(["--job", "agent-office-command"]), /--command/);
  assert.throws(() => parseArgs(["--job", "other"]), /지원하지 않는 작업/);
  assert.throws(() => parseArgs(["--unknown"]), /사용법/);
});
