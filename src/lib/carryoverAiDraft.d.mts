import type { FormField } from "./kordocFormSpec.mjs";

export type AiDraftTarget = {
  fieldId: string;
  label: string;
  sectionTitle: string;
  type: string;
  where: string;
  previous: string;
  reason: string;
  kind: "leftover" | "empty";
};

export type AiDraftRow = {
  fieldId: string;
  label: string;
  sectionTitle: string;
  kind: "leftover" | "empty" | string;
  previous: string;
  value: string;
  reason: string;
  /** 값에 올해보다 앞선 연도가 들어 있어 사람이 확인해야 한다 */
  yearRisk: boolean;
  riskYears: number[];
};

export type AiDraftResult = {
  rows: AiDraftRow[];
  counts: { received: number; kept: number; rejected: number; masked: number };
  upstream?: string;
};

export const AI_DRAFT_MAX_TARGETS: number;
export const AI_DRAFT_MAX_VALUE: number;
export const AI_DRAFT_MAX_SOURCE: number;

export function selectLeftoverTargets(input?: {
  fields?: FormField[];
  values?: Record<string, string>;
  leftover?: { rows?: Array<{ fieldId: string; label?: string; sectionTitle?: string; previous?: string; reason?: string }> } | null;
  limit?: number;
}): AiDraftTarget[];

export function buildLeftoverDraftPrompt(input?: {
  targets?: AiDraftTarget[];
  fields?: FormField[];
  values?: Record<string, string>;
  planLines?: Array<{ kind?: string; label?: string; value?: string }>;
  materialLine?: string;
  smartText?: string;
  currentYear?: number;
  sourceYear?: number | null;
}): string;

export function parseLeftoverDraftResponse(
  raw: string,
  options?: { targets?: AiDraftTarget[]; currentYear?: number; sourceYear?: number | null }
): AiDraftResult;

export function collectDraftValues(rows: AiDraftRow[], selectedIds: Set<string> | string[]): {
  values: Record<string, string>;
  count: number;
};

export function summarizeDraftResult(
  result: AiDraftResult | null | undefined,
  selectedIds?: Set<string>
): { total: number; selected: number; risky: number; masked: number; rejected: number };
