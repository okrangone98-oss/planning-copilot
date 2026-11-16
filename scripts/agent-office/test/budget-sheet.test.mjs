import test from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_SHEET_COLUMNS,
  GRID_SPENT_LABEL,
  applyBlockPaste,
  applyGridSpent,
  isGridSpentEntry,
  sheetExportRows,
  sheetRows,
  sheetSummaryLine,
  sheetToTsv,
  sheetTotals,
  spentByLine
} from "../../../src/lib/budgetSheet.mjs";
import { mergeBudgetLines, parseBudgetTable, pickBudgetFields } from "../../../src/lib/budgetImport.mjs";
import { createEmptyProjectWork, addExpenses } from "../../../src/lib/projectOperations.mjs";

/* ── 공통 자료 ─────────────────────────────────────────────── */

function line(id, category, item, unitCost, quantity, extra = {}) {
  return { id, category, item, unitCost, quantity, basis: "", note: "", ...extra };
}

function work(expenses) {
  return { ...createEmptyProjectWork("p1"), expenses };
}

function expense(id, budgetLineId, amount, overrides = {}) {
  return {
    id,
    budgetLineId,
    sessionId: "",
    spentAt: "2026-11-03",
    vendor: "",
    description: "준비물",
    amount,
    status: "paid",
    evidenceRef: "",
    evidenceNote: "",
    evidenceChecked: false,
    createdAt: "2026-11-03T00:00:00.000Z",
    updatedAt: "2026-11-03T00:00:00.000Z",
    ...overrides
  };
}

const LINES = [
  line("b1", "인건비", "외래강사비", "250000", "8"),
  line("b2", "운영비", "재료비", "100000", "2")
];

/* ── 격자 행·합계 ──────────────────────────────────────────── */

test("격자 열은 brief의 순서(비목·세목·단가·수량·편성액·집행액·잔액·산출근거·비고)를 지킨다", () => {
  assert.deepEqual(
    BUDGET_SHEET_COLUMNS.map((column) => column.label),
    ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출근거", "비고"]
  );
  assert.deepEqual(
    BUDGET_SHEET_COLUMNS.filter((column) => column.kind === "calc").map((column) => column.key),
    ["amount", "balance"]
  );
});

test("편성액은 단가×수량, 잔액은 편성액−집행액으로 계산한다", () => {
  const rows = sheetRows({ lines: LINES, expenses: [expense("e1", "b1", 500000)] });
  assert.equal(rows[0].amount, 2000000);
  assert.equal(rows[0].spent, 500000);
  assert.equal(rows[0].balance, 1500000);
  assert.equal(rows[0].locked, true);
  assert.equal(rows[1].spent, 0);
  assert.equal(rows[1].balance, 200000);

  const totals = sheetTotals(rows);
  assert.equal(totals.plan, 2200000);
  assert.equal(totals.spent, 500000);
  assert.equal(totals.balance, 1700000);
  assert.equal(totals.rate, 23);
  assert.equal(totals.over, 0);
  assert.match(sheetSummaryLine(rows), /편성 2,200,000원 · 집행 500,000원 · 잔액 1,700,000원 · 집행률 23%/);
});

test("지출 예정(planned)은 집행액에서 빼고 참고로만 센다", () => {
  const rows = sheetRows({ lines: LINES, expenses: [expense("e1", "b2", 50000, { status: "planned" })] });
  assert.equal(rows[1].spent, 0);
  assert.equal(rows[1].plannedOnly, 50000);
  assert.equal(rows[1].balance, 200000);
});

test("계획보다 많이 쓴 비목을 표시하고 합계에 이름을 남긴다", () => {
  const rows = sheetRows({ lines: LINES, expenses: [expense("e1", "b2", 260000)] });
  const totals = sheetTotals(rows);
  assert.equal(totals.over, 1);
  assert.deepEqual(totals.overRows, ["재료비"]);
  assert.ok(totals.balance < 0 || totals.plan > 0);
  assert.equal(rows[1].balance, -60000);
});

test("원장 집행을 비목별로 한 번에 모은다", () => {
  const map = spentByLine([
    expense("e1", "b1", 100000),
    expense("e2", "b1", 50000),
    expense("e3", "b1", 30000, { description: GRID_SPENT_LABEL })
  ]);
  const entry = map.get("b1");
  assert.equal(entry.spent, 180000);
  assert.equal(entry.expenseCount, 3);
  assert.equal(entry.locked, true);
  assert.equal(entry.gridEntryId, "e3");
});

