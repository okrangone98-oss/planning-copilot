import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_WORK_SCHEMA_VERSION,
  WORK_LIMITS,
  addSession,
  addTask,
  appendChanges,
  applyBulkDateChanges,
  applyGeneration,
  buildChangeEntries,
  buildGenerationPreview,
  bulkDatePreview,
  cancelSession,
  createEmptyProjectWork,
  createRevision,
  groupTasksByStage,
  isProjectWorkEmpty,
  latestRevision,
  nextAction,
  projectDigest,
  removeTask,
  sanitizeProjectWork,
  sessionSummary,
  taskBuckets,
  taskDependencyState,
  updateSession,
  updateTask,
  workSummary
} from "../../../src/lib/projectOperations.mjs";
import { budgetSummary, createEmptyGrantPlan, emptyBudgetLine } from "../../../src/lib/grantWorkflow.mjs";
import {
  buildWorkspaceArchive,
  createEmptyWorkspace,
  createProjectMeta,
  parseWorkspaceArchive
} from "../../../src/lib/projectWorkspace.mjs";

const NOW = "2026-11-15T09:00:00";
const PROJECT_ID = "prj_test1";

function meta(overrides = {}) {
  return createProjectMeta({
    id: PROJECT_ID,
    name: "청년 관광두레 플러스",
    type: "national",
    status: "confirmed",
    startDate: "2026-03-01",
    endDate: "2026-12-20",
    createdAt: "2026-01-10T00:00:00Z",
    ...overrides
  });
}

function planWithBudget() {
  const plan = createEmptyGrantPlan();
  plan.programName = "관광두레 플러스";
  plan.budgetLines = [
    { ...emptyBudgetLine("b1"), category: "사업비", item: "강사비", unitCost: "100000", quantity: "2", basis: "", note: "" },
    { ...emptyBudgetLine("b2"), category: "운영비", item: "재료비", unitCost: "100000", quantity: "1", basis: "", note: "" }
  ];
  return plan;
}

function generated(work, options = {}) {
  const preview = buildGenerationPreview({ meta: meta(), plan: planWithBudget(), work, options });
  return applyGeneration({ work, preview, now: NOW, revision: 1 });
}

test("빈 운영 데이터는 사업 id와 함께 시작한다", () => {
  const work = createEmptyProjectWork(PROJECT_ID, NOW);
  assert.equal(work.schemaVersion, PROJECT_WORK_SCHEMA_VERSION);
  assert.equal(work.projectId, PROJECT_ID);
  assert.deepEqual(work.tasks, []);
  assert.deepEqual(work.sessions, []);
  assert.equal(isProjectWorkEmpty(work), true);
  assert.equal(isProjectWorkEmpty(sanitizeProjectWork(null, { projectId: PROJECT_ID })), true);
});

test("확정된 1회차 사업은 비회차 20개와 회차 업무 6개를 만든다", () => {
  const preview = buildGenerationPreview({ meta: meta(), plan: planWithBudget(), work: createEmptyProjectWork(PROJECT_ID) });
  assert.equal(preview.blocked, false);
  assert.equal(preview.confirmRequired, false);
  assert.equal(preview.counts.taskTotal, 26);
  assert.equal(preview.counts.newTasks, 26);
  assert.equal(preview.counts.newSessions, 1);
  assert.equal(preview.sessionCount, 1);
  assert.match(preview.tasks[0].sourceKey, /^phase1\.v1:plan:0:goal$/);
  assert.equal(preview.tasks.every((task) => task.dueDate.length === 10 || task.dueDate === ""), true);
  // 사업 기간이 있으니 일정 업무의 기한은 채워진다.
  assert.equal(preview.tasks.find((task) => task.stage === "plan").dueDate, "2026-02-09");
});

test("10회차 미리보기는 회차 업무 60개를 만든다", () => {
  const preview = buildGenerationPreview({
    meta: meta(),
    plan: planWithBudget(),
    work: createEmptyProjectWork(PROJECT_ID),
    options: { sessionCount: 10 }
  });
  assert.equal(preview.counts.taskTotal, 80);
  assert.equal(preview.counts.newSessions, 10);
  assert.equal(preview.tasks.filter((task) => task.sessionSequence > 0).length, 60);
});

