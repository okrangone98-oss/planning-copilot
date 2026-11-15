import type { GrantPlan } from "../types";

export type BudgetSummary = {
  rows: Array<GrantPlan["budgetLines"][number] & { amount: number }>;
  byCategory: Array<{ category: string; total: number; share: number }>;
  total: number;
  lineCount: number;
  funding: {
    total: number;
    subsidy: number;
    local: number;
    self: number;
    rates: { subsidyRate: number; localRate: number; selfRate: number };
    rateSum: number;
    rateMismatch: boolean;
  };
};

export type ChecklistSummary = {
  total: number;
  done: number;
  requiredTotal: number;
  requiredDone: number;
  requiredMissing: Array<GrantPlan["checklist"][number]>;
  percent: number;
};

export type ReportSummary = {
  total: number;
  written: number;
  missing: Array<GrantPlan["reportSections"][number]>;
  percent: number;
};

export type FollowUp = { kind: string; label: string; detail: string };

export const GRANT_SCHEMA_VERSION: number;

export function createEmptyGrantPlan(): GrantPlan;
export function toText(value: unknown, max?: number): string;
export function toDigits(value: unknown, max?: number): string;
export function parseAmount(value: unknown): number;
export function formatWon(amount: number): string;
export function parseQuantity(value: unknown): number;
export function lineAmount(line: { unitCost?: string; quantity?: string } | null | undefined): number;
export function budgetLineKey(line: { category?: string; item?: string } | null | undefined): string;
export function checklistKey(item: { group?: string; label?: string } | null | undefined): string;
export function reportSectionKey(section: { title?: string } | null | undefined): string;
export function splitFunding(
  amount: number,
  rates?: { subsidyRate?: string; localRate?: string; selfRate?: string }
): BudgetSummary["funding"];
export function budgetSummary(plan: GrantPlan | null | undefined): BudgetSummary;
export function checklistSummary(plan: GrantPlan | null | undefined): ChecklistSummary;
export function reportSummary(plan: GrantPlan | null | undefined): ReportSummary;
export function groupChecklist(plan: GrantPlan | null | undefined): Array<{ title: string; items: GrantPlan["checklist"] }>;
export function applyPreset(preset: Record<string, unknown> | null | undefined, current: GrantPlan | null | undefined): GrantPlan;
export function hasGrantWork(plan: GrantPlan | null | undefined): boolean;
export function emptyBudgetLine(id?: string): GrantPlan["budgetLines"][number];
export function sanitizeGrantPlan(saved: unknown): GrantPlan;
export function daysUntil(dateText: string, now?: Date | string): number | null;
export function dDayLabel(dateText: string, now?: Date | string): string;
export function scheduleEntries(plan: GrantPlan | null | undefined): Array<{ key: string; label: string; value: string }>;
export function pendingFollowUps(plan: GrantPlan | null | undefined, now?: Date | string): FollowUp[];
