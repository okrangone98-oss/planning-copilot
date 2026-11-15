import type { SampleBlock } from "./sampleTemplateParser.mjs";

export type PlanSourceLine = {
  kind: "heading" | "label" | "budget" | "schedule" | "body";
  label: string;
  value: string;
  section: string;
};

export type PlanSourceCounts = {
  paragraphs: number;
  tables: number;
  labels: number;
  budgetLines: number;
  scheduleLines: number;
  skipped: number;
  total: number;
  truncated: boolean;
};

export type PlanSourceResult = {
  ok: boolean;
  fileName: string;
  text: string;
  lines: PlanSourceLine[];
  counts: PlanSourceCounts;
  notes: string[];
  warning: string;
};

export const PLAN_SOURCE_ACCEPT: string;
export const PLAN_SOURCE_MAX_CHARS: number;
export const PLAN_SOURCE_MAX_LINES: number;
export const PLAN_SOURCE_HINT: string;
export const PLAN_SOURCE_LEGACY_HINT: string;
export const PLAN_SOURCE_EMPTY_HINT: string;

export function planSourceLines(blocks: SampleBlock[] | null | undefined): { lines: PlanSourceLine[]; counts: PlanSourceCounts };
export function planSourceMaterialText(input?: {
  lines?: PlanSourceLine[] | null;
  fileName?: string;
  truncated?: boolean;
}): string;
export function extractPlanSource(input?: {
  bytes?: Uint8Array | ArrayBuffer | null;
  fileName?: string;
  jszip?: unknown;
}): Promise<PlanSourceResult>;
export function appendMaterialText(input?: {
  existing?: string;
  block?: string;
  heading?: string;
}): { text: string; mode: "empty" | "append" | "refresh"; added: boolean };
