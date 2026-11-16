import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_LIMITS,
  addExpense,
  addExpenses,
  addSession,
  attendanceReport,
  createEmptyProjectWork,
  evidenceGap,
  expenseSummary,
  projectDigest,
  removeExpense,
  sanitizeProjectWork,
  sessionSummary,
  updateExpense,
  updateSession,
  nextAction
} from "../../../src/lib/projectOperations.mjs";
import {
  EXPENSE_IMPORT_SAMPLE,
  expensesToTsv,
  normalizeSpentAt,
  parseExpenseTable,
  readExpenseStatus,
  resolveBudgetLine,
  toExpenseInputs
} from "../../../src/lib/expenseImport.mjs";
import { budgetSummary, createEmptyGrantPlan, emptyBudgetLine } from "../../../src/lib/grantWorkflow.mjs";
import { buildWorkbrainMarkdown } from "../../../src/lib/davidWorkbrainExport.mjs";
import {
  buildWorkspaceArchive,
  createEmptyWorkspace,
  createProjectMeta,
  parseWorkspaceArchive
} from "../../../src/lib/projectWorkspace.mjs";

const NOW = "2026-11-15T09:00:00";
const PROJECT_ID = "prj_ledger";

function planWithBudget() {
  const plan = createEmptyGrantPlan();
  plan.programName = "관광두레 플러스";
  plan.budgetLines = [
    { ...emptyBudgetLine("b1"), category: "인건비", item: "외래강사비", unitCost: "250000", quantity: "4" },
    { ...emptyBudgetLine("b2"), category: "운영비", item: "재료비", unitCost: "100000", quantity: "2" },
    { ...emptyBudgetLine("b3"), category: "홍보비", item: "현수막", unitCost: "80000", quantity: "3" }
  ];
  return plan;
}

function workWithExpenses() {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addSession(work, { sequence: 1, capacity: 20, registered: 18, attended: 16 }, NOW).work;
  work = addSession(work, { sequence: 2, capacity: 20, registered: 15, attended: 12 }, NOW).work;
  const sessionId = work.sessions[0].id;
  work = addExpense(work, { budgetLineId: "b1", sessionId, spentAt: "2026-11-03", vendor: "두레 강사", description: "1회차 강사비", amount: 500000, status: "paid", evidenceChecked: true, evidenceRef: "카드전표 11/03" }, NOW).work;
  work = addExpense(work, { budgetLineId: "b2", spentAt: "2026-11-07", vendor: "양양문구", description: "준비물", amount: 120000, status: "pending" }, NOW).work;
  work = addExpense(work, { budgetLineId: "b2", spentAt: "2026-11-09", vendor: "이음터", description: "다과", amount: 60000, status: "paid", evidenceChecked: true }, NOW).work;
  work = addExpense(work, { budgetLineId: "b3", spentAt: "2026-11-10", vendor: "현수막집", description: "현수막 3장", amount: 260000, status: "paid" }, NOW).work;
  return work;
}

test("지출은 비목 id로 계획 행을 가리키고 추가·수정·삭제가 이력에 남는다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  const added = addExpense(work, { budgetLineId: "b1", spentAt: "2026-11-31", vendor: " 강사 ", description: " 강사비 ", amount: "250000", status: "이상함" }, NOW);
  assert.equal(added.error, "");
  assert.equal(added.expense.status, "planned", "알 수 없는 상태는 계획만으로 둔다");
  assert.equal(added.expense.spentAt, "", "달력에 없는 날짜는 버린다");
  assert.equal(added.expense.amount, 250000);
  assert.equal(added.expense.vendor, "강사");
  work = added.work;

  const updated = updateExpense(work, added.expense.id, { status: "paid", evidenceChecked: true, evidenceRef: "전표 12" }, { now: NOW, reason: "증빙 확인" });
  assert.equal(updated.expense.status, "paid");
  assert.equal(updated.work.changes[0].entityType, "expense");
  assert.equal(updated.work.changes[0].reason, "증빙 확인");
  assert.equal(updated.work.changes.some((entry) => entry.field === "상태" && entry.after === "집행 완료"), true);
  assert.equal(updated.work.changes.some((entry) => entry.field === "증빙 확인" && entry.after === "예"), true);

  const removed = removeExpense(updated.work, added.expense.id, NOW);
  assert.equal(removed.error, "");
  assert.equal(removed.work.expenses.length, 0);
  assert.equal(removeExpense(removed.work, "없음", NOW).error !== "", true);
});

