export type PreviewPatchPlan = {
  /** 채운 본문에서 새로 뽑은 미리보기 글자(CRLF, 최대 1200자) */
  previewText: string;
  /** ZIP 에서 빼야 할 옛 미리보기 그림 엔트리(Preview/PrvImage.png 등) */
  removeEntries: string[];
};

export type PreviewStripResult = { xml: string; changed: boolean; removed: string[] };

export const PREVIEW_TEXT_ENTRY: string;
export const PREVIEW_IMAGE_ENTRY: string;
export const DEFAULT_PREVIEW_TEXT_LIMIT: number;

export function isPreviewTextEntry(name: string): boolean;
export function isPreviewImageEntry(name: string): boolean;
export function extractPreviewText(sectionXmls: string | string[], options?: { limit?: number }): string;
export function stripPreviewImageReferences(xml: string): PreviewStripResult;
export function planPreviewPatch(input?: { names?: string[]; sectionXmls?: string[]; limit?: number }): PreviewPatchPlan;
export function isPackageListEntry(name: string): boolean;
export function writePreviewText(output: unknown, previewText: string): boolean;
