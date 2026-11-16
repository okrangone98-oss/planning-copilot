export type SampleBlock =
  | { type: "heading"; level: number; title: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; marker: string; text: string }
  | { type: "table"; headers: string[]; rows: string[][]; spans?: Array<Array<[number, number]>> }
  | { type: "meta"; text: string };

export type TemplateSection = {
  id: string;
  rawLevel: number;
  level: number;
  parentId: string | null;
  title: string;
  order: number;
  line: number;
};

export type TemplateTable = {
  id: string;
  order: number;
  sectionId: string | null;
  caption: string;
  headers: string[];
  rows: string[][];
  /** 칸마다 [rowSpan, colSpan] — 병합이 있는 표만 담는다 */
  spans?: Array<Array<[number, number]>>;
  columnCount: number;
  rowCount: number;
  emptyCells: number;
};

export type TemplateSlotKind = "blank" | "label" | "guide" | "item" | "table-cell" | "labelled" | "title";

export type TemplateSlot = {
  id: string;
  kind: TemplateSlotKind;
  label: string;
  sectionId: string | null;
  sectionTitle: string;
  preview?: string;
  /** 사용자가 채운 값(본문 자리 표시 칸) — 본문 ‘라벨: 값’·문서 제목 칸은 원문 값 */
  value?: string;
  /** 본문 인라인 채우기에 쓰는 라벨 글자(‘총 운영회차’ → ‘운영회차’) */
  fillLabel?: string;
  tableId?: string;
  rowIndex?: number;
  columnIndex?: number;
  source: "text" | "table";
};

export type TemplateCounts = {
  sections: number;
  tables: number;
  slots: number;
  emptyCells: number;
  blanks: number;
  guides: number;
  /** 본문 문단에 적힌 ‘라벨: 값’ 칸 수 */
  labelled?: number;
  /** 연도가 박힌 문서 제목 칸 수(0 또는 1) */
  titles?: number;
};

export type TemplateSchema = {
  version: number;
  fileName: string;
  format: string;
  charCount: number;
  title: string;
  sections: TemplateSection[];
  tables: TemplateTable[];
  slots: TemplateSlot[];
  counts: TemplateCounts;
  warnings: string[];
};

export type TemplateProfile = {
  projectName: string;
  organization: string;
  region: string;
  audience: string;
  summary: string;
  budget: string;
  schedule: string;
  evidence: string;
  notes: string;
};

export type TemplateSupport = { supported: boolean; format: string; message: string };

export type TemplateSummary = TemplateCounts & { title: string; formats: string };

export const HWP_BINARY_GUIDANCE: string;
export const UNSUPPORTED_FORMAT_GUIDANCE: string;
export const SUPPORTED_SAMPLE_FORMATS: string[];
export const SAMPLE_ACCEPT: string;
export const TEMPLATE_PROFILE_FIELDS: Array<{ key: keyof TemplateProfile; label: string; placeholder: string }>;

export function documentFormatOf(fileName?: string | null): string;
export function describeSampleSupport(fileName?: string | null): TemplateSupport;
export function classifyHeading(rawLine?: string | null): { level: number; title: string } | null;
export function isHeadingLine(line?: string | null): boolean;
export function buildTable(
  headers?: string[],
  rows?: string[][],
  spans?: Array<Array<[number, number]>>
): { headers: string[]; rows: string[][]; spans?: Array<Array<[number, number]>> };
export function parseTextBlocks(text?: string): SampleBlock[];
export function blocksToText(blocks?: SampleBlock[]): string;
export function extractHwpxBlocks(xml?: string): SampleBlock[];
export function readHwpxBlocks(zip: unknown): Promise<SampleBlock[]>;
export function extractDocxHtmlBlocks(html?: string): SampleBlock[];
export function detectSlotKind(text?: string, blockType?: string): TemplateSlotKind | null;
export function labelledParagraphParts(text?: string | null): Array<{ label: string; fillLabel: string; value: string }>;
export function detectDocumentTitleText(text?: string | null): string;
export function emptyTemplateSchema(fileName?: string): TemplateSchema;
export function parseSampleTemplate(input?: {
  text?: string;
  blocks?: SampleBlock[];
  fileName?: string;
  format?: string;
}): TemplateSchema;
export function summarizeSchema(schema?: TemplateSchema | null): TemplateSummary;
export function renderSchemaOutline(schema?: TemplateSchema | null, options?: { maxChars?: number }): string;
export function normalizeProfile(profile?: Partial<TemplateProfile> | null): TemplateProfile;
export function normalizeProfileKeepWhitespace(profile?: Partial<TemplateProfile> | null): TemplateProfile;
export function checkStructureCoverage(
  schema?: TemplateSchema | null,
  markdown?: string
): { total: number; matched: number; ratio: number };
export function buildTemplateFillPrompt(input?: {
  schema?: TemplateSchema | null;
  profile?: Partial<TemplateProfile> | null;
  maxChars?: number;
}): string;
export function buildRuleBasedFill(input?: {
  schema?: TemplateSchema | null;
  profile?: Partial<TemplateProfile> | null;
}): string;