test("비목별 계획 − 집행 = 잔액과 집행률·초과 경고를 한 번에 계산한다", () => {
  const plan = planWithBudget();
  const work = workWithExpenses();
  assert.equal(budgetSummary(plan).total, 1440000);
  const ledger = expenseSummary(work, plan);

  const labor = ledger.rows.find((row) => row.category === "인건비");
  assert.equal(labor.plan, 1000000);
  assert.equal(labor.paid, 500000);
  assert.equal(labor.spent, 500000);
  assert.equal(labor.balance, 500000);
  assert.equal(labor.rate, 50);
  assert.equal(labor.over, false);

  const operations = ledger.rows.find((row) => row.category === "운영비");
  assert.equal(operations.plan, 200000);
  assert.equal(operations.paid, 60000);
  assert.equal(operations.pending, 120000);
  assert.equal(operations.spent, 180000, "집행액은 집행 완료 + 지출 예정");
  assert.equal(operations.balance, 20000);

  const promotion = ledger.rows.find((row) => row.category === "홍보비");
  assert.equal(promotion.spent, 260000);
  assert.equal(promotion.balance, 240000 - 260000);
  assert.equal(promotion.over, true);
  assert.equal(promotion.rate, 108);

  assert.deepEqual(ledger.overRows, ["홍보비"]);
  assert.equal(ledger.over, true);
  assert.equal(ledger.total.plan, 1440000);
  assert.equal(ledger.total.spent, 940000);
  assert.equal(ledger.total.balance, 500000);
  assert.equal(ledger.expenseCount, 4);
  assert.equal(ledger.evidence.total, 4);
  assert.equal(ledger.evidence.checked, 2);
  assert.equal(ledger.evidence.missing, 2);
  assert.equal(ledger.evidence.missingAmount, 380000);
  assert.deepEqual(ledger.evidence.items.map((item) => item.description).sort(), ["준비물", "현수막 3장"]);
});

test("계획만 세운 지출은 잔액에서 빼지 않고, 비목을 잃은 지출은 합계에 남긴다", () => {
  const plan = planWithBudget();
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addExpense(work, { budgetLineId: "b2", description: "재료 예약금", amount: 50000, status: "planned" }, NOW).work;
  let ledger = expenseSummary(work, plan);
  const operations = ledger.rows.find((row) => row.category === "운영비");
  assert.equal(operations.spent, 0);
  assert.equal(operations.planned, 50000);
  assert.equal(operations.balance, 200000);
  assert.equal(ledger.plannedOnly, 50000);

  // 비목 행이 사라진 지출도 '비목 미지정'으로 금액을 잃지 않는다.
  work = addExpense(work, { budgetLineId: "사라진비목", description: "지난 사업 자료", amount: 30000, status: "paid" }, NOW).work;
  ledger = expenseSummary(work, plan);
  const unassigned = ledger.rows.find((row) => row.category === "비목 미지정");
  assert.equal(unassigned.spent, 30000);
  assert.equal(unassigned.plan, 0);
  assert.equal(unassigned.over, true);
  assert.equal(ledger.unassignedCount, 1);
  assert.equal(ledger.total.spent, 30000);
});

test("증빙 미확인은 집행 완료·지출 예정만 세고 계획만 건은 해당 없음이다", () => {
  let work = workWithExpenses();
  work = addExpense(work, { budgetLineId: "b1", description: "예약금", amount: 100000, status: "planned" }, NOW).work;
  const ledger = expenseSummary(work, planWithBudget());
  assert.equal(ledger.evidence.total, 4, "계획만 건은 증빙 대상이 아니다");
  assert.equal(ledger.evidence.missing, 2);

  const gap = evidenceGap(work);
  assert.equal(gap.missing, 2);
  assert.equal(gap.missingAmount, 380000);

  // 증빙을 모두 확인하면 증빙 권유는 사라지고 다음 순서(운영 업무 만들기)로 넘어간다.
  const cleared = work.expenses.reduce(
    (next, expense) => updateExpense(next, expense.id, { evidenceChecked: true }, { now: NOW }).work,
    work
  );
  assert.equal(evidenceGap(cleared).missing, 0);
  const meta = createProjectMeta({ id: PROJECT_ID, name: "관광두레 플러스", status: "running" });
  const entry = { projectId: PROJECT_ID, projectName: meta.name, meta, work, plan: planWithBudget() };
  assert.equal(nextAction([entry], NOW).kind, "evidence", "업무가 없어도 증빙 미확인을 먼저 권한다");
  assert.equal(nextAction([{ ...entry, work: cleared }], NOW).kind, "generate");
  assert.equal(nextAction([{ ...entry, work: cleared }], NOW).tab, "overview");
});