test("같은 미리보기를 두 번 적용해도 업무가 겹치지 않는다", () => {
  const first = generated(createEmptyProjectWork(PROJECT_ID));
  assert.equal(first.error, "");
  assert.equal(first.added, 26);
  assert.equal(first.work.tasks.length, 26);
  assert.equal(first.work.sessions.length, 1);

  const preview = buildGenerationPreview({ meta: meta(), plan: planWithBudget(), work: first.work });
  assert.equal(preview.counts.newTasks, 0);
  assert.equal(preview.counts.keptTasks, 26);

  const second = applyGeneration({ work: first.work, preview, now: NOW, revision: 1 });
  assert.equal(second.error, "");
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 26);
  assert.equal(second.work.tasks.length, 26);
  assert.equal(new Set(second.work.tasks.map((task) => task.sourceKey)).size, 26);
  assert.equal(second.work.generations.length, 2);
});

test("회차를 추가하고 다시 만들면 새 회차 업무만 더한다", () => {
  const first = generated(createEmptyProjectWork(PROJECT_ID));
  const withSecond = addSession(first.work, { sequence: 2, startAt: "2026-06-06T10:00" }, NOW);
  assert.equal(withSecond.error, "");
  const second = generated(withSecond.work);
  assert.equal(second.added, 6);
  assert.equal(second.skipped, 26);
  assert.equal(second.work.tasks.length, 32);
  assert.equal(second.work.sessions.length, 2);
  const sessionTwoTasks = second.work.tasks.filter((task) => task.sessionId === withSecond.session.id);
  assert.equal(sessionTwoTasks.length, 6);
});

test("사용자가 고친 제목·기한·상태는 다시 만들 때 유지된다", () => {
  const first = generated(createEmptyProjectWork(PROJECT_ID));
  const target = first.work.tasks.find((task) => task.sourceKey.endsWith(":run:1:run-session"));
  const edited = updateTask(
    first.work,
    target.id,
    { title: "1회차 현장 운영(수정)", dueDate: "2026-06-05", status: "done" },
    { now: NOW, reason: "현장 일정 변경" }
  );
  assert.equal(edited.error, "");

  const preview = buildGenerationPreview({ meta: meta(), plan: planWithBudget(), work: edited.work });
  const applied = applyGeneration({ work: edited.work, preview, now: NOW, revision: 1 });
  assert.equal(applied.added, 0);
  const kept = applied.work.tasks.find((task) => task.id === target.id);
  assert.equal(kept.title, "1회차 현장 운영(수정)");
  assert.equal(kept.dueDate, "2026-06-05");
  assert.equal(kept.status, "done");
});

test("확정 전에는 미리보기만 되고 업무는 만들 수 없다", () => {
  const planning = meta({ status: "planning", startDate: "", endDate: "" });
  const preview = buildGenerationPreview({ meta: planning, plan: planWithBudget(), work: createEmptyProjectWork(PROJECT_ID) });
  assert.equal(preview.confirmRequired, true);
  assert.equal(preview.blocked, false);
  assert.equal(preview.counts.taskTotal, 26);
  assert.match(preview.warnings.join(" "), /확정 전/);

  const applied = applyGeneration({ work: createEmptyProjectWork(PROJECT_ID), preview, now: NOW });
  assert.match(applied.error, /확정/);
  assert.equal(applied.added, 0);
  assert.equal(applied.work.tasks.length, 0);

  const confirmedPreview = buildGenerationPreview({
    meta: meta({ status: "confirmed" }),
    plan: planWithBudget(),
    work: createEmptyProjectWork(PROJECT_ID)
  });
  const confirmed = applyGeneration({ work: createEmptyProjectWork(PROJECT_ID), preview: confirmedPreview, now: NOW });
  assert.equal(confirmed.error, "");
  assert.equal(confirmed.added, 26);
});

