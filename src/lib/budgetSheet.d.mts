import type { GrantBudgetLine } from "../types";
import type { ProjectExpense, ProjectWork } from "./projectOperations.mjs";

/** 열의 역할 — 계산·자료 연결을 정한다. 이름(라벨)과 달리 화면에서 바꾸지 않는다. */
export type BudgetColumnRole =
  | "category"
  | "item"
  | "unitPrice"
  | "qty"
  | "budget"
  | "spent"
  | "balance"
  | "basis"
  | "note"
  | "custom";

export type BudgetSheetColumn = {
  /** 열마다 고유한 id — 사용자 열의 칸 값(custom[id])의 열쇠다. */
  id: string;
  role: BudgetColumnRole;
  /** 예전 코드가 쓰던 예산 행 필드 이름 (category/item/unitCost/quantity/amount/spent/balance/basis/note). */
  key: string;
  /** 화면·내려받기·서류 채우기에 쓰는 머리글 이름. */
  label: string;
  kind: "text" | "money" | "number" | "quantity" | "calc" | "spent";
  align: "left" | "right";
  width: number;
  numeric: boolean;
};

export type BudgetSheetRow = {
  id: string;
  category: string;
  item: string;
  unitCost: string;
  quantity: string;
  amount: number;
  spent: number;
  balance: number;
  basis: string;
  note: string;
  custom: Record<string, string>;
  plannedOnly: number;
  expenseCount: number;
  locked: boolean;
};

export type BudgetSheetTotals = {
  lineCount: number;
  filledCount: number;
  plan: number;
  spent: number;
  balance: number;
  rate: number;
  plannedOnly: number;
  over: number;
  overRows: string[];
  /** 열 id → 열 합계 (숫자 열만, 값이 없으면 null) */
  columnTotals: Record<string, number | null>;
};

export type GridSpentUpdate = { lineId: string; amount: number };

export type ApplyGridSpentResult = {
  work: ProjectWork;
  changed: number;
  skipped: Array<{ lineId: string; reason: string }>;
  removed: number;
  added: number;
};

export const GRID_SPENT_LABEL: string;
export const BUDGET_SHEET_COLUMNS: BudgetSheetColumn[];
export const PASTEABLE_COLUMNS: string[];
export const SHEET_EXPORT_HEADERS: string[];

export function isGridSpentEntry(expense: { description?: string } | null | undefined): boolean;
export function spentByLine(expenses: ProjectExpense[] | null | undefined): Map<string, {
  spent: number;
  plannedOnly: number;
  expenseCount: number;
  locked: boolean;
  gridEntryId: string;
  gridAmount: number;
}>;
export function sheetRows(params?: {
  lines?: GrantBudgetLine[] | null;
  expenses?: ProjectExpense[] | null;
}): BudgetSheetRow[];
export function sheetTotals(
  rows: BudgetSheetRow[] | null | undefined,
  columns?: BudgetSheetColumn[] | null
): BudgetSheetTotals;
export function applyGridSpent(params?: {
  work?: ProjectWork;
  updates?: GridSpentUpdate[];
  now?: Date;
}): ApplyGridSpentResult;
export function applyBlockPaste(params?: {
  lines?: GrantBudgetLine[];
  expenses?: ProjectExpense[];
  startRow?: number;
  startColumn?: number;
  block?: string[][];
  columns?: BudgetSheetColumn[] | null;
  now?: number;
}): {
  lines: GrantBudgetLine[];
  spentChanges: GridSpentUpdate[];
  cells: number;
  newRows: number;
  skippedLocked: number;
  warnings: string[];
};
export function sheetExportRows(params?: {
  lines?: GrantBudgetLine[] | null;
  expenses?: ProjectExpense[] | null;
  columns?: BudgetSheetColumn[] | null;
}): string[][];
export function sheetToTsv(params?: {
  lines?: GrantBudgetLine[] | null;
  expenses?: ProjectExpense[] | null;
  columns?: BudgetSheetColumn[] | null;
}): string;
export function budgetDocumentTable(params?: {
  plan?: { budgetLines?: GrantBudgetLine[]; budgetColumns?: BudgetSheetColumn[] } | null;
  work?: ProjectWork | null;
  columns?: BudgetSheetColumn[] | null;
}): {
  headers: string[];
  rows: string[][];
  total: string[];
  numeric: boolean[];
  columns: BudgetSheetColumn[];
};
export function sheetSummaryLine(rows: BudgetSheetRow[] | null | undefined): string;