/* ── 격자에서 적은 집행액 → 원장 ───────────────────────────── */

test("격자에서 적은 집행액은 원장에 한 건으로 남고, 다시 고치면 같은 건을 바꾼다", () => {
  const first = applyGridSpent({ work: work([]), updates: [{ lineId: "b1", amount: 300000 }], now: new Date("2026-11-16T10:00:00Z") });
  assert.equal(first.changed, 1);
  assert.equal(first.added, 1);
  assert.equal(first.work.expenses.length, 1);
  assert.equal(first.work.expenses[0].amount, 300000);
  assert.equal(first.work.expenses[0].status, "paid");
  assert.equal(first.work.expenses[0].description, GRID_SPENT_LABEL);
  assert.equal(isGridSpentEntry(first.work.expenses[0]), true);
  assert.match(first.work.expenses[0].spentAt, /^\d{4}-\d{2}-\d{2}$/);

  const second = applyGridSpent({ work: first.work, updates: [{ lineId: "b1", amount: 450000 }] });
  assert.equal(second.work.expenses.length, 1, "같은 비목에 두 건을 만들지 않는다");
  assert.equal(second.work.expenses[0].amount, 450000);
  assert.equal(second.work.expenses[0].id, first.work.expenses[0].id);
});

test("집행액을 0으로 지우면 격자에서 만든 기록만 지운다", () => {
  const created = applyGridSpent({ work: work([]), updates: [{ lineId: "b1", amount: 300000 }] });
  const cleared = applyGridSpent({ work: created.work, updates: [{ lineId: "b1", amount: 0 }] });
  assert.equal(cleared.removed, 1);
  assert.equal(cleared.work.expenses.length, 0);
});

test("원장에 사람이 적은 지출이 있으면 격자 집행액을 바꾸지 않고 이유를 돌려준다", () => {
  const existing = work([expense("m1", "b1", 200000)]);
  const result = applyGridSpent({ work: existing, updates: [{ lineId: "b1", amount: 999 }] });
  assert.equal(result.changed, 0);
  assert.equal(result.work, existing);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /원장/);
});

test("여러 비목의 집행액을 한 번에 반영한다", () => {
  const result = applyGridSpent({
    work: work([]),
    updates: [{ lineId: "b1", amount: 100000 }, { lineId: "b2", amount: 20000 }]
  });
  assert.equal(result.changed, 2);
  assert.deepEqual(result.work.expenses.map((item) => [item.budgetLineId, item.amount]).sort(), [["b1", 100000], ["b2", 20000]]);
});

/* ── 시트 붙여넣기 ─────────────────────────────────────────── */

test("시트에서 복사한 9열 표를 격자에 그대로 붙인다", () => {
  const block = [
    ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출근거", "비고"],
    ["인건비", "외래강사비", "250,000", "8", "2,000,000", "500,000", "1,500,000", "250,000원 × 8회", "두레"],
    ["홍보비", "현수막", "80,000", "3", "240,000", "", "", "80,000원 × 3개", ""]
  ];
  const result = applyBlockPaste({ lines: [], expenses: [], startRow: 0, startColumn: 0, block, now: 1 });
  assert.equal(result.newRows, 2, "머리글 줄은 값으로 넣지 않는다");
  assert.match(result.warnings.join(" "), /머리글 줄/);
  assert.equal(result.lines[0].category, "인건비");
  assert.equal(result.lines[0].unitCost, "250000");
  assert.equal(result.lines[0].quantity, "8");
  assert.equal(result.lines[0].basis, "250,000원 × 8회");
  assert.equal(result.lines[1].category, "홍보비");
  assert.deepEqual(result.spentChanges, [{ lineId: result.lines[0].id, amount: 500000 }]);
});

test("편성액 칸에 금액만 붙이면 단가로 받고 수량을 1로 둔다", () => {
  // 편성액(5번째 열) 칸을 눌러 금액 한 줄만 붙이는 경우 — 계산 칸이라 그냥 버리면 값이 사라진다.
  const result = applyBlockPaste({
    lines: [],
    expenses: [],
    startRow: 0,
    startColumn: 4,
    block: [["240,000"], ["150,000"]],
    now: 2
  });
  assert.equal(result.lines[0].unitCost, "240000");
  assert.equal(result.lines[0].quantity, "1");
  assert.equal(result.lines[1].unitCost, "150000");
  assert.equal(result.warnings.some((warning) => warning.includes("단가로 받고")), true);
});