test("회차 인원 기록을 끄면 값을 보관한 채 집계에서만 뺀다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addSession(work, { sequence: 1, capacity: 20, registered: 18, attended: 16 }, NOW).work;
  work = addSession(work, { sequence: 2, capacity: 20, registered: 15, attended: 12 }, NOW).work;
  let summary = sessionSummary(work);
  assert.equal(summary.tracked, 2);
  assert.equal(summary.untracked, 0);
  assert.equal(summary.attended, 28);

  const second = work.sessions[1];
  const result = updateSession(work, second.id, { trackAttendance: false }, { now: NOW, reason: "인원 기록 끄기" });
  work = result.work;
  assert.equal(result.session.attended, 12, "끄더라도 적어 둔 값은 남는다");
  summary = sessionSummary(work);
  assert.equal(summary.tracked, 1);
  assert.equal(summary.untracked, 1);
  assert.equal(summary.attended, 16);
  assert.equal(summary.capacity, 20);

  // 다시 켜면 그대로 집계에 돌아온다.
  work = updateSession(work, second.id, { trackAttendance: true }, { now: NOW }).work;
  assert.equal(sessionSummary(work).attended, 28);
  // 새로 고친 저장값은 꺼진 선택을 그대로 지킨다(sanitize가 되살리지 않는다).
  const stored = sanitizeProjectWork({ ...work, sessions: work.sessions.map((session) => (session.id === second.id ? { ...session, trackAttendance: false } : session)) }, { projectId: PROJECT_ID });
  assert.equal(stored.sessions.find((session) => session.id === second.id).trackAttendance, false);
});

test("인원이 없던 예전 회차는 기록 꺼짐으로, 인원이 있던 회차는 그대로 집계한다", () => {
  const legacy = sanitizeProjectWork(
    {
      projectId: PROJECT_ID,
      sessions: [
        { id: "s1", sequence: 1, capacity: "20", registered: "18", attended: "16" },
        { id: "s2", sequence: 2 }
      ]
    },
    { projectId: PROJECT_ID, now: NOW }
  );
  assert.equal(legacy.sessions[0].trackAttendance, true);
  assert.equal(legacy.sessions[0].attended, 16);
  assert.equal(legacy.sessions[1].trackAttendance, false);
  assert.equal(legacy.sessions[1].capacity, null, "안 적은 인원은 0이 아니라 null");
  assert.equal(sessionSummary(legacy).attended, 16);
});

test("결과보고 연인원은 0명·미입력·집계 제외를 구분한다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addSession(work, { sequence: 1, capacity: 20, registered: 18, attended: 16, status: "done" }, NOW).work;
  // 실제로 0명이 온 회차
  work = addSession(work, { sequence: 2, capacity: 20, registered: 0, attended: 0, status: "done" }, NOW).work;
  // 인원 기록을 켰지만 아직 안 적은 회차
  work = addSession(work, { sequence: 3, trackAttendance: true }, NOW).work;
  // 인원 기록을 꺼 둔 회차(값은 있는데 집계 제외)
  work = addSession(work, { sequence: 4, capacity: 20, registered: 10, attended: 9 }, NOW).work;
  work = updateSession(work, work.sessions[3].id, { trackAttendance: false }, { now: NOW }).work;
  // 취소한 회차
  work = addSession(work, { sequence: 5, capacity: 20, registered: 12, attended: 11 }, NOW).work;
  work = updateSession(work, work.sessions[4].id, { status: "cancelled" }, { now: NOW }).work;

  const report = attendanceReport(work);
  assert.equal(report.sessionTotal, 5);
  assert.equal(report.cancelled, 1);
  assert.equal(report.tracked, 3, "1·2·3회차만 집계 대상");
  assert.equal(report.untracked, 1, "4회차는 기록 꺼짐");
  assert.equal(report.attended, 16, "16명 + 0명 + 미입력(0으로 세지 않음)");
  assert.equal(report.attendedDone, 16);
  assert.equal(report.zeroSessions, 1, "적힌 0명은 따로 센다");
  assert.equal(report.missingCount, 1);
  assert.deepEqual(report.missingSessions.map((session) => session.sequence), [3]);
  assert.equal(report.complete, false);

  const cleared = updateSession(work, report.missingSessions[0].id, { attended: 5 }, { now: NOW }).work;
  const complete = attendanceReport(cleared);
  assert.equal(complete.attended, 21);
  assert.equal(complete.complete, true);

  // 인원 기록을 아예 안 켠 사업은 '0명'이 아니라 '기록 없음'이다.
  const none = attendanceReport(sanitizeProjectWork({ sessions: [{ id: "s", sequence: 1 }] }));
  assert.equal(none.tracked, 0);
  assert.equal(none.attended, 0);
  assert.equal(none.complete, false);
});

