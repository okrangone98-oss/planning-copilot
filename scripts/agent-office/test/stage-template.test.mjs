import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGES,
  STAGE_IDS,
  TEMPLATE_VERSION,
  buildSkeletonSessions,
  buildTemplateTasks,
  isStageId,
  listStages,
  stageIndex,
  stageLabel,
  taskSourceKey
} from "../../../src/lib/stageTemplate.mjs";

test("운영 단계 템플릿은 12단계 고정 순서를 가진다", () => {
  assert.equal(STAGES.length, 12);
  assert.deepEqual(STAGE_IDS, [
    "plan",
    "planBudget",
    "review",
    "resources",
    "promotion",
    "prep",
    "run",
    "issue",
    "evidence",
    "settlement",
    "evaluation",
    "report"
  ]);
  assert.equal(stageLabel("run"), "실행");
  assert.equal(stageIndex("prep"), 5);
  assert.equal(stageIndex("없는단계"), 12);
  assert.equal(isStageId("settlement"), true);
  assert.equal(isStageId("notice"), false);
});

test("단계마다 이름·목적·업무가 비어 있지 않다", () => {
  for (const stage of STAGES) {
    assert.ok(stage.label.trim().length > 0, `${stage.id} 이름`);
    assert.ok(stage.purpose.trim().length > 0, `${stage.id} 목적`);
    assert.ok(stage.tasks.length > 0, `${stage.id} 업무`);
    for (const task of stage.tasks) {
      assert.ok(task.slug.trim(), `${stage.id} slug`);
      assert.ok(task.title.trim(), `${stage.id}/${task.slug} 제목`);
      assert.ok(task.criteria.trim(), `${stage.id}/${task.slug} 완료 조건`);
    }
    assert.equal(new Set(stage.tasks.map((task) => task.slug)).size, stage.tasks.length);
  }
  const summary = listStages();
  assert.equal(summary.length, 12);
  assert.equal(summary.find((stage) => stage.id === "run").sessionScoped, true);
});

test("멱등 키는 템플릿·단계·회차·업무로만 정해진다", () => {
  const key = taskSourceKey({ stage: "run", sessionSequence: 3, slug: "run-session" });
  assert.equal(key, `${TEMPLATE_VERSION}:run:3:run-session`);
  assert.equal(key, taskSourceKey({ stage: "run", sessionSequence: 3, slug: "run-session" }));
  assert.notEqual(key, taskSourceKey({ stage: "run", sessionSequence: 4, slug: "run-session" }));
});

test("1회차 미리보기는 비회차 업무와 회차 업무를 한 벌 만든다", () => {
  const drafts = buildTemplateTasks({ sessionCount: 1 });
  // 비회차 20개 + 회차 업무 6개 = 26개
  assert.equal(drafts.length, 26);
  const sessionTasks = drafts.filter((draft) => draft.sessionSequence > 0);
  assert.equal(sessionTasks.length, 6);
  assert.ok(sessionTasks.every((draft) => draft.sourceKey.includes(":1:")));
  assert.equal(drafts.filter((draft) => draft.stage === "plan").length, 3);
  assert.equal(new Set(drafts.map((draft) => draft.sourceKey)).size, drafts.length);
});

test("10회차 미리보기는 회차 업무를 10벌 만든다", () => {
  const drafts = buildTemplateTasks({ sessionCount: 10 });
  assert.equal(drafts.length, 20 + 6 * 10);
  const sessionTasks = drafts.filter((draft) => draft.sessionSequence > 0);
  assert.equal(sessionTasks.length, 60);
  for (let sequence = 1; sequence <= 10; sequence += 1) {
    assert.equal(sessionTasks.filter((draft) => draft.sessionSequence === sequence).length, 6);
  }
  assert.equal(drafts.find((draft) => draft.sourceKey.endsWith(":run:1:run-session")).title, "1회차 운영");
  assert.equal(drafts.find((draft) => draft.sourceKey.endsWith(":run:10:run-session")).title, "10회차 운영");
});

test("건너뛴 단계는 업무를 만들지 않는다", () => {
  const drafts = buildTemplateTasks({ sessionCount: 1, skipStages: ["resources", "review", "promotion"] });
  assert.equal(drafts.filter((draft) => draft.stage === "resources").length, 0);
  assert.equal(drafts.filter((draft) => draft.stage === "review").length, 0);
  assert.equal(drafts.filter((draft) => draft.stage === "promotion").length, 0);
  assert.equal(drafts.length, 26 - 3 - 2 - 3);
  // 모르는 단계 id는 무시한다.
  assert.equal(buildTemplateTasks({ sessionCount: 1, skipStages: ["없는단계"] }).length, 26);
});

test("기한은 사업 기간·회차 날짜에서 계산한다", () => {
  const drafts = buildTemplateTasks({
    startDate: "2026-03-01",
    endDate: "2026-12-31",
    sessions: [{ sequence: 1, startAt: "2026-06-01T10:00" }, { sequence: 2, startAt: "2026-07-01" }]
  });
  const goal = drafts.find((draft) => draft.sourceKey.endsWith(":plan:0:goal"));
  assert.equal(goal.dueDate, "2026-02-09");
  const evidence = drafts.find((draft) => draft.sourceKey.endsWith(":evidence:0:evidence-check"));
  assert.equal(evidence.dueDate, "2026-12-11");
  const prep = drafts.find((draft) => draft.sourceKey.endsWith(":prep:1:prep-check"));
  assert.equal(prep.dueDate, "2026-05-29");
  const run = drafts.find((draft) => draft.sourceKey.endsWith(":run:2:run-session"));
  assert.equal(run.dueDate, "2026-07-01");
});

test("회차 날짜가 없으면 기한을 비워 두고, 선행 업무는 같은 회차 안에서 이어진다", () => {
  const drafts = buildTemplateTasks({ sessionCount: 2 });
  const prep = drafts.find((draft) => draft.sourceKey.endsWith(":prep:2:prep-check"));
  assert.equal(prep.dueDate, "");
  const run = drafts.find((draft) => draft.sourceKey.endsWith(":run:2:run-session"));
  assert.deepEqual(run.dependsOn, [taskSourceKey({ stage: "prep", sessionSequence: 2, slug: "prep-check" })]);
  // 단계를 건너뛰면 그 의존은 사라진다.
  const skipped = buildTemplateTasks({ sessionCount: 2, skipStages: ["prep"] });
  const runWithout = skipped.find((draft) => draft.sourceKey.endsWith(":run:2:run-session"));
  assert.deepEqual(runWithout.dependsOn, []);
});

test("회차 기본값은 번호와 제목만 있고 날짜는 비어 있다", () => {
  const sessions = buildSkeletonSessions(3);
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions[2], { sequence: 3, title: "3회차", startAt: "" });
  assert.equal(buildSkeletonSessions(0).length, 1);
  assert.equal(buildSkeletonSessions(999).length, 60);
});
