import test from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_DIGEST_TITLE,
  buildBudgetDigestText,
  buildProjectDataText,
  replaceDigestSection
} from "../../../src/lib/projectDataReuse.mjs";
import { applyGridSpent, GRID_SPENT_LABEL, sheetRows, sheetTotals } from "../../../src/lib/budgetSheet.mjs";
import { createEmptyProjectWork, expenseSummary } from "../../../src/lib/projectOperations.mjs";
import { buildReportDocument } from "../../../src/lib/reportHwpx.mjs";
import { budgetSummary, formatWon } from "../../../src/lib/grantWorkflow.mjs";
import { extractFormFields } from "../../../src/lib/kordocFormSpec.mjs";
import { mapFreeTextToFields } from "../../../src/lib/smartTextMapper.mjs";
import { parseSampleTemplate } from "../../../src/lib/sampleTemplateParser.mjs";
import { PRACTICE_TEMPLATE_TEXT } from "../../../src/lib/practiceTemplate.mjs";

/* ── 공통 자료 ─────────────────────────────────────────────── */

function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    presetId: "",
    presetName: "",
    programName: "2027 양양 관광두레 플러스",
    agency: "양양군농촌활성화지원센터",
    fundingSource: "국고보조금",
    fundingYear: "2027",
    subsidyRate: "70",
    localRate: "20",
    selfRate: "10",
    budgetLines: [
      { id: "b1", category: "인건비", item: "외래강사비", unitCost: "250000", quantity: "8", basis: "250,000원 × 8회", note: "" },
      { id: "b2", category: "운영비", item: "재료비", unitCost: "100000", quantity: "2", basis: "100,000원 × 2회", note: "" }
    ],
    checklist: [],
    reportSections: [],
    schedule: {
      applyDeadline: "", projectStart: "2027-03-01", projectEnd: "2027-11-30",
      settlementDeadline: "", reportDeadline: "2027-12-15", memo: ""
    },
    memo: "",
    updatedAt: "",
    ...overrides
  };
}

/** 격자에서 집행액을 적은 뒤의 사업 작업 상태 — 원장에 '예산 관리표에서 입력' 한 건이 생긴다. */
function workWithGridSpent(plan) {
  const base = createEmptyProjectWork("p1");
  const result = applyGridSpent({
    work: base,
    updates: [{ lineId: "b1", amount: 500000 }],
    now: new Date("2026-11-16T10:00:00Z")
  });
  assert.equal(result.added, 1);
  return result.work;
}

/* ── 예산 관리표 숫자 → 서류 ───────────────────────────────── */

test("예산 관리표 숫자 블록은 총사업비·집행액·잔액·집행률과 비목별 금액을 담는다", () => {
  const plan = makePlan();
  const work = workWithGridSpent(plan);
  const digest = buildBudgetDigestText({ plan, work });
  const budget = budgetSummary(plan);
  const ledger = expenseSummary(work, plan);

  assert.match(digest.text, new RegExp(`^${BUDGET_DIGEST_TITLE}`));
  assert.match(digest.text, new RegExp(`총사업비: ${formatWon(budget.total)}`));
  assert.match(digest.text, new RegExp(`집행액: ${formatWon(500000)}`));
  assert.match(digest.text, new RegExp(`잔액: ${formatWon(budget.total - 500000)}`));
  assert.match(digest.text, new RegExp(`집행률: ${ledger.total.rate}%`));
  assert.match(digest.text, /인건비: 외래강사비 \(250,000원 × 8회\) 2,000,000원/);
  assert.match(digest.text, /외래강사비: 2,000,000원/);
  assert.equal(digest.counts.budgetLines, 2);
  assert.equal(digest.counts.expenseCount, 1);
  assert.deepEqual(digest.missing, []);
});

test("예산이 비어 있으면 0원으로 채우지 않고 비어 있는 항목으로 알린다", () => {
  const digest = buildBudgetDigestText({ plan: makePlan({ budgetLines: [] }), work: createEmptyProjectWork("p1") });
  assert.doesNotMatch(digest.text, /총사업비/);
  assert.equal(digest.counts.lines, 0);
  assert.ok(digest.missing.includes("총사업비"));
});