test("시트 TSV를 지출 행으로 읽고 비목 이름을 계획 행 id로 맞춘다", () => {
  const parsed = parseExpenseTable(EXPENSE_IMPORT_SAMPLE);
  assert.equal(parsed.hadHeader, true);
  assert.equal(parsed.rowCount, 3);
  assert.equal(parsed.totalAmount, 418000);
  assert.deepEqual(parsed.rows.map((row) => row.status), ["paid", "paid", "pending"]);
  assert.equal(parsed.rows[0].spentAt, "2026-11-03");
  assert.equal(parsed.rows[0].amount, 48000);
  assert.deepEqual(parsed.warnings, [], "읽을 수 있는 표는 경고 없이 통과한다");

  const plan = planWithBudget();
  const { inputs, unmatched } = toExpenseInputs(parsed.rows, plan.budgetLines);
  assert.equal(unmatched.length, 0);
  assert.equal(inputs[0].budgetLineId, "b2", "운영비 → 운영비 행");
  assert.equal(inputs[2].budgetLineId, "b1", "인건비 → 인건비 행");
  assert.equal(inputs[0].description, "회차 준비물(포스트잇·마커)");
  assert.equal(inputs[0].evidenceRef, "카드전표 11/03");

  // CSV·Markdown 표·머리글 없는 표도 같은 결과로 읽는다.
  const csv = parseExpenseTable("사용일자,거래처,적요,금액,비목\n2026.11.3,양양문구,준비물,\"48,000\",운영비");
  assert.equal(csv.rowCount, 1);
  assert.equal(csv.rows[0].spentAt, "2026-11-03");
  assert.equal(csv.rows[0].amount, 48000);

  const markdown = parseExpenseTable("| 날짜 | 적요 | 금액 |\n| --- | --- | --- |\n| 2026/11/04 | 다과 | 30000 |");
  assert.equal(markdown.rowCount, 1);
  assert.equal(markdown.rows[0].description, "다과");

  const positional = parseExpenseTable("20261105\t문구점\t복사용지\t15000\t운영비\t재료비");
  assert.equal(positional.hadHeader, false);
  assert.equal(positional.rows[0].spentAt, "2026-11-05");
  assert.equal(positional.rows[0].amount, 15000);
});

test("읽지 못한 지출 줄은 버리지 않고 이유를 남긴다", () => {
  const parsed = parseExpenseTable("사용일자\t거래처\t적요\t금액\t비목\n2026-11-03\t문구점\t연필\t\t운영비\n2026-13-40\t카페\t간담회\t20000\t\n합계\t\t\t20000\t");
  assert.equal(parsed.rowCount, 1, "금액을 못 읽은 줄은 넣지 않는다");
  assert.match(parsed.warnings.join(" "), /금액을 숫자로 읽지 못해/);
  assert.match(parsed.warnings.join(" "), /합계 행으로 보고/);
  assert.equal(parsed.rows[0].vendor, "카페", "읽지 못한 날짜는 비워 두고 행은 살린다");
  assert.equal(parsed.rows[0].spentAt, "");
  assert.match(parsed.warnings.join(" "), /날짜/);
  assert.equal(parseExpenseTable("").warnings.length, 1);
});

