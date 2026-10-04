import test from "node:test";
import assert from "node:assert/strict";
import { renderDailyBriefing } from "../lib/briefing-renderer.mjs";

test("renderDailyBriefing contains every required Korean section and source URL", () => {
  const markdown = renderDailyBriefing({
    generatedAt: "2026-09-24T03:00:00.000Z",
    dataAsOf: "2026-09-24T03:00:00.000Z",
    coreTasks: [{ title: "자료 확인", projectId: "P-WELCOME-2026", sources: [{ sourceUrl: "https://example.test/source" }] }],
    todayEvents: [], weekDeadlines: [], actionableEmails: [], warningProjects: [], majorEvents: [],
    collectionSummary: { calendar: 1, gmail: 2, sheets: 1 }, limitations: []
  });

  for (const heading of ["오늘의 핵심 업무 3건", "오늘 일정", "이번 주 마감업무", "회신/확인 필요한 이메일", "주의 사업", "향후 30일 주요 행사", "데이터 수집 요약", "확인 필요 및 한계"]) {
    assert.match(markdown, new RegExp(`## ${heading}`));
  }
  assert.match(markdown, /https:\/\/example\.test\/source/);
});

test("renderDailyBriefing bounds email snippets and omits full bodies", () => {
  const markdown = renderDailyBriefing({
    coreTasks: [], todayEvents: [], weekDeadlines: [], warningProjects: [], majorEvents: [],
    actionableEmails: [{ subject: "자료 확인", from: "담당자", receivedAt: "2026-09-24T01:00:00.000Z", category: "ACTION_REQUIRED", snippet: "가".repeat(400), body: "비공개 본문", projectId: "P-1" }],
    collectionSummary: {}, limitations: []
  });

  assert.equal(markdown.includes("비공개 본문"), false);
  assert.equal(markdown.includes("가".repeat(400)), false);
  assert.match(markdown, /P-1/);
});