test("공고문이 없어도 확정·업무 생성이 된다", () => {
  const bare = meta({ type: "own", status: "confirmed", startDate: "", endDate: "", deadline: "" });
  const preview = buildGenerationPreview({ meta: bare, plan: createEmptyGrantPlan(), work: createEmptyProjectWork(PROJECT_ID) });
  assert.equal(preview.blocked, false);
  assert.equal(preview.counts.taskTotal, 26);
  assert.match(preview.warnings.join(" "), /기간/);
  const applied = applyGeneration({ work: createEmptyProjectWork(PROJECT_ID), preview, now: NOW });
  assert.equal(applied.added, 26);
});

test("완료·보류·취소 사업은 업무를 만들지 않는다", () => {
  for (const status of ["done", "hold", "cancelled"]) {
    const preview = buildGenerationPreview({ meta: meta({ status }), plan: null, work: createEmptyProjectWork(PROJECT_ID) });
    assert.equal(preview.blocked, true, status);
    assert.match(preview.blockedReason, /완료·보류·취소/);
    assert.equal(preview.tasks.every((task) => task.state === "blocked"), true);
    const applied = applyGeneration({ work: createEmptyProjectWork(PROJECT_ID), preview, now: NOW });
    assert.equal(applied.added, 0);
  }
});

test("10회차 집계는 정원·신청·참석을 취소 회차 없이 센다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  for (let sequence = 1; sequence <= 10; sequence += 1) {
    work = addSession(work, { sequence, capacity: 20, registered: 18, attended: 16 }, NOW).work;
  }
  let summary = sessionSummary(work);
  assert.equal(summary.total, 10);
  assert.equal(summary.capacity, 200);
  assert.equal(summary.registered, 180);
  assert.equal(summary.attended, 160);

  const third = work.sessions.find((session) => session.sequence === 3);
  work = cancelSession(work, third.id, { now: NOW }).work;
  summary = sessionSummary(work);
  assert.equal(summary.total, 10);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.active, 9);
  assert.equal(summary.capacity, 180);
  assert.equal(summary.registered, 162);
  assert.equal(summary.attended, 144);
});

test("회차 취소는 기록을 남기고 연결 업무를 보류로 둔다", () => {
  const first = generated(createEmptyProjectWork(PROJECT_ID));
  const session = first.work.sessions[0];
  const result = cancelSession(first.work, session.id, { now: NOW, reason: "강사 일정 취소" });
  assert.equal(result.error, "");
  assert.equal(result.session.status, "cancelled");
  assert.equal(result.held, 6);
  const linked = result.work.tasks.filter((task) => task.sessionId === session.id);
  assert.equal(linked.every((task) => task.status === "hold"), true);
  assert.equal(result.work.tasks.length, 26);
  assert.equal(result.work.changes[0].field, "상태");
  assert.equal(result.work.changes[0].reason, "강사 일정 취소");
  // 같은 회차를 다시 취소해도 아무것도 바뀌지 않는다.
  assert.equal(cancelSession(result.work, session.id, { now: NOW }).held, 0);
});

test("지연·오늘 마감·곧 마감을 갈라 센다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addTask(work, { title: "지난 업무", dueDate: "2026-11-13" }, NOW).work;
  work = addTask(work, { title: "오늘 업무", dueDate: "2026-11-15" }, NOW).work;
  work = addTask(work, { title: "곧 마감", dueDate: "2026-11-18" }, NOW).work;
  work = addTask(work, { title: "먼 업무", dueDate: "2026-12-20" }, NOW).work;
  work = addTask(work, { title: "끝난 업무", dueDate: "2026-11-10", status: "done" }, NOW).work;
  work = addTask(work, { title: "취소된 업무", status: "cancelled" }, NOW).work;

  const summary = workSummary(work, NOW);
  assert.equal(summary.total, 6);
  assert.equal(summary.active, 5);
  assert.equal(summary.open, 4);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.dueToday, 1);
  assert.equal(summary.dueSoon, 1);
  assert.equal(summary.byStatus.done, 1);
  assert.equal(summary.byStatus.cancelled, 1);
  assert.equal(summary.percent, 20);

  const buckets = taskBuckets(work, NOW);
  assert.deepEqual(buckets.overdue.map((task) => task.title), ["지난 업무"]);
  assert.deepEqual(buckets.today.map((task) => task.title), ["오늘 업무"]);
  assert.deepEqual(buckets.upcoming.map((task) => task.title), ["곧 마감"]);
  assert.equal(buckets.unscheduled.length, 0);
});

