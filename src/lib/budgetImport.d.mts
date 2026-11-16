import type { GrantBudgetLine } from "../types";
import type { BudgetSheetColumn } from "./budgetSheet.mjs";

/** 표에서 읽은 예산 행 — 집행액(spent)은 표에 함께 실려 왔을 때만 붙는다(원장 몫). */
export type ParsedBudgetRow = Omit<GrantBudgetLine, "id"> & { spent?: string };

export type BudgetParseResult = {
  rows: ParsedBudgetRow[];
  hadHeader: boolean;
  delimiter: string;
  warnings: string[];
  totalAmount: number;
  /** 표에 집행액 열이 있으면 그 합(없으면 0). */
  spentTotal: number;
  lineCount: number;
};

export type BudgetImportMode = "append" | "replace" | "merge";

export const HEADER_ALIASES: Record<string, string[]>;
export const BUDGET_IMPORT_SAMPLE: string;
export const BUDGET_LINE_FIELDS: string[];

export function detectDelimiter(text: string): string;
export function fieldOfRole(role: string): string;
export function mapHeaderRow(
  cells: string[],
  columns?: BudgetSheetColumn[] | null
): Partial<Record<string, number>> | null;
export function parseBudgetTable(
  text: string,
  options?: { delimiter?: string; maxRows?: number; columns?: BudgetSheetColumn[] | null }
): BudgetParseResult;
export function pickBudgetFields(line: Partial<GrantBudgetLine> | Record<string, unknown> | null | undefined): {
  category: string;
  item: string;
  unitCost: string;
  quantity: string;
  basis: string;
  note: string;
  custom?: Record<string, string>;
};
export function mergeBudgetLines(
  existing: Array<Partial<GrantBudgetLine>>,
  imported: Array<Partial<GrantBudgetLine>>,
  mode?: BudgetImportMode
): GrantBudgetLine[];
export function budgetLinesToTsv(lines: Array<Partial<GrantBudgetLine>>): string;
