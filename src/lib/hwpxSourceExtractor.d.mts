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
  /** 기안문 결재란·시행문·연락처처럼 옮기지 않은 줄 수 */
  skippedNoise?: number;
  /** 본문 뒤 붙임 서식(계약서·매뉴얼 등)을 잘라냈는가 */
  appendix?: boolean;
  total: number;
  truncated: boolean;
  /** 같은 라벨에 서로 다른 값이 적힌 가지 수 */
  conflicts?: number;
};

export type PlanSourceConflict = { label: string; values: string[] };

export type PlanSourceResult = {
  ok: boolean;
  fileName: string;
  text: string;
  lines: PlanSourceLine[];
  counts: PlanSourceCounts;
  conflicts?: PlanSourceConflict[];
  notes: string[];
  warning: string;
};

export const PLAN_SOURCE_ACCEPT: string;
export const PLAN_SOURCE_MAX_CHARS: number;
export const PLAN_SOURCE_MAX_LINES: number;
export const PLAN_SOURCE_HINT: string;
export const PLAN_SOURCE_LEGACY_HINT: string;
export const PLAN_SOURCE_EMPTY_HINT: string;

export function planSourceLines(blocks: SampleBlock[] | null | undefined): { lines: PlanSourceLine[]; counts: PlanSourceCounts; conflicts: PlanSourceConflict[] };
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
