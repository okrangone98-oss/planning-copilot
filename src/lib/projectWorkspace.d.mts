import type { ApprovalItem, GrantPlan, KnowledgeDoc, ProjectData, ProjectMemoryEntry } from "../types";

export type ProjectTypeId = "national" | "regional" | "contest" | "own" | "other";
export type ProjectStatusId = "planning" | "submitted" | "running" | "done";

export type ProjectMeta = {
  id: string;
  name: string;
  type: ProjectTypeId;
  status: ProjectStatusId;
  deadline: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
};

export type Workspace = {
  schemaVersion: number;
  activeProjectId: string;
  legacyMigrated: boolean;
  projects: ProjectMeta[];
  updatedAt: string;
};

export type ProjectProgressPart = { key: string; label: string; percent: number; weight: number };
export type ProjectProgress = { percent: number; parts: ProjectProgressPart[] };

export type DDayInfo = { days: number | null; label: string; tone: "none" | "soon" | "normal" | "overdue" };

export type WorkspaceSummary = {
  total: number;
  activeName: string;
  byStatus: Array<{ id: ProjectStatusId; label: string; count: number }>;
};

export type WorkspaceEntry = {
  id: string;
  project: ProjectData | null;
  grantPlan: GrantPlan | null;
};

export type WorkspaceArchive = {
  version: number;
  exportedAt: string;
  app: "planning-copilot";
  kind: "workspace";
  workspace: Pick<Workspace, "schemaVersion" | "activeProjectId" | "projects">;
  projects: Array<{ meta: ProjectMeta; project: ProjectData | null; grantPlan: GrantPlan | null }>;
  knowledgeDocs: KnowledgeDoc[];
  approvalItems: ApprovalItem[];
  memoryEntries: ProjectMemoryEntry[];
};

export const WORKSPACE_SCHEMA_VERSION: number;
export const WORKSPACE_STORAGE_KEY: string;
export const LEGACY_PROJECT_KEY: string;
export const LEGACY_GRANT_KEY: string;
export const MAX_PROJECTS: number;
export const PROJECT_TYPES: Array<{ id: ProjectTypeId; label: string }>;
export const PROJECT_STATUSES: Array<{ id: ProjectStatusId; label: string }>;

export function normalizeDeadline(value: unknown): string;
export function projectTypeLabel(id: string): string;
export function projectStatusLabel(id: string): string;
export function createProjectId(seed?: string): string;
export function createProjectMeta(meta?: Partial<ProjectMeta>): ProjectMeta;
export function createEmptyWorkspace(options?: { now?: Date | string; id?: string; name?: string }): Workspace;
export function normalizeWorkspace(raw: unknown, options?: { now?: Date | string }): Workspace;
export function findProject(workspace: Workspace | null | undefined, id: string): ProjectMeta | null;
export function activeProject(workspace: Workspace | null | undefined): ProjectMeta | null;
export function addProject(
  workspace: Workspace | null | undefined,
  meta: Partial<ProjectMeta> | null | undefined,
  now?: Date | string
): { workspace: Workspace; project: ProjectMeta | null; error: string };
export function updateProjectMeta(
  workspace: Workspace,
  id: string,
  patch: Partial<ProjectMeta>,
  now?: Date | string
): Workspace;
export function selectProject(workspace: Workspace, id: string, now?: Date | string): Workspace;
export function duplicateProject(
  workspace: Workspace,
  id: string,
  options?: { name?: string; now?: Date | string }
): { workspace: Workspace; project: ProjectMeta | null; error: string };
export function removeProject(
  workspace: Workspace,
  id: string,
  now?: Date | string
): { workspace: Workspace; removed: ProjectMeta | null; error: string };
export function sortProjects(projects: ProjectMeta[]): ProjectMeta[];
export function workspaceSummary(workspace: Workspace | null | undefined): WorkspaceSummary;
export function projectProgress(input?: { project?: ProjectData | null; plan?: GrantPlan | null }): ProjectProgress;
export function dDayInfo(deadline: string, now?: Date | string): DDayInfo;
export function hasProjectWork(project: unknown): boolean;
export function hasWorkspaceWork(input?: { project?: unknown; plan?: unknown }): boolean;
export function migrateLegacyWorkspace(input: {
  workspace?: unknown;
  legacyProject?: unknown;
  legacyPlan?: unknown;
  now?: Date | string;
}): {
  workspace: Workspace;
  migrated: boolean;
  projectId?: string;
  project?: unknown;
  plan?: unknown;
};
export function stripSecrets<T>(value: T): T;
export function buildWorkspaceArchive(input: {
  workspace: Workspace;
  entries?: Record<string, { project?: ProjectData | null; grantPlan?: GrantPlan | null }>;
  knowledgeDocs?: KnowledgeDoc[];
  approvalItems?: ApprovalItem[];
  memoryEntries?: ProjectMemoryEntry[];
  exportedAt?: string;
}): WorkspaceArchive;
export function parseWorkspaceArchive(
  raw: unknown,
  options?: { now?: Date | string }
): { workspace: Workspace; entries: WorkspaceEntry[]; legacy: boolean };
export function projectStorageKey(id?: string): string;
export function grantStorageKey(id?: string): string;
