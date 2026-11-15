import type { GrantBudgetLine } from "../types";

export type ParsedBudgetRow = Omit<GrantBudgetLine, "id">;

export type BudgetParseResult = {
  rows: ParsedBudgetRow[];
  hadHeader: boolean;
  delimiter: string;
  warnings: string[];
  totalAmount: number;
  lineCount: number;
};

export type BudgetImportMode = "append" | "replace" | "merge";

export const HEADER_ALIASES: Record<string, string[]>;
export const BUDGET_IMPORT_SAMPLE: string;

export function detectDelimiter(text: string): string;
export function mapHeaderRow(cells: string[]): Partial<Record<keyof ParsedBudgetRow | "amount", number>> | null;
export function parseBudgetTable(text: string, options?: { delimiter?: string; maxRows?: number }): BudgetParseResult;
export function mergeBudgetLines(
  existing: Array<Partial<GrantBudgetLine>>,
  imported: Array<Partial<GrantBudgetLine>>,
  mode?: BudgetImportMode
): GrantBudgetLine[];
export function budgetLinesToTsv(lines: Array<Partial<GrantBudgetLine>>): string;