test("블록을 다시 넣어도 예산 관리표 구역은 쌓이지 않고 최신 값으로 바뀐다", () => {
  const plan = makePlan();
  const first = buildBudgetDigestText({ plan, work: workWithGridSpent(plan) });
  const userText = "사업명: 2027 양양 관광두레 플러스\n지역 현황: 빈집 120채";

  const once = replaceDigestSection(userText, first.text);
  assert.match(once.text, /^사업명: 2027 양양 관광두레 플러스/);
  assert.equal(once.removed, 0);

  const updated = buildBudgetDigestText({
    plan,
    work: applyGridSpent({ work: workWithGridSpent(plan), updates: [{ lineId: "b1", amount: 900000 }] }).work
  });
  const twice = replaceDigestSection(once.text, updated.text);
  assert.equal(twice.removed, 1);
  assert.equal(twice.text.split(BUDGET_DIGEST_TITLE).length - 1, 1, "예산 관리표 구역은 하나만 남는다");
  assert.match(twice.text, /집행액: 900,000원/);
  assert.doesNotMatch(twice.text, /집행액: 500,000원/);
  assert.match(twice.text, /지역 현황: 빈집 120채/, "사용자가 쓴 글은 그대로 둔다");

  const same = replaceDigestSection(twice.text, updated.text);
  assert.equal(same.changed, false);
});

test("결과보고 .hwpx 문서 모델의 예산 표에 격자 숫자가 그대로 들어간다", () => {
  const plan = makePlan();
  const work = workWithGridSpent(plan);
  const document = buildReportDocument({ plan, work, project: { projectName: "관광두레" } });

  const metaTotal = document.metaRows.find((row) => row.label === "총사업비");
  assert.equal(metaTotal.value, formatWon(2200000));
  const summary = document.summary.find((row) => row.label === "예산");
  assert.match(summary.value, /편성 2,200,000원 \/ 집행 500,000원 \/ 잔액 1,700,000원 \(집행률 23%\)/);

  assert.deepEqual(document.budget.headers, ["비목", "세목", "산출 근거", "계획(원)", "집행(원)"]);
  const instructor = document.budget.rows.find((row) => row[1] === "외래강사비");
  assert.deepEqual(instructor, ["인건비", "외래강사비", "250,000원 × 8회", "2,000,000", "500,000"]);
  assert.deepEqual(document.budget.total, ["합계", "", "", "2,200,000", "500,000"]);
  assert.deepEqual(document.warnings, []);
});

test("같은 숫자가 사업 데이터 글(2단계 붙여넣기)에도 들어간다", () => {
  const plan = makePlan();
  const work = workWithGridSpent(plan);
  const digest = buildProjectDataText({ meta: { name: "관광두레" }, plan, work, project: { projectName: "관광두레" } });
  assert.match(digest.text, /총사업비: 2,200,000원/);
  assert.match(digest.text, /집행 현황: 편성 2,200,000원 \/ 집행 500,000원 \/ 잔액 1,700,000원/);
  assert.match(digest.text, /소요 예산\n인건비: 외래강사비/);
});

test("양식의 총사업비·집행액·잔액·비목 칸이 예산 관리표 숫자로 채워진다", () => {
  const schema = parseSampleTemplate({ text: PRACTICE_TEMPLATE_TEXT, blocks: [], fileName: "연습양식.md", format: "markdown" });
  const fields = extractFormFields(schema);
  const plan = makePlan();
  const digest = buildBudgetDigestText({ plan, work: workWithGridSpent(plan) });
  const mapped = mapFreeTextToFields({ fields, text: digest.text });
  const byLabel = new Map(mapped.rows.map((row) => [row.label, row.proposed]));
  const joined = mapped.rows.map((row) => `${row.label}=${row.proposed}`).join(" | ");

  assert.match(byLabel.get("총사업비") ?? "", /2,200,000원/);
  assert.match(byLabel.get("인건비") ?? "", /외래강사비/);
  assert.match(byLabel.get("인건비") ?? "", /500,000원/, "비목별 집행액이 같은 줄에 남는다");
  // 양식에 '집행률' 같은 칸이 없으면 숫자를 버리지 않고 배치 못한 글로 남겨 사람이 보게 한다.
  const leftoverText = mapped.leftovers.map((item) => item.text).join(" | ");
  assert.ok(
    /집행률|23%|1,700,000원/.test(joined) || /23%|1,700,000원/.test(leftoverText),
    `양식에 자리가 없는 숫자도 화면 어딘가에 남아야 한다: ${joined} / ${leftoverText}`
  );
});

test("격자 합계와 결과보고·서류 블록 숫자가 같은 계산에서 나온다", () => {
  const plan = makePlan();
  const work = workWithGridSpent(plan);
  const totals = sheetTotals(sheetRows({ lines: plan.budgetLines, expenses: work.expenses }));
  const digest = buildBudgetDigestText({ plan, work });
  assert.match(digest.text, new RegExp(`편성 총액: ${formatWon(totals.plan)}`));
  assert.match(digest.text, new RegExp(`잔액: ${formatWon(totals.balance)}`));
  assert.equal(totals.spent, 500000);
  assert.equal(work.expenses[0].description, GRID_SPENT_LABEL);
});