test("선행 업무가 끝나지 않으면 대기로 표시한다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  const prep = addTask(work, { title: "준비", status: "doing" }, NOW).work;
  const first = prep.tasks[0];
  const run = addTask(prep, { title: "실행", dependsOn: [first.id] }, NOW).work;
  const runTask = run.tasks[1];

  assert.equal(taskDependencyState(runTask, run).blocked, true);
  assert.deepEqual(taskDependencyState(runTask, run).pending.map((item) => item.title), ["준비"]);

  const done = updateTask(run, first.id, { status: "done" }, { now: NOW }).work;
  assert.equal(taskDependencyState(done.tasks[1], done).blocked, false);
  // 상한(5개)을 넘는 선행 업무는 잘라 낸다.
  const many = addTask(work, { title: "많음", dependsOn: ["a", "b", "c", "d", "e", "f", "g"] }, NOW);
  assert.equal(many.task.dependsOn.length, 5);
});

test("일괄 날짜 변경은 영향 건수를 먼저 보여 주고 적용한다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addTask(work, { title: "A", stage: "plan", dueDate: "2026-11-20" }, NOW).work;
  work = addTask(work, { title: "B", stage: "plan", dueDate: "2026-11-22" }, NOW).work;
  work = addTask(work, { title: "C", stage: "run", dueDate: "" }, NOW).work;

  const shift = bulkDatePreview(work, { scope: "all", mode: "shift", days: 3 });
  assert.equal(shift.error, "");
  assert.equal(shift.count, 2);
  assert.deepEqual(shift.items.map((item) => item.after), ["2026-11-23", "2026-11-25"]);
  // 적용 전에는 원본이 그대로다.
  assert.equal(work.tasks[0].dueDate, "2026-11-20");

  const applied = applyBulkDateChanges(work, shift, { now: NOW, reason: "사업 시작 연기" });
  assert.equal(applied.changed, 2);
  assert.equal(applied.work.tasks[0].dueDate, "2026-11-23");
  assert.equal(applied.work.changes[0].reason, "사업 시작 연기");
  assert.equal(applied.work.changes[0].before, "2026-11-20");

  const stageSet = bulkDatePreview(work, { scope: "stage", stage: "plan", mode: "set", date: "2026-12-01" });
  assert.equal(stageSet.count, 2);
  assert.equal(stageSet.items.every((item) => item.after === "2026-12-01"), true);

  // 날짜가 없으면 채우고, 바뀌지 않는 건수는 따로 센다.
  const allSet = bulkDatePreview(work, { mode: "set", date: "2026-11-20" });
  assert.equal(allSet.items.length, 3);
  assert.equal(allSet.unchanged, 1);
  assert.equal(allSet.count, 2);

  const invalid = bulkDatePreview(work, { mode: "set", date: "2026-13-40" });
  assert.equal(invalid.items.length, 0);
  assert.match(invalid.error, /날짜/);
});

