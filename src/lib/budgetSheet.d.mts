import type { GrantBudgetLine } from "../types";
import type { ProjectExpense, ProjectWork } from "./projectOperations.mjs";

export type BudgetSheetColumn = {
  key: "category" | "item" | "unitCost" | "quantity" | "amount" | "spent" | "balance" | "basis" | "note";
  label: string;
  kind: "text" | "money" | "quantity" | "calc" | "spent";
  align: "left" | "right";
  width: number;
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
export function sheetTotals(rows: BudgetSheetRow[] | null | undefined): BudgetSheetTotals;
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
}): string[][];
export function sheetToTsv(params?: {
  lines?: GrantBudgetLine[] | null;
  expenses?: ProjectExpense[] | null;
}): string;
export function sheetSummaryLine(rows: BudgetSheetRow[] | null | undefined): string;
