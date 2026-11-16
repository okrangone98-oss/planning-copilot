import type { GrantPlan, ProjectData } from "../types";
import type { ProjectMeta } from "./projectWorkspace.mjs";
import type { ProjectWork } from "./projectOperations.mjs";

export type ProjectDataLine = { section: string; label: string; value: string };

export type ProjectDataCounts = {
  lines: number;
  budgetRows: number;
  budgetLines: number;
  expenses: number;
  sessions: number;
  reportSections: number;
};

export type ProjectDataTextResult = {
  /** 2단계 붙여넣기 칸에 넣을 글. 적힌 값이 하나도 없으면 빈 문자열. */
  text: string;
  lines: ProjectDataLine[];
  /** 비어 있어 넣지 않은 항목 이름 — 0으로 채우지 않았다는 것을 화면에 밝힌다. */
  missing: string[];
  counts: ProjectDataCounts;
  /** 길이 제한으로 뒤쪽을 줄였는지. */
  truncated: boolean;
};

export type DigestMergeMode = "empty" | "refresh" | "append";

export type DigestMergeResult = {
  text: string;
  mode: DigestMergeMode;
  /** 사용자가 쓴 글 뒤에 이어 붙이는 경우 — 넣기 전에 확인을 받아야 한다. */
  needsConfirm: boolean;
  changed: boolean;
};

export function buildProjectDataText(input?: {
  meta?: Partial<ProjectMeta> | null;
  plan?: GrantPlan | null;
  work?: ProjectWork | null;
  project?: Partial<ProjectData> | null;
}): ProjectDataTextResult;

export function textSignature(value: unknown): string;

export function projectDataSignature(input?: {
  meta?: Partial<ProjectMeta> | null;
  plan?: GrantPlan | null;
  work?: ProjectWork | null;
  project?: Partial<ProjectData> | null;
}): string;

export function mergeDigestIntoText(input?: {
  existing?: string;
  block?: string;
  previousBlock?: string;
}): DigestMergeResult;

export function digestLoadedNote(input?: {
  loadedAt?: string;
  counts?: Partial<ProjectDataCounts> | null;
  missing?: string[] | null;
  truncated?: boolean;
}): string;

/** 예산 관리표 숫자 블록의 첫 줄 */
export const BUDGET_DIGEST_TITLE: string;

export function buildBudgetDigestText(input?: {
  plan?: GrantPlan | null;
  work?: ProjectWork | null;
}): {
  text: string;
  lines: Array<{ label: string; value: string }>;
  counts: { lines: number; budgetLines: number; expenseCount: number };
  missing: string[];
};

export function replaceDigestSection(existing: unknown, block: unknown): {
  text: string;
  removed: number;
  changed: boolean;
};
