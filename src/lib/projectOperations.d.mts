import type { GrantPlan, ProjectData } from "../types";
import type { ProjectMeta, ProjectStatusId } from "./projectWorkspace.mjs";
import type { StageId } from "./stageTemplate.mjs";

export type TaskStatusId = "planned" | "doing" | "done" | "hold" | "cancelled";
export type TaskPriorityId = "high" | "normal" | "low";
export type SessionStatusId = "planned" | "done" | "cancelled";
export type ChangeEntityType = "meta" | "task" | "session" | "budget" | "plan";

export type WorkTask = {
  id: string;
  title: string;
  stage: StageId | "";
  sessionId: string;
  owner: string;
  dueDate: string;
  status: TaskStatusId;
  priority: TaskPriorityId;
  dependsOn: string[];
  completionCriteria: string;
  sourceKey: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string;
};

export type ProjectSession = {
  id: string;
  sequence: number;
  title: string;
  startAt: string;
  venue: string;
  instructorName: string;
  capacity: number;
  registered: number;
  attended: number;
  status: SessionStatusId;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type RevisionSnapshot = {
  meta: {
    name?: string;
    type?: string;
    status?: string;
    year?: string;
    ownerName?: string;
    startDate?: string;
    endDate?: string;
    deadline?: string;
    goals?: string[];
  };
  plan: Record<string, string>;
  grant: {
    programName?: string;
    budgetLines?: Array<{ category?: string; item?: string; unitCost?: string; quantity?: string; note?: string }>;
    schedule?: Record<string, string>;
  };
};

export type PlanRevision = {
  id: string;
  revision: number;
  approvedAt: string;
  reason: string;
  snapshot: RevisionSnapshot;
};

export type ChangeLogEntry = {
  id: string;
  entityType: ChangeEntityType;
  entityId: string;
  field: string;
  before: string;
  after: string;
  reason: string;
  changedAt: string;
};

export type GenerationRecord = {
  id: string;
  templateVersion: string;
  revision: number;
  appliedAt: string;
  added: number;
  skipped: number;
  sessionCount: number;
};

export type ProjectWork = {
  schemaVersion: number;
  projectId: string;
  tasks: WorkTask[];
  sessions: ProjectSession[];
  revisions: PlanRevision[];
  changes: ChangeLogEntry[];
  generations: GenerationRecord[];
  updatedAt: string;
};

export type WorkSummary = {
  total: number;
  active: number;
  open: number;
  byStatus: Record<TaskStatusId, number>;
  done: number;
  overdue: number;
  dueToday: number;
  dueSoon: number;
  percent: number;
  today: string;
  sessions: SessionSummary;
};

export type SessionSummary = {
  total: number;
  active: number;
  planned: number;
  done: number;
  cancelled: number;
  capacity: number;
  registered: number;
  attended: number;
};

export type TaskBuckets = {
  overdue: WorkTask[];
  today: WorkTask[];
  upcoming: WorkTask[];
  unscheduled: WorkTask[];
};

export type GenerationPreviewTask = {
  sourceKey: string;
  stage: StageId;
  stageLabel: string;
  sessionSequence: number;
  title: string;
  priority: TaskPriorityId;
  dueDate: string;
  completionCriteria: string;
  dependsOn: string[];
  templateVersion: string;
  state: "new" | "kept" | "blocked";
};

export type GenerationPreview = {
  templateVersion: string;
  status: string;
  blocked: boolean;
  blockedReason: string;
  confirmRequired: boolean;
  startDate: string;
  endDate: string;
  sessionCount: number;
  newSessions: Array<{ sequence: number; title: string; startAt: string }>;
  skippedStages: string[];
  tasks: GenerationPreviewTask[];
  counts: {
    stages: number;
    taskTotal: number;
    newTasks: number;
    keptTasks: number;
    newSessions: number;
    sessionCount: number;
  };
  warnings: string[];
};

export type NextAction = {
  kind: "overdue" | "today" | "session" | "confirm" | "generate" | "budget";
  priority: number;
  projectId: string;
  projectName: string;
  section: string;
  tab: "overview" | "tasks" | "sessions" | "budget";
  label: string;
  detail: string;
  actionLabel: string;
  taskId?: string;
  sessionId?: string;
};

export type ProjectDigest = {
  overdue: number;
  dueToday: number;
  dueSoon: number;
  overdueItems: Array<{ projectId: string; projectName: string; title: string; dueDate: string }>;
  running: ProjectMeta[];
  next: NextAction | null;
};

export type BulkDatePreview = {
  items: Array<{ taskId: string; title: string; before: string; after: string }>;
  count: number;
  unchanged: number;
  error: string;
  mode: "shift" | "set";
  scope: "all" | "stage" | "session" | "ids";
  days: number;
  date: string;
};

export type DigestEntry = {
  projectId: string;
  projectName: string;
  meta: ProjectMeta;
  work: ProjectWork;
  plan?: GrantPlan;
};

export const PROJECT_WORK_SCHEMA_VERSION: number;
export const WORK_LIMITS: {
  tasks: number;
  sessions: number;
  revisions: number;
  changes: number;
  generations: number;
  snapshotBytes: number;
};
export const TASK_STATUSES: Array<{ id: TaskStatusId; label: string }>;
export const TASK_PRIORITIES: Array<{ id: TaskPriorityId; label: string }>;
export const SESSION_STATUSES: Array<{ id: SessionStatusId; label: string }>;
export const CONFIRM_REQUIRED_STATUSES: ProjectStatusId[];
export const GENERATABLE_STATUSES: ProjectStatusId[];
export const CLOSED_STATUSES: ProjectStatusId[];

export function taskStatusLabel(id: string): string;
export function taskPriorityLabel(id: string): string;
export function sessionStatusLabel(id: string): string;
export function taskFieldLabel(field: string): string;
export function sessionFieldLabel(field: string): string;

export function createEmptyProjectWork(projectId?: string, now?: Date | string): ProjectWork;
export function sanitizeProjectWork(raw: unknown, options?: { projectId?: string; now?: Date | string }): ProjectWork;
export function isProjectWorkEmpty(work: unknown): boolean;
export function workSummary(work: ProjectWork | null | undefined, now?: Date | string): WorkSummary;
export function taskBuckets(work: ProjectWork | null | undefined, now?: Date | string): TaskBuckets;
export function sessionSummary(work: ProjectWork | null | undefined): SessionSummary;
export function taskDependencyState(
  task: WorkTask | null | undefined,
  work: ProjectWork | null | undefined
): { blocked: boolean; pending: Array<{ id: string; title: string }> };

export function buildChangeEntries(input?: {
  entityType?: ChangeEntityType;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  fields?: string[];
  labels?: Record<string, string>;
  formatters?: Record<string, (value: unknown) => string>;
  reason?: string;
  now?: Date | string;
}): ChangeLogEntry[];
export function appendChanges(work: ProjectWork, entries: ChangeLogEntry[]): ProjectWork;

export function addTask(
  work: ProjectWork | null | undefined,
  input?: Partial<WorkTask>,
  now?: Date | string
): { work: ProjectWork; task: WorkTask | null; error: string };
export function updateTask(
  work: ProjectWork | null | undefined,
  id: string,
  patch?: Partial<WorkTask>,
  options?: { now?: Date | string; reason?: string }
): { work: ProjectWork; task: WorkTask | null; error: string };
export function removeTask(
  work: ProjectWork | null | undefined,
  id: string,
  now?: Date | string
): { work: ProjectWork; removed: WorkTask | null; error: string };

export function addSession(
  work: ProjectWork | null | undefined,
  input?: Partial<ProjectSession>,
  now?: Date | string
): { work: ProjectWork; session: ProjectSession | null; error: string };
export function updateSession(
  work: ProjectWork | null | undefined,
  id: string,
  patch?: Partial<ProjectSession>,
  options?: { now?: Date | string; reason?: string }
): { work: ProjectWork; session: ProjectSession | null; error: string };
export function cancelSession(
  work: ProjectWork | null | undefined,
  id: string,
  options?: { now?: Date | string; holdTasks?: boolean; reason?: string }
): { work: ProjectWork; session: ProjectSession | null; held: number; error: string };

export function bulkDatePreview(
  work: ProjectWork | null | undefined,
  request?: {
    scope?: "all" | "stage" | "session" | "ids";
    taskIds?: string[];
    stage?: string;
    sessionId?: string;
    mode?: "shift" | "set";
    days?: number;
    date?: string;
    includeDone?: boolean;
  }
): BulkDatePreview;
export function applyBulkDateChanges(
  work: ProjectWork | null | undefined,
  preview: BulkDatePreview,
  options?: { now?: Date | string; reason?: string }
): { work: ProjectWork; changed: number };

export function buildGenerationPreview(input?: {
  meta?: ProjectMeta | null;
  plan?: GrantPlan | null;
  work?: ProjectWork | null;
  options?: { sessionCount?: number; skipStages?: string[]; templateVersion?: string };
}): GenerationPreview;
export function applyGeneration(input?: {
  work?: ProjectWork | null;
  preview?: GenerationPreview | null;
  now?: Date | string;
  revision?: number;
}): {
  work: ProjectWork;
  error: string;
  added: number;
  skipped: number;
  newSessions: number;
  generation?: GenerationRecord;
};

export function createRevision(input?: {
  work?: ProjectWork | null;
  meta?: Partial<ProjectMeta> | null;
  project?: Partial<ProjectData> | null;
  grantPlan?: GrantPlan | null;
  reason?: string;
  now?: Date | string;
}): { revision: PlanRevision; work: ProjectWork };
export function latestRevision(work: ProjectWork | null | undefined): PlanRevision | null;
export function nextAction(entries: DigestEntry[], now?: Date | string): NextAction | null;
export function projectDigest(entries: DigestEntry[], now?: Date | string): ProjectDigest;
export function groupTasksByStage(tasks: WorkTask[]): Array<{ stage: string; label: string; order: number; items: WorkTask[] }>;
