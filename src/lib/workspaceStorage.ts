import { emptyProject, type ApprovalItem, type GrantPlan, type KnowledgeDoc, type ProjectData, type ProjectMemoryEntry } from "../types";
import { createEmptyGrantPlan, sanitizeGrantPlan } from "./grantWorkflow.mjs";
import {
  LEGACY_GRANT_KEY,
  LEGACY_PROJECT_KEY,
  WORKSPACE_STORAGE_KEY,
  buildWorkspaceArchive,
  grantStorageKey,
  migrateLegacyWorkspace,
  normalizeWorkspace,
  parseWorkspaceArchive,
  projectStorageKey,
  type Workspace,
  type WorkspaceArchive,
  type WorkspaceEntry
} from "./projectWorkspace.mjs";

const PII_MASK_KEY = "planningCopilotPiiMask";

/** 저장된 사업 데이터를 믿지 않고 빈 프로젝트 모양에 맞춰 다시 만든다. */
export function sanitizeProjectData(raw: unknown): ProjectData {
  const source = raw && typeof raw === "object" ? (raw as Partial<ProjectData>) : {};
  const project: ProjectData = { ...emptyProject };
  for (const key of Object.keys(emptyProject) as Array<keyof ProjectData>) {
    const value = source[key];
    if (key === "metricsTable" || key === "blueprintTable") {
      const rows = Array.isArray(value) ? value : [];
      const cleaned = rows
        .filter((row) => Array.isArray(row))
        .slice(0, 80)
        .map((row) => (row as unknown[]).slice(0, 8).map((cell) => String(cell ?? "").slice(0, 400)));
      if (cleaned.length) project[key] = cleaned as ProjectData[typeof key];
      continue;
    }
    if (typeof value === "string") project[key] = value.slice(0, 200000) as ProjectData[typeof key];
  }
  return project;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 저장 공간이 부족해도 화면 작업은 계속한다. 화면 상태는 메모리에 남아 있다.
    return false;
  }
}

export function loadProjectData(id: string, options: { allowLegacyFallback?: boolean } = {}): ProjectData {
  const stored = readJson<ProjectData>(projectStorageKey(id));
  if (stored) return sanitizeProjectData(stored);
  if (options.allowLegacyFallback) {
    const legacy = readJson<ProjectData>(LEGACY_PROJECT_KEY);
    if (legacy) return sanitizeProjectData(legacy);
  }
  return { ...emptyProject };
}

export function saveProjectData(id: string, project: ProjectData) {
  writeJson(projectStorageKey(id), project);
}

export function loadSlotGrantPlan(id: string, options: { allowLegacyFallback?: boolean } = {}): GrantPlan {
  const stored = readJson<GrantPlan>(grantStorageKey(id));
  if (stored) return sanitizeGrantPlan(stored);
  if (options.allowLegacyFallback) {
    const legacy = readJson<GrantPlan>(LEGACY_GRANT_KEY);
    if (legacy) return sanitizeGrantPlan(legacy);
  }
  return createEmptyGrantPlan();
}

export function saveSlotGrantPlan(id: string, plan: GrantPlan) {
  // 예산·정산 메모에는 민감자료가 들어올 수 있어 허용 목록으로만 저장한다.
  writeJson(grantStorageKey(id), sanitizeGrantPlan(plan));
}

export function copySlotData(fromId: string, toId: string) {
  const project = readJson<ProjectData>(projectStorageKey(fromId));
  const plan = readJson<GrantPlan>(grantStorageKey(fromId));
  if (project) writeJson(projectStorageKey(toId), sanitizeProjectData(project));
  if (plan) writeJson(grantStorageKey(toId), sanitizeGrantPlan(plan));
}

export function removeSlotData(id: string) {
  try {
    localStorage.removeItem(projectStorageKey(id));
    localStorage.removeItem(grantStorageKey(id));
  } catch {
    // 이미 지워졌으면 그대로 둔다.
  }
}

export type WorkspaceBundle = {
  workspace: Workspace;
  project: ProjectData;
  grantPlan: GrantPlan;
  migrated: boolean;
};

