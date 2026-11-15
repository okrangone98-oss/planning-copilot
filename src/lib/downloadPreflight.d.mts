import type { FormField } from "./kordocFormSpec.mjs";
import type { TemplateSchema } from "./sampleTemplateParser.mjs";

export type PreflightLevel = "block" | "warn" | "manual";
export type FieldStatus = "auto" | "manual" | "check" | "required" | "blank" | "original";

export type FieldCheck = { ok: boolean; level: "" | "block" | "warn"; message: string };

export type ClassifiedField = {
  fieldId: string;
  field: FormField;
  label: string;
  sectionTitle: string;
  type: string;
  value: string;
  originalValue: string;
  required: boolean;
  status: FieldStatus;
  statusLabel: string;
  note: string;
  check: FieldCheck;
};

export type FieldStatusCounts = {
  total: number;
  auto: number;
  manual: number;
  check: number;
  required: number;
  blank: number;
  original: number;
  filled: number;
};

export type PreflightItem = {
  id: string;
  level: PreflightLevel;
  title: string;
  detail: string;
  fix: string;
  fieldIds: string[];
};

export type BudgetCheck = {
  status: "none" | "match" | "mismatch" | "partial";
  detail: string;
  total: number | null;
  sum: number | null;
};

export type DownloadPreflight = {
  items: PreflightItem[];
  counts: { block: number; warn: number; manual: number };
  stats: FieldStatusCounts;
  canDownload: boolean;
  headline: string;
  gateMessage: string;
  budget: BudgetCheck;
};

export type PreflightInput = {
  fields?: FormField[];
  values?: Record<string, string>;
  autoFieldIds?: Set<string> | string[];
  lowConfidenceIds?: Set<string> | string[];
  leftovers?: Array<{ id?: string; text?: string }>;
  schema?: TemplateSchema | null;
  title?: string;
  hasFile?: boolean;
};

export const PREFLIGHT_LEVEL_LABEL: Record<PreflightLevel, string>;
export const FIELD_STATUS_LABEL: Record<FieldStatus, string>;

export function numberFromValue(value?: string): number | null;
export function checkFieldValue(field: FormField, value?: string): FieldCheck;
export function classifyFields(input?: {
  fields?: FormField[];
  values?: Record<string, string>;
  autoFieldIds?: Set<string> | string[];
  lowConfidenceIds?: Set<string> | string[];
}): ClassifiedField[];
export function summarizeFieldStatuses(rows?: ClassifiedField[]): FieldStatusCounts;
export function checkBudgetTotal(input?: { rows?: ClassifiedField[] }): BudgetCheck;
export function buildDownloadPreflight(input?: PreflightInput): DownloadPreflight;
export function preflightSummaryLine(preflight: DownloadPreflight | null): string;
export function explainDownloadFailure(error: unknown): { title: string; detail: string; fix: string };
