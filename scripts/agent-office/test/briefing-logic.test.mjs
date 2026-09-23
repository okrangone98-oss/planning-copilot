import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyBriefing,
  computeProjectStatus,
  dedupeCandidates,
  isCompletedStatus
} from "../lib/briefing-logic.mjs";

test("completed projects never become new risk items", () => {
  assert.equal(isCompletedStatus("완료"), true);
  assert.equal(computeProjectStatus({ statusText: "완료", deadline: "2026-09-25" }, { today: "2026-09-24" }), "NORMAL");
});

test("D-3 incomplete work is RISK and D-7 incomplete work is WARNING", () => {
  assert.equal(computeProjectStatus({ statusText: "준비 중", deadline: "2026-09-27" }, { today: "2026-09-24" }), "RISK");
  assert.equal(computeProjectStatus({ statusText: "준비 중", deadline: "2026-10-01" }, { today: "2026-09-24" }), "WARNING");
});

test("dedupeCandidates merges repeated source candidates without losing sources", () => {
  const candidates = [
    { key: "P-WELCOME-2026|자료 확인", sources: [{ sourceId: "mail-1" }] },
    { key: "P-WELCOME-2026|자료 확인", sources: [{ sourceId: "sheet-1" }] }
  ];
  const result = dedupeCandidates(candidates);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].sources.map((source) => source.sourceId), ["mail-1", "sheet-1"]);
});

test("buildDailyBriefing attaches aliases without mutating inputs and excludes completed projects", () => {
  const projects = [
    { name: "환영행사", statusText: "준비 중", deadline: "2026-09-27", source: { sourceId: "sheet-1" } },
    { name: "종료 사업", statusText: "완료", deadline: "2026-09-25", source: { sourceId: "sheet-2" } }
  ];
  const emails = [{ subject: "환영행사 자료 확인 요청", category: "ACTION_REQUIRED", source: { sourceId: "mail-1" } }];

  const briefing = buildDailyBriefing({
    now: "2026-09-24T00:00:00+09:00",
    projects,
    emails,
    aliases: { "P-WELCOME-2026": ["환영행사"] }
  });

  assert.equal(projects[0].projectId, undefined);
  assert.equal(emails[0].projectId, undefined);
  assert.equal(briefing.warningProjects[0].projectId, "P-WELCOME-2026");
  assert.equal(briefing.warningProjects.some((project) => project.name === "종료 사업"), false);
  assert.equal(briefing.coreTasks.some((task) => task.projectId === "P-WELCOME-2026"), true);
});

test("buildDailyBriefing preserves status-only completion while keeping today's calendar list", () => {
  const projects = [
    { name: "ID 없는 완료 사업", status: "완료", deadline: "2026-09-25", source: { sourceId: "sheet-completed" } },
    { projectId: "P-COMPLETED", name: "완료 사업", status: "완료", deadline: "2026-09-25", source: { sourceId: "sheet-completed-id" } }
  ];
  const emails = [{ projectId: "P-COMPLETED", subject: "완료 사업 확인", category: "ACTION_REQUIRED", source: { sourceId: "mail-completed" } }];
  const events = [{ id: "event-completed", projectId: "P-COMPLETED", title: "완료 사업 성과공유회", start: "2026-09-24", end: "2026-09-24", allDay: true, source: { sourceId: "event-completed" } }];
  const originalInput = structuredClone({ projects, emails, events });

  const briefing = buildDailyBriefing({
    now: "2026-09-24T00:00:00+09:00",
    projects,
    emails,
    events
  });

  assert.equal(projects[1].status, "완료");
  assert.deepEqual({ projects, emails, events }, originalInput);
  assert.equal(computeProjectStatus({ status: "완료", deadline: "2026-09-25" }, { today: "2026-09-24" }), "NORMAL");
  assert.deepEqual(briefing.weekDeadlines, []);
  assert.deepEqual(briefing.actionableEmails, []);
  assert.deepEqual(briefing.warningProjects, []);
  assert.deepEqual(briefing.majorEvents, []);
  assert.equal(briefing.coreTasks.some((candidate) => candidate.projectId === "P-COMPLETED"), false);
  assert.deepEqual(briefing.todayEvents.map((event) => event.id), ["event-completed"]);
  assert.equal(briefing.todayEvents[0].projectId, "P-COMPLETED");
});

test("computeProjectStatus finds a later event overlapping an earlier long event", () => {
  const linkedEvents = [
    { start: "2026-09-24T09:00:00+09:00", end: "2026-09-24T12:00:00+09:00" },
    { start: "2026-09-24T10:00:00+09:00", end: "2026-09-24T10:30:00+09:00" },
    { start: "2026-09-24T11:00:00+09:00", end: "2026-09-24T11:30:00+09:00" }
  ];

  assert.equal(computeProjectStatus({ statusText: "진행 중" }, { today: "2026-09-24", linkedEvents }), "RISK");
});

test("buildDailyBriefing preserves direct email and event projectIds when no project state exists", () => {
  const briefing = buildDailyBriefing({
    now: "2026-09-24T00:00:00+09:00",
    emails: [{ projectId: "P-EXTERNAL", subject: "외부 사업 자료 확인", category: "ACTION_REQUIRED", source: { sourceId: "mail-external" } }],
    events: [{ id: "event-external", projectId: "P-CALENDAR", title: "외부 사업 간담회", start: "2026-09-24", end: "2026-09-24", allDay: true, source: { sourceId: "event-external" } }]
  });

  assert.deepEqual(briefing.coreTasks.map((candidate) => candidate.projectId), ["P-EXTERNAL", "P-CALENDAR"]);
});

test("compareCandidates uses source identity as a stable final tie-breaker", async () => {
  const { compareCandidates } = await import("../lib/briefing-logic.mjs");
  assert.equal(typeof compareCandidates, "function");

  const candidates = [
    { projectId: "P-1", key: "P-1|동일 후보", sources: [{ sourceType: "gmail", sourceId: "mail-z" }] },
    { projectId: "P-1", key: "P-1|동일 후보", sources: [{ sourceType: "gmail", sourceId: "mail-a" }] }
  ];

  assert.deepEqual([...candidates].sort(compareCandidates).map((candidate) => candidate.sources[0].sourceId), ["mail-a", "mail-z"]);
});