/**
 * 사업 보드와 현재 사업의 작업 데이터를 한 번에 읽는다.
 * 예전 단일 저장 키에 작업이 있으면 첫 사업 슬롯으로 옮겨 담고 원본은 그대로 둔다.
 */
export function loadWorkspaceBundle(): WorkspaceBundle {
  const raw = readJson<unknown>(WORKSPACE_STORAGE_KEY);
  let workspace = normalizeWorkspace(raw);
  let migrated = false;
  const wasMigrated = workspace.legacyMigrated;

  if (!workspace.legacyMigrated) {
    const legacyProject = readJson<ProjectData>(LEGACY_PROJECT_KEY);
    const legacyPlan = readJson<GrantPlan>(LEGACY_GRANT_KEY);
    const result = migrateLegacyWorkspace({ workspace, legacyProject, legacyPlan });
    workspace = result.workspace;
    migrated = result.migrated;
    if (result.migrated && result.projectId) {
      if (legacyProject) saveProjectData(result.projectId, sanitizeProjectData(legacyProject));
      if (legacyPlan) saveSlotGrantPlan(result.projectId, legacyPlan);
    }
  }

  const allowLegacyFallback = workspace.projects.length === 1;
  const project = loadProjectData(workspace.activeProjectId, { allowLegacyFallback });
  const grantPlan = loadSlotGrantPlan(workspace.activeProjectId, { allowLegacyFallback });
  if (!wasMigrated || migrated) saveWorkspace(workspace);
  return { workspace, project, grantPlan, migrated };
}

export function loadWorkspaceForProject(id: string): { project: ProjectData; grantPlan: GrantPlan } {
  return {
    project: loadProjectData(id, { allowLegacyFallback: false }),
    grantPlan: loadSlotGrantPlan(id, { allowLegacyFallback: false })
  };
}

export function saveWorkspace(workspace: Workspace) {
  writeJson(WORKSPACE_STORAGE_KEY, workspace);
}

/** 모든 사업의 작업 데이터를 모아 백업 파일 하나로 만든다. API 키는 담기지 않는다. */
export function exportWorkspaceArchive(input: {
  workspace: Workspace;
  knowledgeDocs: KnowledgeDoc[];
  approvalItems: ApprovalItem[];
  memoryEntries: ProjectMemoryEntry[];
}): WorkspaceArchive {
  const entries: Record<string, { project: ProjectData; grantPlan: GrantPlan }> = {};
  for (const meta of input.workspace.projects) {
    entries[meta.id] = {
      project: loadProjectData(meta.id, { allowLegacyFallback: input.workspace.projects.length === 1 }),
      grantPlan: loadSlotGrantPlan(meta.id, { allowLegacyFallback: input.workspace.projects.length === 1 })
    };
  }
  return buildWorkspaceArchive({ ...input, entries });
}

/** 백업 파일을 브라우저 저장소에 다시 넣는다. 예전 단일 백업도 받아 준다. */
export function importWorkspaceArchive(raw: unknown): { workspace: Workspace; entries: WorkspaceEntry[]; legacy: boolean } {
  const parsed = parseWorkspaceArchive(raw);
  for (const entry of parsed.entries) {
    if (entry.project) saveProjectData(entry.id, sanitizeProjectData(entry.project));
    if (entry.grantPlan) saveSlotGrantPlan(entry.id, entry.grantPlan as GrantPlan);
  }
  saveWorkspace(parsed.workspace);
  return parsed;
}

/** 개인정보 마스킹 기본값은 켜짐. 사용자가 끄면 그 선택을 기억한다. */
export function loadPiiMaskPreference(): boolean {
  try {
    return localStorage.getItem(PII_MASK_KEY) !== "off";
  } catch {
    return true;
  }
}

export function savePiiMaskPreference(enabled: boolean) {
  try {
    localStorage.setItem(PII_MASK_KEY, enabled ? "on" : "off");
  } catch {
    // 저장에 실패해도 이번 세션의 선택은 유지된다.
  }
}