test("이미 단가가 있는 행의 편성액 칸에 붙인 값은 계산을 덮어쓰지 않는다", () => {
  const result = applyBlockPaste({
    lines: LINES,
    expenses: [],
    startRow: 0,
    startColumn: 4,
    block: [["999999"]],
    now: 2
  });
  assert.equal(result.lines[0].unitCost, "250000");
  assert.equal(result.lines[0].quantity, "8");
  assert.equal(result.cells, 0);
});

test("원장 기록이 있는 비목의 집행액은 붙여넣어도 원장 값을 지키고, 모자란 행은 늘린다", () => {
  const result = applyBlockPaste({
    lines: LINES,
    expenses: [expense("m1", "b1", 200000)],
    startRow: 0,
    startColumn: 5,
    block: [["500000"], ["70000"], ["12000"]],
    now: 3
  });
  assert.equal(result.lines.length, 3, "행이 모자라면 새 행을 만든다");
  assert.equal(result.skippedLocked, 1);
  assert.deepEqual(result.spentChanges.map((change) => change.amount), [70000, 12000]);
  assert.match(result.warnings.join(" "), /원장에 기록이 있는 1개 비목/);
});

/* ── 표 읽기(집행액 열 포함) ───────────────────────────────── */

test("편성액·집행액 열이 있는 표를 읽으면 집행액을 따로 세고 예산 행에는 남기지 않는다", () => {
  const text = [
    "비목\t세목\t단가\t수량\t편성액\t집행액\t잔액\t산출근거\t비고",
    "인건비\t외래강사비\t250,000\t8\t2,000,000\t500,000\t1,500,000\t250,000원 × 8회\t",
    "운영비\t재료비\t100,000\t2\t200,000\t\t200,000\t\t"
  ].join("\n");
  const parsed = parseBudgetTable(text);
  assert.equal(parsed.lineCount, 2);
  assert.equal(parsed.totalAmount, 2200000);
  assert.equal(parsed.spentTotal, 500000);
  assert.equal(parsed.rows[0].spent, "500000");

  const merged = mergeBudgetLines([], parsed.rows, "append");
  assert.equal(merged.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(merged[0], "spent"), false, "집행액은 예산 행에 저장하지 않는다(원장 몫)");
  assert.equal(merged[0].unitCost, "250000");
  assert.deepEqual(pickBudgetFields({ category: "인건비", spent: "1" }), {
    category: "인건비", item: "", unitCost: "", quantity: "", basis: "", note: ""
  });
});

/* ── 내려받기 표 ───────────────────────────────────────────── */

test("내려받기 표는 머리글 + 계산된 숫자(원 없이)를 쓴다", () => {
  const rows = sheetExportRows({ lines: LINES, expenses: [expense("e1", "b1", 500000)] });
  assert.deepEqual(rows[0], ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출근거", "비고"]);
  assert.deepEqual(rows[1], ["인건비", "외래강사비", "250000", "8", "2000000", "500000", "1500000", "", ""]);
  assert.deepEqual(rows[2], ["운영비", "재료비", "100000", "2", "200000", "0", "200000", "", ""]);
  assert.equal(sheetToTsv({ lines: LINES, expenses: [] }).split("\n").length, 3);
});

test("원장이 비어 있어도 예산표는 그대로 내려받을 수 있다", () => {
  const rows = sheetExportRows({ lines: LINES });
  assert.equal(rows.length, 3);
  assert.equal(rows[1][5], "0");
});

/* ── 저장 경로(원장 추가)와 어긋나지 않는지 ───────────────── */

test("원장에 더한 지출이 격자 집행액에 바로 보인다", () => {
  const added = addExpenses(work([]), [{
    budgetLineId: "b1", spentAt: "2026-11-10", vendor: "양양문구", description: "포스트잇",
    amount: 48000, status: "paid", evidenceRef: "", evidenceNote: "", evidenceChecked: false
  }], new Date("2026-11-10T00:00:00Z"));
  const rows = sheetRows({ lines: LINES, expenses: added.work.expenses });
  assert.equal(rows[0].spent, 48000);
  assert.equal(rows[0].balance, 1952000);
});
