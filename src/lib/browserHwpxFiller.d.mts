export type FillValue = string | string[];

/** 라벨 없는 자리(문서 제목)의 갈아끼우기 — from 글자와 같은 문단만 to 로 바꾼다 */
export type TextRewriteInput = { from: string; to: string; label?: string; fieldId?: string };

export type FillCursor = { key: string; label: string; list: string[]; index: number; array: boolean };
export type FillCursors = Map<string, FillCursor>;

export type FilledEntry = {
  key: string;
  label: string;
  value: string;
  where: string;
  kind: "cell" | "column" | "inline" | "mustache" | "bracket" | "blank" | "text";
  section?: string;
};

export type SkippedEntry = {
  label: string;
  key?: string;
  reason: string;
  current?: string;
  where: string;
  section?: string;
};

export type SectionPatchResult = {
  xml: string;
  filled: FilledEntry[];
  skipped: SkippedEntry[];
  changed: boolean;
};

export type HwpxPreviewResult = {
  /** 채운 본문에서 새로 뽑은 미리보기 글자 */
  text: string;
  chars: number;
  /** ZIP 에서 빼버린 옛 미리보기 그림 엔트리 */
  removedImages: string[];
  /** 미리보기 글자를 넣었는지 */
  written: boolean;
};

export type HwpxPatchResult = {
  bytes: Uint8Array;
  filled: FilledEntry[];
  skipped: SkippedEntry[];
  unmatched: string[];
  sectionCount: number;
  changed: boolean;
  preview: HwpxPreviewResult;
};

export type HwpxXmlNode = {
  name: string;
  local: string;
  attrs: string;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  children: HwpxXmlNode[];
  parent: HwpxXmlNode | null;
};

export const HWPX_MIME: string;

export function parseHwpxXml(xml: string): HwpxXmlNode & { local: "#root" };
export function escapeXmlText(value: string): string;
export function createFillCursors(values: Record<string, FillValue>): FillCursors;
export function fillableValueState(text: string): { fillable: boolean; placeholder: string; label?: string };
/** 예산 관리표를 양식 표에 넣을 때 넘기는 값 — 열 머리글과 행 값(행 순서대로). */
export type BudgetSheetFillInput = {
  columns: Array<{ id: string; role: string; label: string; kind?: string; numeric?: boolean }>;
  rows: string[][];
};

export function matchBudgetHeader(
  cells: Array<{ text?: string; colAddr: number }>,
  columns: Array<{ id: string; role: string; label: string }>
): Array<{ colAddr: number; index: number; column: { id: string; role: string; label: string } }>;
export function patchSectionXml(
  xml: string,
  values: Record<string, FillValue>,
  options?: {
    cursors?: FillCursors;
    overwrites?: Record<string, string[]>;
    rewrites?: TextRewriteInput[];
    budgetSheet?: BudgetSheetFillInput;
  }
): SectionPatchResult;
export function patchHwpxBytes(options: {
  bytes: Uint8Array | ArrayBuffer;
  values: Record<string, FillValue>;
  jszip?: unknown;
  /** 양식 이양 — 라벨 정규화 키 → 이 글자와 정확히 같은 칸만 갈아끼운다 */
  overwrites?: Record<string, string[]>;
  /** 문서 제목처럼 라벨이 없는 자리 — 원문 글자(from)와 같은 문단만 to 로 바꾼다 */
  rewrites?: Array<{ from: string; to: string; label?: string; fieldId?: string }>;
  /** 예산 관리표의 열 머리글·행 값 — 양식의 예산 표를 사용자의 표 그대로 채운다 */
  budgetSheet?: BudgetSheetFillInput;
}): Promise<HwpxPatchResult>;
export function filledFileName(fileName: string, fallback?: string): string;
export function summarizeFill(result: { filled?: unknown[]; skipped?: unknown[]; unmatched?: string[] }): string;
