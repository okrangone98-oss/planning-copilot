export type StageId =
  | "plan"
  | "planBudget"
  | "review"
  | "resources"
  | "promotion"
  | "prep"
  | "run"
  | "issue"
  | "evidence"
  | "settlement"
  | "evaluation"
  | "report";

export type StageTaskDefinition = {
  slug: string;
  title: string;
  priority?: "high" | "normal" | "low";
  startOffset?: number;
  endOffset?: number;
  sessionOffset?: number;
  segment?: string;
  criteria: string;
  dependsOn?: string[];
  sessionScoped?: boolean;
};

export type StageDefinition = {
  id: StageId;
  label: string;
  purpose: string;
  skipHint?: string;
  sessionScoped?: boolean;
  tasks: StageTaskDefinition[];
};

export type StageSummary = {
  id: StageId;
  label: string;
  purpose: string;
  skipHint: string;
  sessionScoped: boolean;
  taskCount: number;
};

export type TemplateTaskDraft = {
  sourceKey: string;
  stage: StageId;
  stageLabel: string;
  sessionSequence: number;
  title: string;
  priority: "high" | "normal" | "low";
  dueDate: string;
  completionCriteria: string;
  dependsOn: string[];
  templateVersion: string;
};

export const TEMPLATE_VERSION: string;
export const STAGES: StageDefinition[];
export const STAGE_IDS: StageId[];
export const MAX_SESSION_COUNT: number;

export function stageLabel(id: string): string;
export function stageIndex(id: string): number;
export function isStageId(id: string): boolean;
export function listStages(): StageSummary[];
export function taskSourceKey(input: {
  templateVersion?: string;
  stage: string;
  sessionSequence?: number;
  slug: string;
}): string;
export function buildTemplateTasks(options?: {
  sessionCount?: number;
  sessions?: Array<{ sequence?: number; startAt?: string }>;
  skipStages?: string[];
  startDate?: string;
  endDate?: string;
  templateVersion?: string;
}): TemplateTaskDraft[];
export function buildSkeletonSessions(count: number): Array<{ sequence: number; title: string; startAt: string }>;