test("저장된 운영 데이터는 상태·우선순위·상한을 다시 맞춘다", () => {
  const raw = {
    schemaVersion: 99,
    projectId: PROJECT_ID,
    tasks: [
      { id: "t1", title: "  공백 정리  ", status: "이상한상태", priority: "최고", dueDate: "2026-11-31", stage: "없는단계", sessionId: "ses_없음", dependsOn: ["a", "a", "b"] },
      { id: "t1", title: "중복 id" },
      { title: "id 없음" },
      { title: "긴 제목", completionCriteria: "가".repeat(500), title2: "x" }
    ],
    sessions: [
      { id: "s1", sequence: 999, capacity: "20", registered: -5, attended: "3", status: "이상함", startAt: "2026-13-01" },
      { id: "s1", sequence: 2 }
    ],
    revisions: [],
    changes: [],
    generations: [{ id: "g1", templateVersion: "phase1.v1", revision: -3, appliedAt: NOW, added: 3 }]
  };
  const work = sanitizeProjectWork(raw, { projectId: PROJECT_ID, now: NOW });
  assert.equal(work.tasks.length, 3);
  assert.equal(new Set(work.tasks.map((task) => task.id)).size, 3);
  assert.equal(work.tasks[0].title, "공백 정리");
  assert.equal(work.tasks[0].status, "planned");
  assert.equal(work.tasks[0].priority, "normal");
  assert.equal(work.tasks[0].dueDate, "");
  assert.equal(work.tasks[0].stage, "");
  assert.equal(work.tasks[0].sessionId, "");
  assert.deepEqual(work.tasks[0].dependsOn, ["a", "b"]);
  assert.equal(work.tasks[2].completionCriteria.length, 200);

  assert.equal(work.sessions.length, 1);
  assert.equal(work.sessions[0].sequence, 60);
  assert.equal(work.sessions[0].capacity, 20);
  assert.equal(work.sessions[0].registered, 0);
  assert.equal(work.sessions[0].status, "planned");
  assert.equal(work.sessions[0].startAt, "");
  assert.equal(work.generations[0].revision, 0);

  // 상한: 업무 400개까지만 남긴다.
  const many = sanitizeProjectWork({ tasks: Array.from({ length: 450 }, (_, index) => ({ id: `t${index}`, title: `업무${index}` })) });
  assert.equal(many.tasks.length, WORK_LIMITS.tasks);
});

test("업무 추가·수정·삭제가 상태와 완료일을 맞춘다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  const added = addTask(work, { title: "준비물 구매", dueDate: "2026-11-20", priority: "high" }, NOW);
  assert.equal(added.error, "");
  assert.equal(added.task.status, "planned");
  assert.equal(added.task.completedAt, "");
  work = added.work;

  const done = updateTask(work, added.task.id, { status: "done" }, { now: NOW });
  assert.equal(done.task.completedAt, new Date(NOW).toISOString());
  const reopened = updateTask(done.work, added.task.id, { status: "doing" }, { now: NOW });
  assert.equal(reopened.task.completedAt, "");

  const removed = removeTask(reopened.work, added.task.id, NOW);
  assert.equal(removed.error, "");
  assert.equal(removed.work.tasks.length, 0);
  assert.equal(removeTask(removed.work, "없음", NOW).error !== "", true);
});

test("변경 이력은 바뀐 값만 남기고 사유를 함께 보관한다", () => {
  const entries = buildChangeEntries({
    entityType: "meta",
    entityId: PROJECT_ID,
    before: { name: "옛 이름", status: "planning", goals: ["가"] },
    after: { name: "새 이름", status: "planning", goals: ["가", "나"] },
    fields: ["name", "status", "goals"],
    labels: { name: "사업명", status: "상태", goals: "목표" },
    reason: "이름 변경",
    now: NOW
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].field, "사업명");
  assert.equal(entries[0].before, "옛 이름");
  assert.equal(entries[0].after, "새 이름");
  assert.equal(entries[0].reason, "이름 변경");
  assert.equal(entries[1].field, "목표");
  assert.equal(entries[1].after, "가 · 나");
});

test("변경 이력은 300건까지만 남기고 최근 것이 앞에 온다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  const entries = Array.from({ length: 350 }, (_, index) => ({
    id: `chg${index}`,
    entityType: "task",
    entityId: "t1",
    field: "기한",
    before: "2026-01-01",
    after: "2026-01-02",
    reason: "",
    changedAt: NOW
  }));
  work = appendChanges(work, entries);
  assert.equal(work.changes.length, WORK_LIMITS.changes);
  assert.equal(work.changes[0].id, "chg0");

  // 업무 수정은 저장된 이력에 바로 쌓인다.
  const added = addTask(work, { title: "업무", dueDate: "2026-11-20" }, NOW);
  const updated = updateTask(added.work, added.task.id, { status: "done", dueDate: "2026-11-25" }, { now: NOW, reason: "일정 변경" });
  assert.equal(updated.work.changes[0].reason, "일정 변경");
  assert.equal(updated.work.changes.some((entry) => entry.field === "상태" && entry.after === "완료"), true);
});

