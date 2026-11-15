export const CARRYOVER_LEFTOVER_LABEL: string;
export const CARRYOVER_REPLACED_LABEL: string;
export const CARRYOVER_KEPT_LABEL: string;
export const CARRYOVER_MODE_HINT: string;

export type YearSignal = { kind: "year" | "date" | "amount" | "count"; text: string; year?: number };

export type PreviousYearSignals = {
  years: number[];
  sourceYear: number;
  strong: YearSignal[];
  weak: YearSignal[];
  hasPreviousYear: boolean;
  hasValueSignals: boolean;
};

export type CarryoverDetection = {
  currentYear: number;
  sourceYear: number | null;
  years: number[];
  filledCells: number;
  totalFields: number;
  filledRatio: number;
  signals: Record<string, number>;
  hasResultTitle: boolean;
  isFilledDocument: boolean;
  isPreviousYearDocument: boolean;
  suggested: boolean;
  reason: string;
};

export type CarryoverRow = {
  fieldId: string;
  label: string;
  sectionTitle: string;
  fillKey: string;
  type: string;
  value: string;
  kinds: string[];
  strength: "strong" | "weak";
  years: number[];
  note: string;
};

export type CarryoverPlan = { rows: CarryoverRow[]; counts: { total: number; strong: number; weak: number } };

export type CarryoverLeftoverRow = {
  fieldId: string;
  label: string;
  sectionTitle: string;
  previous: string;
  next: string;
  kinds: string[];
  strength: "strong" | "weak";
  reason: string;
};

export type CarryoverLeftover = {
  rows: CarryoverLeftoverRow[];
  counts: { total: number; strong: number; weak: number };
};

export type CarryoverClassification = {
  byId: Record<
    string,
    { status: "replaced" | "leftover"; label: string; previous: string; next: string; strength: string; reason: string }
  >;
  counts: { replaced: number; leftover: number };
};

export function yearsIn(value?: string | null): number[];
export function previousYearSignals(
  value?: string | null,
  options?: { currentYear?: number; sourceYear?: number }
): PreviousYearSignals;
export function detectPreviousYearDocument(input?: {
  schema?: unknown;
  fileName?: string;
  title?: string;
  text?: string;
  currentYear?: number;
  fields?: Array<{ id: string; value: string; empty: boolean; label?: string; sectionTitle?: string; fillKey?: string; type?: string }> | null;
}): CarryoverDetection;
export function buildCarryoverPlan(input?: {
  fields?: Array<Record<string, unknown>> | null;
  currentYear?: number;
  sourceYear?: number;
}): CarryoverPlan;
export function markCarryoverRows<T>(result: T, planRows?: CarryoverRow[] | null): T;
export function findLeftoverYearValues(input?: {
  fields?: Array<Record<string, unknown>> | null;
  values?: Record<string, string> | null;
  planRows?: CarryoverRow[] | null;
  currentYear?: number;
  sourceYear?: number;
}): CarryoverLeftover;
export function classifyCarryover(input?: {
  planRows?: CarryoverRow[] | null;
  leftover?: CarryoverLeftover | null;
  values?: Record<string, string> | null;
}): CarryoverClassification;
export function carryoverOverwriteMap(input?: {
  planRows?: CarryoverRow[] | null;
  values?: Record<string, string> | null;
}): Record<string, string[]>;
export function carryoverSummary(input?: {
  detection?: CarryoverDetection | null;
  plan?: CarryoverPlan | null;
  leftover?: CarryoverLeftover | null;
  replaced?: number;
}): string;
export function carryoverStatusLine(input?: {
  detection?: CarryoverDetection | null;
  plan?: CarryoverPlan | null;
  leftover?: CarryoverLeftover | null;
}): string;
