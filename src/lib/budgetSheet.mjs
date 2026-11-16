// 예산 관리표(스프레드시트형 격자)의 계산·붙여넣기·집행 연동을 한곳에 모은 순수 함수.
//
// 화면(BudgetSheet.tsx)은 그리기와 키보드 이동만 맡고, 숫자와 저장 규칙은 여기서 정한다.
// 원칙
//  - 편성액 = 단가 × 수량, 잔액 = 편성액 − 집행액 (표에서 직접 고치지 않는다).
//  - 집행액의 원천은 지출 원장이다. 격자에서 적은 집행액은 '예산 관리표에서 입력' 한 건으로 원장에 남겨
//    화면·결과보고·내보내기가 모두 같은 숫자를 보게 한다(두 곳에서 따로 계산하지 않는다).
//  - 원장에 사람이 적은 지출이 있는 비목은 격자에서 집행액을 고칠 수 없다(어느 쪽이 맞는지 화면이 정하지 않는다).

import { emptyBudgetLine, formatWon, lineAmount, parseAmount, parseQuantity } from "./grantWorkflow.mjs";
import { addExpenses, removeExpense, updateExpense } from "./projectOperations.mjs";
import { mapHeaderRow } from "./budgetImport.mjs";

/** 격자에서 적은 집행액에 붙는 적요 — 원장에서 이 글자로 찾아 고치고 지운다. */
export const GRID_SPENT_LABEL = "예산 관리표에서 입력";

/** 열 정의 — 순서가 곧 표의 열 순서다. */
export const BUDGET_SHEET_COLUMNS = [
  { key: "category", label: "비목", kind: "text", align: "left", width: 104 },
  { key: "item", label: "세목", kind: "text", align: "left", width: 136 },
  { key: "unitCost", label: "단가", kind: "money", align: "right", width: 104 },
  { key: "quantity", label: "수량", kind: "quantity", align: "right", width: 64 },
  { key: "amount", label: "편성액", kind: "calc", align: "right", width: 110 },
  { key: "spent", label: "집행액", kind: "spent", align: "right", width: 110 },
  { key: "balance", label: "잔액", kind: "calc", align: "right", width: 110 },
  { key: "basis", label: "산출근거", kind: "text", align: "left", width: 176 },
  { key: "note", label: "비고", kind: "text", align: "left", width: 132 }
];

/** 붙여넣기로 값을 넣을 수 있는 열. */
export const PASTEABLE_COLUMNS = ["category", "item", "unitCost", "quantity", "spent", "basis", "note"];

/** 내려받기(CSV·XLSX) 머리글 — 엑셀에서 바로 계산되도록 금액은 숫자로 쓴다. */
export const SHEET_EXPORT_HEADERS = ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출근거", "비고"];