test("리비전은 확정 시점 스냅샷과 승인일을 남긴다", () => {
  const work = createEmptyProjectWork(PROJECT_ID);
  const created = createRevision({
    work,
    meta: meta(),
    project: { coreIdea: "동네 관광 콘텐츠", activities: "10회 워크숍", budgetPlan: "총 3백만원" },
    grantPlan: planWithBudget(),
    reason: "1차 확정",
    now: NOW
  });
  assert.equal(created.revision.revision, 1);
  assert.equal(created.revision.reason, "1차 확정");
  assert.equal(created.revision.approvedAt, new Date(NOW).toISOString());
  assert.equal(created.revision.snapshot.plan.coreIdea, "동네 관광 콘텐츠");
  assert.equal(created.revision.snapshot.grant.budgetLines.length, 2);
  assert.equal(created.revision.snapshot.meta.goals.length, 0);

  const second = createRevision({ work: created.work, meta: meta(), project: {}, grantPlan: planWithBudget(), now: NOW });
  assert.equal(second.revision.revision, 2);
  assert.equal(latestRevision(second.work).revision, 2);

  let many = work;
  for (let index = 0; index < 25; index += 1) {
    many = createRevision({ work: many, meta: meta(), project: {}, grantPlan: planWithBudget(), now: NOW }).work;
  }
  assert.equal(many.revisions.length, WORK_LIMITS.revisions);
  assert.equal(latestRevision(many).revision, 25);
});

test("예산 금액은 운영 데이터에 복제하지 않는다", () => {
  const plan = planWithBudget();
  const total = budgetSummary(plan).total;
  assert.equal(total, 300000);

  const first = generated(createEmptyProjectWork(PROJECT_ID));
  const serialized = JSON.stringify({ tasks: first.work.tasks, sessions: first.work.sessions, revisions: first.work.revisions });
  assert.doesNotMatch(serialized, /unitCost|amount|100000|300000/);
  assert.equal(budgetSummary(plan).total, total);
});

test("다음 권장 행동은 지연 업무를 가장 먼저 고른다", () => {
  const overdueWork = addTask(createEmptyProjectWork("prj_a"), { title: "지연 업무", dueDate: "2026-11-10" }, NOW).work;
  const entries = [
    { projectId: "prj_a", projectName: "A 사업", meta: createProjectMeta({ id: "prj_a", name: "A 사업", status: "running" }), work: overdueWork },
    {
      projectId: "prj_b",
      projectName: "B 사업",
      meta: createProjectMeta({ id: "prj_b", name: "B 사업", status: "planning" }),
      work: createEmptyProjectWork("prj_b")
    }
  ];
  const action = nextAction(entries, NOW);
  assert.equal(action.kind, "overdue");
  assert.equal(action.projectId, "prj_a");
  assert.equal(action.label, "지연 업무");
  assert.equal(action.tab, "tasks");
  assert.match(action.detail, /지남/);

  const empty = nextAction([], NOW);
  assert.equal(empty, null);
});

test("다음 권장 행동은 확정 대기 → 업무 생성 → 예산 순으로 알려 준다", () => {
  const planning = {
    projectId: "prj_p",
    projectName: "기획 사업",
    meta: createProjectMeta({ id: "prj_p", name: "기획 사업", status: "planning" }),
    work: createEmptyProjectWork("prj_p")
  };
  assert.equal(nextAction([planning], NOW).kind, "confirm");

  const confirmedMeta = createProjectMeta({ id: "prj_c", name: "확정 사업", status: "confirmed" });
  const confirmed = { projectId: "prj_c", projectName: "확정 사업", meta: confirmedMeta, work: createEmptyProjectWork("prj_c") };
  assert.equal(nextAction([confirmed], NOW).kind, "generate");

  const runningWork = addTask(createEmptyProjectWork("prj_r"), { title: "운영 업무", dueDate: "2026-12-20" }, NOW).work;
  const running = {
    projectId: "prj_r",
    projectName: "운영 사업",
    meta: createProjectMeta({ id: "prj_r", name: "운영 사업", status: "running" }),
    work: runningWork,
    plan: createEmptyGrantPlan()
  };
  const budgetAction = nextAction([running], NOW);
  assert.equal(budgetAction.kind, "budget");
  assert.equal(budgetAction.section, "grantBudget");

  const withBudget = { ...running, plan: planWithBudget() };
  assert.equal(nextAction([withBudget], NOW), null);
});