test("날짜·상태 표기를 여러 가지로 읽는다", () => {
  assert.equal(normalizeSpentAt("2026-11-03"), "2026-11-03");
  assert.equal(normalizeSpentAt("2026. 11. 3."), "2026-11-03");
  assert.equal(normalizeSpentAt("2026/11/03"), "2026-11-03");
  assert.equal(normalizeSpentAt("2026-11-31"), "", "달력에 없는 날짜는 버린다");
  assert.equal(normalizeSpentAt("26.11.3"), "2026-11-03");
  assert.equal(readExpenseStatus("집행 완료"), "paid");
  assert.equal(readExpenseStatus("지출예정"), "pending");
  assert.equal(readExpenseStatus("예정"), "pending");
  assert.equal(readExpenseStatus("계획만"), "planned");
  assert.equal(readExpenseStatus(""), "");
});

test("비목 이름이 정확히 맞지 않아도 가까운 행을 찾고, 없으면 미지정으로 둔다", () => {
  const plan = planWithBudget();
  assert.equal(resolveBudgetLine({ category: "운영비", item: "재료비" }, plan.budgetLines).id, "b2");
  assert.equal(resolveBudgetLine({ category: " 운영비 " }, plan.budgetLines).id, "b2");
  assert.equal(resolveBudgetLine({ category: "", item: "외래강사비" }, plan.budgetLines).id, "b1");
  assert.equal(resolveBudgetLine({ category: "여비" }, plan.budgetLines), null);
  assert.equal(resolveBudgetLine({}, plan.budgetLines), null);
});

test("가져온 지출은 상한까지만 넣고, 같은 표를 다시 넣으면 화면에서 걸러 낼 수 있다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  const rows = Array.from({ length: WORK_LIMITS.expenses + 10 }, (_, index) => ({
    spentAt: "2026-11-03",
    description: `지출 ${index}`,
    amount: 1000,
    status: "paid"
  }));
  const result = addExpenses(work, rows, NOW);
  assert.equal(result.added, WORK_LIMITS.expenses);
  assert.equal(result.skipped, 10);
  assert.equal(result.work.expenses.length, WORK_LIMITS.expenses);
  assert.match(addExpenses(result.work, rows, NOW).error, /600/);

  // 같은 날짜·금액·적요를 찾아 중복을 가려내는 기준(화면의 건너뛰기와 같은 규칙)
  work = createEmptyProjectWork(PROJECT_ID);
  work = addExpenses(work, [{ spentAt: "2026-11-03", description: "준비물", amount: 48000, status: "paid" }], NOW).work;
  const duplicates = [{ spentAt: "2026-11-03", description: "준비물", amount: 48000, status: "paid" }]
    .filter((row) => work.expenses.some((expense) => expense.spentAt === row.spentAt && expense.amount === row.amount && expense.description === row.description));
  assert.equal(duplicates.length, 1);
});

test("지출 원장은 시트로 다시 복사할 수 있고 비목 이름으로 적힌다", () => {
  const plan = planWithBudget();
  const work = workWithExpenses();
  const tsv = expensesToTsv(work.expenses, plan.budgetLines);
  const [header, first] = tsv.split("\n");
  assert.equal(header, "사용일자\t거래처\t적요\t금액\t비목\t상태\t증빙\t비고");
  assert.match(first, /인건비/);
  assert.match(first, /집행 완료/);
  const roundTrip = parseExpenseTable(tsv);
  assert.equal(roundTrip.rowCount, 4);
  assert.equal(roundTrip.totalAmount, 940000);
});

test("결과보고·내보내기에 참석 연인원과 집행 현황이 함께 실린다", () => {
  const plan = planWithBudget();
  const work = workWithExpenses();
  const markdown = buildWorkbrainMarkdown({ plan, project: { projectName: "관광두레" }, work, now: new Date(NOW) });
  assert.match(markdown, /운영 실적·집행 현황/);
  assert.match(markdown, /참석 연인원/);
  assert.match(markdown, /28명/);
  assert.match(markdown, /홍보비/);
  assert.match(markdown, /미확인 2건/);

  // 운영 데이터가 없으면 빈 절을 만들지 않는다.
  const empty = buildWorkbrainMarkdown({ plan, project: {}, now: new Date(NOW) });
  assert.doesNotMatch(empty, /운영 실적·집행 현황/);
});

