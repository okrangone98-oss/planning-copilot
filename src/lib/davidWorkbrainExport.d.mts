import type { GrantPlan, ProjectData } from "../types";
import type { ProjectWork } from "./projectOperations.mjs";

export type WorkbrainExportOptions = {
  title?: string;
  description?: string;
  domain?: "company" | "personal" | "shared";
  targetFolder?: "01_회사_사업" | "outputs";
  status?: string;
  deadline?: string;
  tags?: string[];
  includeBudget?: boolean;
  includeChecklist?: boolean;
  includeReport?: boolean;
  includeDraft?: boolean;
  includeFollowUps?: boolean;
};

export const DEFAULT_SENSITIVE_HANDLING: string;
export const WORKSPACE_LINKS: Array<{ label: string; url: string; role: string }>;

export function todayLabel(now?: Date | string): string;
export function buildWorkbrainFileName(options: { programName?: string; title?: string }, now?: Date | string): string;
export function buildWorkbrainMarkdown(input: {
  plan?: GrantPlan | null;
  project?: ProjectData | null;
  options?: WorkbrainExportOptions;
  /** 있으면 회차 참석 연인원과 비목별 집행·잔액을 ‘운영 실적·집행 현황’으로 함께 싣는다. */
  work?: ProjectWork | null;
  now?: Date | string;
}): string;
export function buildNotionPasteMarkdown(markdown: string): string;
