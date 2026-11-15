export type FillValue = string | string[];

export type FillCursor = { key: string; label: string; list: string[]; index: number; array: boolean };
export type FillCursors = Map<string, FillCursor>;

export type FilledEntry = {
  key: string;
  label: string;
  value: string;
  where: string;
  kind: "cell" | "column" | "inline" | "mustache" | "bracket" | "blank";
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

export type HwpxPatchResult = {
  bytes: Uint8Array;
  filled: FilledEntry[];
  skipped: SkippedEntry[];
  unmatched: string[];
  sectionCount: number;
  changed: boolean;
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
export function patchSectionXml(
  xml: string,
  values: Record<string, FillValue>,
  options?: { cursors?: FillCursors }
): SectionPatchResult;
export function patchHwpxBytes(options: {
  bytes: Uint8Array | ArrayBuffer;
  values: Record<string, FillValue>;
  jszip?: unknown;
  /** 양식 이양 — 라벨 정규화 키 → 이 글자와 정확히 같은 칸만 갈아끼운다 */
  overwrites?: Record<string, string[]>;
}): Promise<HwpxPatchResult>;
export function filledFileName(fileName: string, fallback?: string): string;
export function summarizeFill(result: { filled?: unknown[]; skipped?: unknown[]; unmatched?: string[] }): string;