test("시작 화면 묶음은 지연·오늘·진행 중 사업을 센다", () => {
  const lateWork = addTask(createEmptyProjectWork("prj_a"), { title: "지연", dueDate: "2026-11-10" }, NOW).work;
  const todayWork = addTask(createEmptyProjectWork("prj_b"), { title: "오늘", dueDate: "2026-11-15" }, NOW).work;
  const entries = [
    { projectId: "prj_a", projectName: "A", meta: createProjectMeta({ id: "prj_a", name: "A", status: "running" }), work: lateWork },
    { projectId: "prj_b", projectName: "B", meta: createProjectMeta({ id: "prj_b", name: "B", status: "preparing" }), work: todayWork },
    { projectId: "prj_c", projectName: "C", meta: createProjectMeta({ id: "prj_c", name: "C", status: "done" }), work: lateWork }
  ];
  const digest = projectDigest(entries, NOW);
  assert.equal(digest.overdue, 1);
  assert.equal(digest.dueToday, 1);
  assert.equal(digest.overdueItems.length, 1);
  assert.deepEqual(digest.running.map((item) => item.name), ["A", "B"]);
  assert.equal(digest.next.kind, "overdue");
});

test("업무는 단계 순서대로 묶인다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addTask(work, { title: "보고", stage: "report" }, NOW).work;
  work = addTask(work, { title: "기획", stage: "plan" }, NOW).work;
  work = addTask(work, { title: "기타" }, NOW).work;
  const groups = groupTasksByStage(work.tasks);
  assert.deepEqual(groups.map((group) => group.label), ["사업기획", "결과보고·환류", "기타"]);
});

test("회차 정보 수정은 변경 이력을 남긴다", () => {
  const work = addSession(createEmptyProjectWork(PROJECT_ID), { sequence: 1, capacity: 20 }, NOW).work;
  const session = work.sessions[0];
  const result = updateSession(work, session.id, { venue: "양양 이음터", capacity: 24 }, { now: NOW, reason: "장소 확정" });
  assert.equal(result.session.venue, "양양 이음터");
  assert.equal(result.work.changes.filter((entry) => entry.entityType === "session").length, 2);
  assert.equal(result.work.changes[0].reason, "장소 확정");
});

test("백업 7은 업무·회차를 담고, 6 이하 백업도 그대로 복원한다", () => {
  const workspace = createEmptyWorkspace({ now: NOW });
  const id = workspace.projects[0].id;
  const first = generated(createEmptyProjectWork(id));
  const archive = buildWorkspaceArchive({
    workspace,
    entries: { [id]: { project: { projectName: "사업" }, grantPlan: planWithBudget(), work: first.work } },
    exportedAt: NOW
  });
  assert.equal(archive.version, 7);
  const parsed = parseWorkspaceArchive(JSON.parse(JSON.stringify(archive)), { now: NOW });
  assert.equal(parsed.entries[0].work.tasks.length, 26);
  assert.equal(parsed.entries[0].work.sessions.length, 1);

  // v6 백업(work 없음)은 업무가 비어 있을 뿐 사업·예산은 그대로 살아난다.
  const legacyArchive = {
    version: 6,
    workspace: { schemaVersion: 2, activeProjectId: id, projects: workspace.projects },
    projects: [{ meta: workspace.projects[0], project: { projectName: "사업" }, grantPlan: planWithBudget() }]
  };
  const legacyParsed = parseWorkspaceArchive(legacyArchive, { now: NOW });
  assert.equal(legacyParsed.entries[0].work, null);
  assert.equal(legacyParsed.entries[0].project.projectName, "사업");
});
