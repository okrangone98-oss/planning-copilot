import type { BudgetSheetColumn, BudgetSheetRow } from "./budgetSheet.mjs";

export type { BudgetSheetColumn };

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

export const MAX_BUDGET_COLUMNS: number;
export const BUDGET_ROLE_SPECS: Record<string, { label: string; key: string; kind: string; align: "left" | "right"; width: number }>;
export const CALC_ROLES: Set<string>;
export const LEDGER_ROLES: Set<string>;
export const DEFAULT_BUDGET_COLUMNS: BudgetSheetColumn[];
export const ROLE_LINE_FIELD: Record<string, string>;

export function isNumericColumn(column: BudgetSheetColumn | null | undefined): boolean;
export function isTotalColumn(column: BudgetSheetColumn | null | undefined): boolean;
export function isCustomColumn(column: BudgetSheetColumn | null | undefined): boolean;
export function isCustomizedColumn(column: BudgetSheetColumn | null | undefined): boolean;
export function defaultLabelOf(role: string): string;
export function nextColumnId(columns: Array<{ id?: string }> | null | undefined, base?: string): string;
export function createBudgetColumn(spec?: { label?: string; numeric?: boolean }, columns?: Array<{ id?: string; label?: string }>): BudgetSheetColumn;
export function normalizeBudgetColumns(input?: unknown): BudgetSheetColumn[];
export function columnsForStorage(columns?: unknown): Array<{ id: string; role: BudgetColumnRole; label: string; kind: string; width: number }>;
export function columnOfRole(columns: BudgetSheetColumn[] | null | undefined, role: string): BudgetSheetColumn | null;
export function customValueOf(line: { custom?: Record<string, string> } | null | undefined, columnId: string): string;
export function cellValueOf(row: Partial<BudgetSheetRow> | null | undefined, column: BudgetSheetColumn | null | undefined): string | number;
export function numericValueOf(row: object, column: BudgetSheetColumn): number | null;
export function columnTotalOf(rows: Array<Record<string, unknown>> | null | undefined, column: BudgetSheetColumn): number | null;
