import type { GrantBudgetLine } from "../types";
import type { ExpenseStatusId } from "./projectOperations.mjs";

export type ParsedExpenseRow = {
  spentAt: string;
  vendor: string;
  description: string;
  amount: number;
  category: string;
  item: string;
  status: string;
  evidenceRef: string;
  evidenceNote: string;
};

export type ParsedExpenseTable = {
  rows: ParsedExpenseRow[];
  hadHeader: boolean;
  delimiter: string;
  warnings: string[];
  totalAmount: number;
  rowCount: number;
};

export type ExpenseInput = {
  budgetLineId: string;
  spentAt: string;
  vendor: string;
  description: string;
  amount: number;
  status: ExpenseStatusId;
  evidenceRef: string;
  evidenceNote: string;
  evidenceChecked: boolean;
};

export const EXPENSE_HEADER_ALIASES: Record<string, string[]>;

export function mapExpenseHeader(cells: string[]): Record<string, number> | null;
export function normalizeSpentAt(value: unknown): string;
export function readExpenseStatus(value: unknown): string;
export function parseExpenseTable(
  text: string,
  options?: { maxRows?: number; delimiter?: string }
): ParsedExpenseTable;
export function resolveBudgetLine(
  row: { category?: string; item?: string } | null | undefined,
  budgetLines: GrantBudgetLine[] | null | undefined
): GrantBudgetLine | null;
export function toExpenseInputs(
  rows: ParsedExpenseRow[] | null | undefined,
  budgetLines: GrantBudgetLine[] | null | undefined
): { inputs: ExpenseInput[]; unmatched: Array<{ description: string; amount: number }> };
export function expensesToTsv(
  expenses: Array<{
    spentAt: string;
    vendor: string;
    description: string;
    amount: number;
    budgetLineId: string;
    status: string;
    evidenceRef: string;
    evidenceNote: string;
  }> | null | undefined,
  budgetLines: GrantBudgetLine[] | null | undefined
): string;
export function formatExpenseTotal(amount: number): string;
export const EXPENSE_IMPORT_SAMPLE: string;
