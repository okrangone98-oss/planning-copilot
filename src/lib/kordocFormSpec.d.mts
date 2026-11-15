import type { TemplateSchema } from "./sampleTemplateParser.mjs";

export type FormFieldType = "text" | "date" | "phone" | "email" | "amount" | "checkbox" | "idnum";

export type PlaceholderHit = { kind: "mustache" | "bracket" | "blank" | "date"; raw: string; label: string };

export type InlineFieldSegment = {
  label: string;
  extLabel?: string;
  value: string;
  start: number;
  valueStart: number;
  valueEnd: number;
};

export type FormField = {
  id: string;
  /** 화면에 보이는 칸 이름 */
  label: string;
  /** 라벨을 kordoc 규칙으로 정규화한 비교용 키 */
  key: string;
  /** kordoc fill 의 JSON 키 — 열 머리 표에서는 머리 이름 */
  fillKey: string;
  value: string;
  empty: boolean;
  type: FormFieldType;
  required?: boolean;
  hint: string;
  sectionId: string | null;
  sectionTitle: string;
  tableId?: string;
  rowIndex?: number;
  columnIndex?: number;
  slotId?: string;
  origin: "table" | "text" | "placeholder" | "inline";
  duplicate?: boolean;
  context: string;
};

export type FillEntry = { key: string; value: string | string[]; label: string; sectionTitle: string; where: string; /** 이 값이 들어가는 칸(FormField) id — 검토 표에서 값을 고칠 때 쓴다. */ fieldId?: string };

export type FillValuesResult = {
  values: Record<string, string | string[]>;
  entries: FillEntry[];
  warnings: string[];
  unmapped: FormField[];
};

export type KordocBridgePayload = {
  format: "hwpx";
  engine: "kordoc";
  mode: "fill" | "patch";
  fileName: string;
  outputName: string;
  templateBase64?: string;
  values?: Record<string, string | string[]>;
  markdown?: string;
};

export const KORDOC_SPEC_VERSION: string;
export const FORM_LABEL_KEYWORDS: string[];
export const PLAN_LABEL_KEYWORDS: string[];
export const PLACEHOLDER_KINDS: string[];
export const KORDOC_FILL_CONTRACT: string[];
export const KORDOC_FILL_HINT: string;

export function normalizeFormLabel(label?: string | null): string;
export function isBlankValueCell(text?: string | null): boolean;
export function isDatePlaceholderCell(text?: string | null): boolean;
export function isSignaturePlaceholderCell(text?: string | null): boolean;
export function isFillableCellText(text?: string | null): boolean;
export function isInlineSignatureBlock(text?: string | null): boolean;
export function isLegalDocumentSchema(schema?: TemplateSchema | null): boolean;
export function isFormLabelCell(text?: string | null): boolean;
export function isSubLabelBeside(labelRowSpan: number, text?: string, after?: string): boolean;
export function isColumnHeaderRow(heads?: string[], below?: Array<string | undefined>): boolean;
export function findMatchingFieldKey(cellLabel: string, keys: Iterable<string>): string | undefined;
export function detectPlaceholders(text?: string | null): PlaceholderHit[];
export function scanInlineFieldSegments(text?: string | null): InlineFieldSegment[];
export function fieldTypeOf(label?: string, value?: string): FormFieldType;
export function isRequiredLabel(label?: string | null): boolean;
export function extractFormFields(schema?: TemplateSchema | null): FormField[];
export function fieldValueOf(schema: TemplateSchema | null | undefined, field: FormField): string;
export function applyFieldValues(
  schema: TemplateSchema | null | undefined,
  valuesByFieldId: Record<string, string>,
  options?: { force?: boolean }
): { schema: TemplateSchema; applied: number; skipped: Array<{ field: FormField; current: string }> } | TemplateSchema | null;
export function buildKordocFillValues(input?: {
  fields?: FormField[];
  values?: Record<string, string>;
}): FillValuesResult;
export function kordocFillJsonText(values?: Record<string, string | string[]> | null): string;
export function safeShellName(value?: string | null, fallback?: string): string;
export function buildKordocFillCommand(input?: { templateFile?: string; valuesFile?: string; outputFile?: string }): string;
export function buildKordocPatchCommand(input?: { templateFile?: string; editedFile?: string; outputFile?: string }): string;
export function buildKordocFillPayload(input?: {
  fileName?: string;
  fileBase64?: string;
  values?: Record<string, string | string[]>;
  mode?: "fill" | "patch";
  markdown?: string;
  outputName?: string;
}): KordocBridgePayload | null;
