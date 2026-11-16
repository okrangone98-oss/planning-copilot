import type { FormField } from "./kordocFormSpec.mjs";

export type FreeTextSegment = {
  id: string;
  kind: "labeled" | "bullet" | "paragraph" | "heading";
  text: string;
  label?: string;
  marker?: string;
  sectionTitle?: string;
  lineIndex: number;
  reason?: string;
};

export type AssignmentRow = {
  fieldId: string;
  label: string;
  sectionTitle: string;
  where: string;
  type: string;
  current: string;
  proposed: string;
  mode: "new" | "replace";
  checked: boolean;
  /** 칸에 이미 글이 있어 기본은 유지 — 사용자가 체크해야 바뀐다 */
  conflict: boolean;
  /** 서로 다른 곳의 글이 한 칸에 모였는지 — 사람이 확인해야 한다. */
  merged?: boolean;
  score: number;
  reasons: string[];
  source: "rule" | "ai";
  segments: Array<{ id: string; text: string }>;
};

export type SmartMapResult = {
  rows: AssignmentRow[];
  leftovers: Array<{ id: string; kind: string; text: string; reason: string; sectionTitle: string }>;
  fieldCount: number;
  aiRows?: number;
  ruleRows?: number;
};

export type SmartMapSummary = {
  total: number;
  filling: number;
  conflicts: number;
  keeping: number;
  leftovers: number;
  fields: number;
};

export const FIELD_TYPE_LABEL: Record<string, string>;

export function splitFreeText(text?: string): FreeTextSegment[];
export function splitLabeledLine(line?: string): Array<{ label: string; value: string }>;
export function detectValueKinds(text?: string): string[];
export function scoreSegmentForField(segment: FreeTextSegment, field: FormField): { score: number; reasons: string[] };
export function mapFreeTextToFields(input?: { fields?: FormField[]; text?: string }): SmartMapResult;
export function buildSmartTextPrompt(input?: { fields?: FormField[]; text?: string }): string;
export function parseSmartTextResponse(
  raw: string,
  input?: { fields?: FormField[]; fallbackText?: string }
): SmartMapResult | null;
export function mergeWithRuleMap(aiResult: SmartMapResult | null, ruleResult: SmartMapResult | null): SmartMapResult | null;
export function collectSelectedValues(
  rows: AssignmentRow[],
  selectedIds: Set<string> | string[]
): { values: Record<string, string>; kept: string[]; replaced: number; count: number };
export function summarizeSmartMap(result: SmartMapResult | null, selectedIds?: Set<string> | string[]): SmartMapSummary;
export function hintForValue(value?: string): string;
