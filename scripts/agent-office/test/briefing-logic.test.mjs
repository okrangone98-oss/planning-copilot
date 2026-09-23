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
