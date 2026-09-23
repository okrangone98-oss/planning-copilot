import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleAdapters, runBriefing } from "../daily-briefing.mjs";

test("runBriefing composes injected readers and writes one KST report without OAuth or external writes", async (t) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "office-control-tower-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  let oauthCalls = 0;
  const result = await runBriefing({
    mode: "mock",
    config: { outputDir, aliasConfigPath: "automation/project-aliases.example.json", timezone: "Asia/Seoul" },
    now: new Date("2026-09-24T12:00:00+09:00"),
    provider: { getAuthorizedClient: async () => { oauthCalls += 1; throw new Error("OAuth must not run with injected adapters"); } },
    adapters: { calendar: async () => [], gmail: async () => [], projects: async () => [] }
  });

  assert.equal(oauthCalls, 0);
  assert.match(result.outputPath, /2026-09-24-daily-briefing\.md$/);
  assert.equal(result.briefing.collectionSummary.gmail, 0);
  assert.equal((await fs.readdir(outputDir)).length, 1);
  assert.match(await fs.readFile(result.outputPath, "utf8"), /## 오늘의 핵심 업무 3건/);
});


test("mock mode renders fixture sections, ignores newsletters, and merges cross-source duplicates", async (t) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "office-briefing-mock-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const result = await runBriefing({ mode: "mock", config: { outputDir, aliasConfigPath: "missing-aliases.json", timezone: "Asia/Seoul" }, now: new Date("2026-09-24T12:00:00+09:00") });
  const report = await fs.readFile(result.outputPath, "utf8");
  for (const heading of ["오늘의 핵심 업무 3건", "오늘 일정", "이번 주 마감업무", "회신/확인 필요한 이메일", "주의 사업", "향후 30일 주요 행사", "데이터 수집 요약", "확인 필요 및 한계"]) assert.match(report, new RegExp(`## ${heading}`));
  assert.equal(report.includes("Weekly newsletter"), false);
  assert.equal(report.includes("완료 사업"), false);
  assert.deepEqual(result.briefing.warningProjects.map((project) => project.status), ["RISK", "WARNING"]);
  assert.equal(result.briefing.coreTasks.find((task) => task.title === "웰컴센터").sources.length, 3);
});

test("createGoogleAdapters constructs only read-only clients and adapter calls", async () => {
  const calls = [];
  const googleClientFactory = () => ({
    calendar: (options) => ({ events: { list: async () => { calls.push(["calendar.events.list", options]); return { data: { items: [] } }; } } }),
    gmail: (options) => ({ users: { messages: { list: async () => { calls.push(["gmail.messages.list", options]); return { data: { messages: [] } }; }, get: async () => assert.fail("Gmail get must not run without messages") } } }),
    drive: (options) => ({ files: { list: async () => { calls.push(["drive.files.list", options]); return { data: { files: [] } }; } } }),
    sheets: (options) => ({ spreadsheets: { get: async () => assert.fail("Sheets get must not run without a selected file"), values: { get: async () => assert.fail("Sheets values.get must not run without a selected file") } } })
  });
  const client = { kind: "authorized" };
  const adapters = await createGoogleAdapters(client, { calendarId: "primary", timezone: "Asia/Seoul" }, googleClientFactory);
  await Promise.all([adapters.calendar({ now: new Date("2026-09-24T12:00:00+09:00"), detectedAt: "detected" }), adapters.gmail({ now: new Date("2026-09-24T12:00:00+09:00"), detectedAt: "detected" }), adapters.projects({ detectedAt: "detected" })]);
  assert.deepEqual(calls.map(([name]) => name), ["calendar.events.list", "gmail.messages.list", "drive.files.list"]);
  assert.ok(calls.every(([, options]) => options.auth === client));
  assert.ok(calls.every(([name]) => !/(insert|update|delete|create|send|modify)/i.test(name)));
});