function amountOf(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function todayText(now) {
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 격자에서 적은 집행 기록인가. */
export function isGridSpentEntry(expense) {
  return String(expense?.description ?? "") === GRID_SPENT_LABEL;
}

/**
 * 비목 id별 집행 상태 — 원장 지출을 한 번만 훑어 모은다.
 * @returns {Map<string, {spent:number, plannedOnly:number, expenseCount:number, locked:boolean, gridEntryId:string, gridAmount:number}>}
 */
export function spentByLine(expenses) {
  const map = new Map();
  for (const expense of Array.isArray(expenses) ? expenses : []) {
    const lineId = String(expense?.budgetLineId ?? "");
    if (!lineId) continue;
    const entry = map.get(lineId) || { spent: 0, plannedOnly: 0, expenseCount: 0, locked: false, gridEntryId: "", gridAmount: 0 };
    const amount = amountOf(expense?.amount);
    entry.expenseCount += 1;
    if (expense?.status === "planned") entry.plannedOnly += amount;
    else entry.spent += amount;
    if (isGridSpentEntry(expense)) {
      entry.gridEntryId = String(expense?.id ?? "");
      entry.gridAmount = amount;
    } else {
      entry.locked = true;
    }
    map.set(lineId, entry);
  }
  return map;
}

/**
 * 예산 행 + 지출 원장 → 격자에 그릴 행.
 * @returns {Array<{id:string,category:string,item:string,unitCost:string,quantity:string,amount:number,spent:number,balance:number,basis:string,note:string,plannedOnly:number,expenseCount:number,locked:boolean}>}
 */
export function sheetRows({ lines, expenses } = {}) {
  const ledger = spentByLine(expenses);
  return (Array.isArray(lines) ? lines : []).map((line) => {
    const plan = lineAmount(line);
    const entry = ledger.get(String(line?.id ?? ""));
    const spent = entry ? entry.spent : 0;
    return {
      id: String(line?.id ?? ""),
      category: String(line?.category ?? ""),
      item: String(line?.item ?? ""),
      unitCost: String(line?.unitCost ?? ""),
      quantity: String(line?.quantity ?? ""),
      amount: plan,
      spent,
      balance: plan - spent,
      basis: String(line?.basis ?? ""),
      note: String(line?.note ?? ""),
      plannedOnly: entry ? entry.plannedOnly : 0,
      expenseCount: entry ? entry.expenseCount : 0,
      locked: entry ? entry.locked : false
    };
  });
}

/** 합계 줄 — 화면·내보내기·서류 채우기가 같은 숫자를 쓴다. */
export function sheetTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const plan = list.reduce((sum, row) => sum + amountOf(row?.amount), 0);
  const spent = list.reduce((sum, row) => sum + amountOf(row?.spent), 0);
  const plannedOnly = list.reduce((sum, row) => sum + amountOf(row?.plannedOnly), 0);
  const overRows = list.filter((row) => Number(row?.balance) < 0);
  return {
    lineCount: list.length,
    filledCount: list.filter((row) => String(row?.category ?? "").trim() || String(row?.item ?? "").trim()).length,
    plan,
    spent,
    balance: plan - spent,
    rate: plan ? Math.round((spent / plan) * 100) : 0,
    plannedOnly,
    over: overRows.length,
    overRows: overRows.map((row) => String(row?.item ?? "").trim() || String(row?.category ?? "").trim() || "이름 없는 행")
  };
}

/**
 * 격자에서 고친 집행액을 지출 원장에 반영한다(한 번의 작업 갱신).
 * - 원장에 사람이 적은 지출이 있는 비목은 건드리지 않고 skipped 로 돌려준다.
 * - 0원으로 지우면 격자에서 만든 기록만 지운다(사람이 적은 지출은 그대로).
 * @returns {{work:object, changed:number, skipped:Array<{lineId:string,reason:string}>, removed:number, added:number}}
 */
export function applyGridSpent({ work, updates = [], now } = {}) {
  const base = work && typeof work === "object" ? work : { expenses: [] };
  const date = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const skipped = [];
  let next = base;
  let changed = 0;
  let removed = 0;
  let added = 0;

  for (const update of Array.isArray(updates) ? updates : []) {
    const lineId = String(update?.lineId ?? "");
    if (!lineId) continue;
    const entries = (Array.isArray(next.expenses) ? next.expenses : []).filter((expense) => String(expense?.budgetLineId ?? "") === lineId);
    const gridEntry = entries.find(isGridSpentEntry) || null;
    const manual = entries.filter((expense) => !isGridSpentEntry(expense));
    if (manual.length) {
      skipped.push({ lineId, reason: "원장에 적은 지출이 있어 격자에서 고칠 수 없습니다." });
      continue;
    }
    const value = amountOf(update?.amount);
    if (!value) {
      if (!gridEntry) continue;
      const result = removeExpense(next, gridEntry.id, date);
      if (result.error) {
        skipped.push({ lineId, reason: result.error });
        continue;
      }
      next = result.work;
      changed += 1;
      removed += 1;
      continue;
    }
    if (gridEntry) {
      if (amountOf(gridEntry.amount) === value) continue;
      const result = updateExpense(next, gridEntry.id, { amount: value }, { now: date });
      if (result.error) {
        skipped.push({ lineId, reason: result.error });
        continue;
      }
      next = result.work;
      changed += 1;
      continue;
    }
    const result = addExpenses(next, [{
      budgetLineId: lineId,
      spentAt: todayText(date),
      vendor: "",
      description: GRID_SPENT_LABEL,
      amount: value,
      status: "paid",
      evidenceRef: "",
      evidenceNote: "",
      evidenceChecked: false
    }], date);
    if (result.error || !result.added) {
      skipped.push({ lineId, reason: result.error || "지출을 더하지 못했습니다." });
      continue;
    }
    next = result.work;
    changed += 1;
    added += 1;
  }

  return { work: changed ? next : base, changed, skipped, removed, added };
}

/**
 * 시트에서 복사한 여러 칸을 격자의 한 자리부터 채운다(엑셀 붙여넣기와 같은 결).
 * - 모자란 행은 새 빈 행으로 늘린다.
 * - 편성액·잔액 칸에 숫자가 오면 단가·수량이 비어 있을 때만 단가로 받는다(표에 금액만 있는 경우).
 * - 집행액 칸은 원장 기록이 없는 비목에만 넣고 spentChanges 로 돌려준다.
 * @returns {{lines:Array, spentChanges:Array<{lineId:string,amount:number}>, cells:number, newRows:number, skippedLocked:number, warnings:string[]}}
 */
export function applyBlockPaste({ lines = [], expenses = [], startRow = 0, startColumn = 0, block = [], now = Date.now() } = {}) {
  const grid = (Array.isArray(block) ? block : []).map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "").trim()) : []));
  const warnings = [];
  if (!grid.length) return { lines, spentChanges: [], cells: 0, newRows: 0, skippedLocked: 0, warnings: ["붙여넣은 표가 비어 있습니다."] };

  // 표를 통째로 복사하면 머리글 줄이 함께 온다 — 값으로 넣지 않고 한 줄 건너뛴다.
  if (grid.length > 1 && mapHeaderRow(grid[0])) {
    grid.shift();
    warnings.push("머리글 줄 1줄은 값으로 넣지 않고 건너뛰었습니다.");
  }

  const ledger = spentByLine(expenses);
  const next = (Array.isArray(lines) ? lines : []).map((line) => ({ ...line }));
  const stamp = typeof now === "number" ? now : Date.now();
  let newRows = 0;
  let cells = 0;
  let skippedLocked = 0;
  let calcAsUnitCost = 0;
  const spentChanges = new Map();
  const rowStart = Math.max(0, Math.trunc(Number(startRow) || 0));
  const columnStart = Math.max(0, Math.trunc(Number(startColumn) || 0));

  grid.forEach((rowCells, rowOffset) => {
    const rowIndex = rowStart + rowOffset;
    if (!rowCells.some((cell) => cell)) return;
    while (next.length <= rowIndex) {
      next.push(emptyBudgetLine(`sheet-${stamp}-${next.length + 1}`));
      newRows += 1;
    }
    const line = next[rowIndex];
    let lineTouched = false;
    rowCells.forEach((cell, columnOffset) => {
      if (!cell) return;
      const column = BUDGET_SHEET_COLUMNS[columnStart + columnOffset];
      if (!column) return;
      if (column.kind === "calc") {
        if (column.key === "amount" && parseAmount(cell) > 0 && !parseQuantity(line.quantity) && !parseAmount(line.unitCost)) {
          line.unitCost = String(parseAmount(cell));
          line.quantity = "1";
          lineTouched = true;
          calcAsUnitCost += 1;
        }
        return;
      }
      if (column.key === "spent") {
        const entry = ledger.get(String(line.id ?? ""));
        if (entry && entry.locked) {
          skippedLocked += 1;
          return;
        }
        const spent = parseAmount(cell);
        if (!spent) return;
        spentChanges.set(String(line.id ?? ""), spent);
        cells += 1;
        return;
      }
      if (column.key === "unitCost") {
        line.unitCost = parseAmount(cell) ? String(parseAmount(cell)) : "";
      } else if (column.key === "quantity") {
        line.quantity = cell.slice(0, 40);
      } else if (column.key === "category" || column.key === "item" || column.key === "basis" || column.key === "note") {
        line[column.key] = cell.slice(0, 200);
      }
      lineTouched = true;
      cells += 1;
    });
    if (!lineTouched && !spentChanges.has(String(line.id ?? ""))) {
      // 값이 하나도 안 들어간 새 행은 남기지 않는다.
      if (rowIndex >= (Array.isArray(lines) ? lines.length : 0) && !String(line.category ?? "").trim() && !String(line.item ?? "").trim()) {
        next.pop();
        newRows = Math.max(0, newRows - 1);
      }
    }
  });

  if (calcAsUnitCost) warnings.push(`편성액만 있던 ${calcAsUnitCost}개 칸은 단가로 받고 수량을 1로 두었습니다.`);
  if (skippedLocked) warnings.push(`지출 원장에 기록이 있는 ${skippedLocked}개 비목의 집행액은 원장 값을 그대로 두었습니다.`);

  return {
    lines: next,
    spentChanges: Array.from(spentChanges.entries()).map(([lineId, amount]) => ({ lineId, amount })),
    cells,
    newRows,
    skippedLocked,
    warnings
  };
}

/** 격자 → 내려받기 표(머리글 포함). 금액은 계산 가능한 숫자로 쓴다. */
export function sheetExportRows({ lines, expenses } = {}) {
  const rows = sheetRows({ lines, expenses });
  const body = rows.map((row) => [
    row.category,
    row.item,
    parseAmount(row.unitCost) ? String(parseAmount(row.unitCost)) : "",
    row.quantity,
    String(row.amount),
    String(row.spent),
    String(row.balance),
    row.basis,
    row.note
  ]);
  return [SHEET_EXPORT_HEADERS, ...body];
}

/** 격자 전체를 시트에 붙일 수 있는 탭 구분 글. */
export function sheetToTsv({ lines, expenses } = {}) {
  return sheetExportRows({ lines, expenses })
    .map((row) => row.map((cell) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}

/** 합계를 한 줄로 — 알림·화면 보조 문구용. */
export function sheetSummaryLine(rows) {
  const totals = sheetTotals(rows);
  return `편성 ${formatWon(totals.plan)} · 집행 ${formatWon(totals.spent)} · 잔액 ${formatWon(totals.balance)}${totals.plan ? ` · 집행률 ${totals.rate}%` : ""}`;
}
