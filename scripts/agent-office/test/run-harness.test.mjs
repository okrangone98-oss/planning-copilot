import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RetryableStepError } from "../lib/harness-contracts.mjs";
import { runHarness } from "../lib/run-harness.mjs";

function fixtureAdapter() {
  return {
    run: async () => ({
      summary: "세 단계 초안을 만들었습니다.",
      artifactName: "agent-office-report.md",
      artifactContent: "# AI 사무국 아침 보고",
      sources: [],
      approval: { title: "AI 사무국 산출물 검토", summary: "초안 3개 검토 필요" }
    })
  };
}

test("runHarness writes a complete approval-pending run without storing the command in event logs", async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "office-harness-run-"));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  const snapshot = await runHarness({
    jobType: "agent-office-command",
    command: "홍보 명령 개인@example.org",
    outputRoot,
    now: new Date("2026-09-24T09:00:00+09:00"),
    adapters: { "agent-office-command": fixtureAdapter(), sleep: async () => {} }
  });

  assert.equal(snapshot.run.status, "WAITING_APPROVAL");
  assert.equal(snapshot.run.jobType, "agent-office-command");
  assert.equal(snapshot.approvals[0].status, "pending");
  assert.equal((await fs.readFile(path.join(outputRoot, "runs", snapshot.run.id, "artifacts", "agent-office-report.md"), "utf8")), "# AI 사무국 아침 보고");
  const events = await fs.readFile(path.join(outputRoot, "runs", snapshot.run.id, "events.jsonl"), "utf8");
  assert.equal(events.includes("개인@example.org"), false);
  assert.equal((await fs.readFile(path.join(outputRoot, "control-tower-latest.json"), "utf8")).includes(snapshot.run.id), true);
});

test("runHarness retries only explicit transient errors at most twice", async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "office-harness-retry-"));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  let attempts = 0;
  const adapter = {
    run: async () => {
      attempts += 1;
      if (attempts < 3) throw new RetryableStepError("일시적인 연결 실패");
      return fixtureAdapter().run();
    }
  };

  const snapshot = await runHarness({
    jobType: "agent-office-command",
    command: "콘텐츠 기획",
    outputRoot,
    adapters: { "agent-office-command": adapter, sleep: async () => {} }
  });

  assert.equal(attempts, 3);
  assert.equal(snapshot.run.status, "WAITING_APPROVAL");
});

test("non-retryable errors need attention and unsupported jobs create no run", async (t) => {
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "office-harness-attention-"));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  let attempts = 0;
  const snapshot = await runHarness({
    jobType: "daily-briefing",
    outputRoot,
    adapters: { "daily-briefing": { run: async () => { attempts += 1; throw new Error("OAuth 설정을 확인하세요"); } } }
  });

  assert.equal(attempts, 1);
  assert.equal(snapshot.run.status, "NEEDS_ATTENTION");
  await assert.rejects(runHarness({ jobType: "unknown-job", outputRoot }), /지원하지 않는 작업/);
});