test("저장된 지출도 상태·금액·중복·상한을 다시 맞춘다", () => {
  const work = sanitizeProjectWork(
    {
      projectId: PROJECT_ID,
      sessions: [{ id: "ses_1", sequence: 1, trackAttendance: true, attended: "3" }],
      expenses: [
        { id: "e1", budgetLineId: "b1", sessionId: "ses_1", amount: "250000", status: "이상함", spentAt: "2026-11-31", evidenceChecked: "true" },
        { id: "e1", amount: 1000 },
        { budgetLineId: "b2", amount: -5000, sessionId: "없는회차", description: "음수" },
        { amount: "십만원", description: "읽을 수 없는 금액" }
      ]
    },
    { projectId: PROJECT_ID, now: NOW }
  );
  assert.equal(work.expenses.length, 3, "중복 id는 한 번만 남는다");
  assert.equal(work.expenses[0].amount, 250000);
  assert.equal(work.expenses[0].status, "planned");
  assert.equal(work.expenses[0].spentAt, "", "달력에 없는 날짜는 버린다");
  assert.equal(work.expenses[0].evidenceChecked, false, "문자열 true는 확인으로 보지 않는다");
  assert.equal(work.expenses[1].amount, 0, "음수는 0");
  assert.equal(work.expenses[1].sessionId, "", "없는 회차는 비운다");
  assert.equal(work.expenses[2].amount, 0);

  const many = sanitizeProjectWork({ expenses: Array.from({ length: 650 }, (_, index) => ({ id: `e${index}`, amount: 1000 })) });
  assert.equal(many.expenses.length, WORK_LIMITS.expenses);
});

test("백업 7은 지출 원장까지 담고, 예전 백업(v6 이하)은 지출 없이 그대로 복원한다", () => {
  const workspace = createEmptyWorkspace({ now: NOW });
  const id = workspace.projects[0].id;
  const work = workWithExpenses();
  const archive = buildWorkspaceArchive({
    workspace,
    entries: { [id]: { project: { projectName: "사업" }, grantPlan: planWithBudget(), work } },
    exportedAt: NOW
  });
  assert.equal(archive.version, 7);
  const parsed = parseWorkspaceArchive(JSON.parse(JSON.stringify(archive)), { now: NOW });
  assert.equal(parsed.entries[0].work.expenses.length, 4);
  assert.equal(parsed.entries[0].work.sessions[0].trackAttendance, true);

  const legacy = {
    version: 6,
    workspace: { schemaVersion: 2, activeProjectId: id, projects: workspace.projects },
    projects: [{ meta: workspace.projects[0], project: { projectName: "사업" }, grantPlan: planWithBudget() }]
  };
  const legacyParsed = parseWorkspaceArchive(legacy, { now: NOW });
  assert.equal(legacyParsed.entries[0].work, null, "지출이 없다고 복원을 막지 않는다");
  assert.equal(legacyParsed.entries[0].project.projectName, "사업");
});

test("시작 화면 묶음은 증빙 미확인과 다가오는 회차를 함께 센다", () => {
  let work = createEmptyProjectWork(PROJECT_ID);
  work = addExpense(work, { budgetLineId: "b1", description: "강사비", amount: 250000, status: "paid" }, NOW).work;
  work = addSession(work, { sequence: 1, title: "1회차", startAt: "2026-11-20T14:00", venue: "이음터" }, NOW).work;
  const entries = [
    {
      projectId: PROJECT_ID,
      projectName: "관광두레 플러스",
      meta: createProjectMeta({ id: PROJECT_ID, name: "관광두레 플러스", status: "running" }),
      work,
      plan: planWithBudget()
    }
  ];
  const digest = projectDigest(entries, NOW);
  assert.equal(digest.evidence.missing, 1);
  assert.equal(digest.evidence.amount, 250000);
  assert.equal(digest.upcomingSessions.length, 1);
  assert.equal(digest.upcomingSessions[0].days, 5);
  assert.equal(digest.upcomingSessions[0].venue, "이음터");
  assert.equal(digest.next.kind, "evidence", "증빙 미확인을 먼저 권한다");
});
