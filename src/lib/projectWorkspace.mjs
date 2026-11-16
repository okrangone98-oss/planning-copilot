// 여러 정부·공모·자체 사업을 한 브라우저에서 나눠 관리하는 사업 보드 로직.
// 브라우저(localStorage)와 node 테스트에서 함께 쓰므로 mjs로 두고, 타입은 projectWorkspace.d.mts에 둔다.
// 사업 하나의 작업 데이터는 사업 id별 저장 키(…:projectId)에 따로 둔다.

import {
  budgetSummary,
  checklistSummary,
  daysUntil,
  hasGrantWork,
  reportSummary
} from "./grantWorkflow.mjs";

export const WORKSPACE_SCHEMA_VERSION = 3;
export const WORKSPACE_ARCHIVE_VERSION = 7;
export const WORKSPACE_STORAGE_KEY = "planningCopilotWorkspace";
export const LEGACY_PROJECT_KEY = "planningCopilotProject";
export const LEGACY_GRANT_KEY = "planningCopilotGrantPlan";
export const MAX_PROJECTS = 20;
export const PROJECT_WORK_KEY_PREFIX = "planningCopilotProjectWork";

export const PROJECT_TYPES = [
  { id: "national", label: "국고보조" },
  { id: "regional", label: "시군역량" },
  { id: "contest", label: "공모" },
  { id: "own", label: "자체" },
  { id: "other", label: "기타" }
];

// 사업 상태 11종 — 기존 4개 id(planning/submitted/running/done)를 그대로 두고 뒤에 단계를 덧붙였다.
// 저장된 사업의 상태 값이 바뀌지 않아야 해서 새 id를 만들지 않고 상위집합으로 늘렸다.
export const PROJECT_STATUSES = [
  { id: "idea", label: "아이디어" },
  { id: "planning", label: "기획 중" },
  { id: "submitted", label: "신청 완료" },
  { id: "review", label: "검토 중" },
  { id: "confirmed", label: "확정" },
  { id: "preparing", label: "운영 준비" },
  { id: "running", label: "운영 중" },
  { id: "settling", label: "정산·평가" },
  { id: "done", label: "완료" },
  { id: "hold", label: "보류" },
  { id: "cancelled", label: "취소" }
];

/** 보드 아래쪽으로 내리는 상태(끝났거나 멈춘 사업). */
export const INACTIVE_STATUSES = ["done", "hold", "cancelled"];

/** 계획서 진행률을 잴 때 보는 입력 항목. */
const PLAN_FIELDS = ["noticeText", "coreIdea", "problemSituation", "activities", "budgetPlan", "riskPlan"];

const TYPE_IDS = new Set(PROJECT_TYPES.map((type) => type.id));
const STATUS_IDS = new Set(PROJECT_STATUSES.map((status) => status.id));
const INACTIVE_STATUS_SET = new Set(INACTIVE_STATUSES);
const MAX_GOALS = 5;
const MAX_SOURCE_REFS = 8;
const STATUS_ORDER = new Map(PROJECT_STATUSES.map((status, index) => [status.id, index]));

function text(value, max = 120) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+$/g, "").trim().slice(0, max);
}

function isoNow(now) {
  const date = now instanceof Date ? now : now ? new Date(now) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/** 마감일은 YYYY-MM-DD만 보관한다. */
export function normalizeDeadline(value) {
  const raw = text(value, 20);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return "";
  return `${year}-${month}-${day}`;
}

export function projectTypeLabel(id) {
  return PROJECT_TYPES.find((type) => type.id === id)?.label || PROJECT_TYPES[PROJECT_TYPES.length - 1].label;
}

export function projectStatusLabel(id) {
  return PROJECT_STATUSES.find((status) => status.id === id)?.label || PROJECT_STATUSES[0].label;
}

let idCounter = 0;

/** 사업 id. 같은 밀리초에 여러 개를 만들어도 겹치지 않게 한다. */
export function createProjectId(seed) {
  idCounter += 1;
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  const extra = seed ? `-${String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}` : "";
  return `prj_${stamp}${idCounter.toString(36)}${random}${extra}`;
}

function textList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const entry = text(item, maxLength);
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** 연도는 4자리 숫자만 받는다. 없으면 만든 해를 쓴다. */
function normalizeYear(value, fallbackIso) {
  const digits = String(value ?? "").replace(/[^\d]/g, "").slice(0, 4);
  if (digits.length === 4) {
    const year = Number(digits);
    if (year >= 1990 && year <= 2100) return String(year);
  }
  const date = new Date(fallbackIso);
  return Number.isNaN(date.getTime()) ? "" : String(date.getFullYear());
}

export function createProjectMeta({
  name,
  type = "own",
  status = "planning",
  deadline = "",
  progress = 0,
  year,
  ownerName = "",
  startDate = "",
  endDate = "",
  goals = [],
  sourceRefs = [],
  createdAt,
  updatedAt,
  id
} = {}) {
  const nowIso = isoNow(createdAt || updatedAt);
  const start = normalizeDeadline(startDate);
  const end = normalizeDeadline(endDate);
  return {
    id: text(id, 60) || createProjectId(),
    name: text(name, 80) || "새 사업",
    type: TYPE_IDS.has(type) ? type : "own",
    status: STATUS_IDS.has(status) ? status : "planning",
    deadline: normalizeDeadline(deadline),
    progress: Math.min(100, Math.max(0, Math.round(Number(progress) || 0))),
    year: normalizeYear(year, nowIso),
    ownerName: text(ownerName, 40),
    startDate: start,
    // 종료일이 시작일보다 앞서면 저장하지 않는다(기간이 뒤집힌 사업은 기한 계산이 모두 틀어진다).
    endDate: start && end && end < start ? "" : end,
    goals: textList(goals, MAX_GOALS, 80),
    sourceRefs: textList(sourceRefs, MAX_SOURCE_REFS, 200),
    createdAt: nowIso,
    updatedAt: isoNow(updatedAt || createdAt)
  };
}

export function createEmptyWorkspace({ now, id, name = "내 사업 1" } = {}) {
  const meta = createProjectMeta({ id: id || createProjectId(), name, createdAt: now });
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activeProjectId: meta.id,
    legacyMigrated: false,
    projects: [meta],
    updatedAt: meta.updatedAt
  };
}

function normalizeProjectMeta(raw, index, now) {
  const source = raw && typeof raw === "object" ? raw : {};
  return createProjectMeta({
    id: text(source.id, 60) || createProjectId(),
    name: text(source.name, 80) || `사업 ${index + 1}`,
    type: source.type,
    status: source.status,
    deadline: source.deadline,
    progress: source.progress,
    year: source.year,
    ownerName: source.ownerName,
    startDate: source.startDate,
    endDate: source.endDate,
    goals: source.goals,
    sourceRefs: source.sourceRefs,
    createdAt: source.createdAt || now,
    updatedAt: source.updatedAt || source.createdAt || now
  });
}

/** 저장된 값의 모양을 믿지 않고 다시 세운다. 사업이 하나도 없으면 빈 사업을 만든다. */
export function normalizeWorkspace(raw, { now } = {}) {
  if (!raw || typeof raw !== "object") return createEmptyWorkspace({ now });
  const rawProjects = Array.isArray(raw.projects) ? raw.projects.slice(0, MAX_PROJECTS) : [];
  const seen = new Set();
  const projects = [];
  rawProjects.forEach((item, index) => {
    const meta = normalizeProjectMeta(item, index, now);
    if (seen.has(meta.id)) meta.id = createProjectId();
    seen.add(meta.id);
    projects.push(meta);
  });
  if (!projects.length) return createEmptyWorkspace({ now });
  const activeProjectId = projects.some((project) => project.id === raw.activeProjectId) ? raw.activeProjectId : projects[0].id;
  const latest = projects.reduce((acc, project) => (project.updatedAt > acc ? project.updatedAt : acc), projects[0].updatedAt);
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    activeProjectId,
    legacyMigrated: Boolean(raw.legacyMigrated),
    projects,
    updatedAt: text(raw.updatedAt, 40) || latest || isoNow(now)
  };
}

export function findProject(workspace, id) {
  return workspace?.projects?.find((project) => project.id === id) || null;
}

export function activeProject(workspace) {
  return findProject(workspace, workspace?.activeProjectId) || workspace?.projects?.[0] || null;
}

function touch(workspace, now) {
  return { ...workspace, updatedAt: isoNow(now) };
}

export function addProject(workspace, meta, now) {
  if (!workspace) {
    const created = createEmptyWorkspace({ now });
    return { workspace: created, project: created.projects[0], error: "" };
  }
  if (workspace.projects.length >= MAX_PROJECTS) {
    return { workspace, project: null, error: `사업은 최대 ${MAX_PROJECTS}개까지 관리할 수 있습니다.` };
  }
  const project = createProjectMeta({ ...meta, createdAt: meta?.createdAt || now });
  const next = touch({ ...workspace, projects: [...workspace.projects, project], activeProjectId: project.id }, now);
  return { workspace: next, project, error: "" };
}

export function updateProjectMeta(workspace, id, patch, now) {
  if (!workspace) return workspace;
  let changed = false;
  const projects = workspace.projects.map((project) => {
    if (project.id !== id) return project;
    changed = true;
    const merged = createProjectMeta({
      ...project,
      ...patch,
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: patch?.updatedAt || isoNow(now)
    });
    return merged;
  });
  if (!changed) return workspace;
  return { ...workspace, projects, updatedAt: isoNow(now) };
}

export function selectProject(workspace, id, now) {
  if (!workspace) return workspace;
  if (!workspace.projects.some((project) => project.id === id)) return workspace;
  return { ...workspace, activeProjectId: id, updatedAt: isoNow(now) };
}

/** 사업 복제: 설정은 그대로 두고 새 id로 한 벌 더 만든다. 내용 복사는 호출한 쪽이 한다. */
export function duplicateProject(workspace, id, { name, now } = {}) {
  const source = findProject(workspace, id);
  if (!source) return { workspace, project: null, error: "복제할 사업을 찾지 못했습니다." };
  if (workspace.projects.length >= MAX_PROJECTS) {
    return { workspace, project: null, error: `사업은 최대 ${MAX_PROJECTS}개까지 관리할 수 있습니다.` };
  }
  const project = createProjectMeta({
    ...source,
    id: createProjectId(id),
    name: text(name, 80) || `${source.name} 복제`,
    createdAt: now,
    updatedAt: now
  });
  const next = touch({ ...workspace, projects: [...workspace.projects, project], activeProjectId: project.id }, now);
  return { workspace: next, project, error: "" };
}

/** 마지막 남은 사업은 지우지 않는다. 작업할 자리가 사라지면 화면 전체가 빈 채로 남기 때문이다. */
export function removeProject(workspace, id, now) {
  if (!workspace) return { workspace, removed: null, error: "사업을 찾지 못했습니다." };
  if (workspace.projects.length <= 1) return { workspace, removed: null, error: "마지막 사업은 삭제할 수 없습니다. 새 사업을 먼저 만들어 주세요." };
  const removed = findProject(workspace, id);
  if (!removed) return { workspace, removed: null, error: "삭제할 사업을 찾지 못했습니다." };
  const projects = workspace.projects.filter((project) => project.id !== id);
  const activeProjectId = workspace.activeProjectId === id ? projects[0].id : workspace.activeProjectId;
  return { workspace: touch({ ...workspace, projects, activeProjectId }, now), removed, error: "" };
}

/** 보드 순서: 진행 중인 사업이 위로, 마감이 가까운 순. 끝났거나 멈춘 사업은 아래로 내린다. */
export function sortProjects(projects) {
  return [...(projects || [])].sort((left, right) => {
    const leftDone = INACTIVE_STATUS_SET.has(left.status) ? 1 : 0;
    const rightDone = INACTIVE_STATUS_SET.has(right.status) ? 1 : 0;
    if (leftDone !== rightDone) return leftDone - rightDone;
    const leftDeadline = left.deadline || "9999-12-31";
    const rightDeadline = right.deadline || "9999-12-31";
    if (leftDeadline !== rightDeadline) return leftDeadline < rightDeadline ? -1 : 1;
    const leftStatus = STATUS_ORDER.get(left.status) ?? 0;
    const rightStatus = STATUS_ORDER.get(right.status) ?? 0;
    if (leftStatus !== rightStatus) return rightStatus - leftStatus;
    return left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0;
  });
}

export function workspaceSummary(workspace) {
  const projects = workspace?.projects || [];
  return {
    total: projects.length,
    activeName: activeProject(workspace)?.name || "",
    byStatus: PROJECT_STATUSES.map((status) => ({
      id: status.id,
      label: status.label,
      count: projects.filter((project) => project.status === status.id).length
    }))
  };
}

function filledPercent(project, fields) {
  if (!project) return 0;
  const total = fields.length;
  if (!total) return 0;
  const filled = fields.filter((field) => String(project[field] ?? "").trim().length > 0).length;
  return Math.round((filled / total) * 100);
}

/** 사업 하나의 진행률: 계획서 40 · 예산 25 · 정산 20 · 결과보고 15. */
export function projectProgress({ project, plan } = {}) {
  const planPercent = filledPercent(project, PLAN_FIELDS);
  const budget = budgetSummary(plan);
  const checklist = checklistSummary(plan);
  const report = reportSummary(plan);

  let budgetPercent = 0;
  if (budget.lineCount > 0) budgetPercent = budget.total > 0 ? 100 : 60;
  const parts = [
    { key: "plan", label: "사업계획서", percent: planPercent, weight: 40 },
    { key: "budget", label: "예산 편성", percent: budgetPercent, weight: 25 },
    { key: "checklist", label: "정산 증빙", percent: checklist.percent, weight: 20 },
    { key: "report", label: "결과보고", percent: report.percent, weight: 15 }
  ];
  const percent = Math.round(parts.reduce((sum, part) => sum + (part.percent * part.weight) / 100, 0));
  return { percent: Math.min(100, Math.max(0, percent)), parts };
}

/** 마감일 표기. D-3 / D-DAY / D+2 / 마감 지남. */
export function dDayInfo(deadline, now) {
  const days = daysUntil(deadline, now);
  if (days === null) return { days: null, label: "마감일 없음", tone: "none" };
  if (days > 0) return { days, label: `D-${days}`, tone: days <= 7 ? "soon" : "normal" };
  if (days === 0) return { days, label: "D-DAY", tone: "soon" };
  return { days, label: `D+${Math.abs(days)}`, tone: "overdue" };
}

/** 저장된 사업 데이터가 비어 있는지. (마이그레이션 여부 판단) */
export function hasProjectWork(project) {
  if (!project || typeof project !== "object") return false;
  for (const value of Object.values(project)) {
    if (typeof value === "string" && value.trim()) return true;
    if (Array.isArray(value) && value.some((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim()))) return true;
  }
  return false;
}

export function hasWorkspaceWork({ project, plan } = {}) {
  return hasProjectWork(project) || hasGrantWork(plan);
}

/**
 * 예전 단일 저장 키 데이터를 1번 사업 슬롯으로 옮긴다.
 * 옮긴 데이터는 그대로 돌려주므로 호출한 쪽이 화면 상태에 넣는다. 원래 키는 지우지 않는다.
 */
export function migrateLegacyWorkspace({ workspace, legacyProject, legacyPlan, now } = {}) {
  const base = normalizeWorkspace(workspace, { now });
  if (base.legacyMigrated) return { workspace: base, migrated: false, project: null, plan: null };

  if (!hasWorkspaceWork({ project: legacyProject, plan: legacyPlan })) {
    return { workspace: { ...base, legacyMigrated: true }, migrated: false, project: null, plan: null };
  }

  const name = text(legacyProject?.projectName, 80) || "기존 사업";
  // 기존 슬롯이 기본 이름 그대로면 그 자리를 쓰고, 이미 다른 사업이 있으면 새 슬롯을 만든다.
  const only = base.projects.length === 1 ? base.projects[0] : null;
  const target = only && /^내 사업 \d+$/.test(only.name) ? only : null;
  if (target) {
    const projects = [{ ...target, name, updatedAt: isoNow(now) }];
    return {
      workspace: { ...base, projects, activeProjectId: target.id, legacyMigrated: true, updatedAt: isoNow(now) },
      migrated: true,
      projectId: target.id,
      project: legacyProject,
      plan: legacyPlan || null
    };
  }

  const meta = createProjectMeta({ name, createdAt: now });
  return {
    workspace: {
      ...base,
      projects: [...base.projects, meta],
      activeProjectId: meta.id,
      legacyMigrated: true,
      updatedAt: isoNow(now)
    },
    migrated: true,
    projectId: meta.id,
    project: legacyProject,
    plan: legacyPlan || null
  };
}

/* ── 백업·복원 ─────────────────────────────────────────────── */

const SECRET_KEY = /^(api_?key|apikey|access_?token|refresh_?token|secret|client_?secret|token)$/i;

/** API 키·토큰류는 백업 파일에 절대 담지 않는다. 저장된 값에 섞여 있어도 걷어낸다. */
export function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue;
      copy[key] = stripSecrets(item);
    }
    return copy;
  }
  return value;
}

/**
 * 여러 사업을 한 파일로 백업한다.
 * entries: { [projectId]: { project, grantPlan } }
 */
export function buildWorkspaceArchive({ workspace, entries = {}, knowledgeDocs, approvalItems, memoryEntries, exportedAt } = {}) {
  const normalized = normalizeWorkspace(workspace);
  return {
    version: WORKSPACE_ARCHIVE_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    app: "planning-copilot",
    kind: "workspace",
    workspace: {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      activeProjectId: normalized.activeProjectId,
      projects: normalized.projects
    },
    projects: normalized.projects.map((meta) => {
      const entry = entries[meta.id] || {};
      return stripSecrets({
        meta,
        project: entry.project || null,
        grantPlan: entry.grantPlan || null,
        // 업무·회차·리비전·변경 이력. 예전(v6) 백업에는 없으므로 null로 둔다.
        work: entry.work || null
      });
    }),
    knowledgeDocs: Array.isArray(knowledgeDocs) ? stripSecrets(knowledgeDocs) : [],
    approvalItems: Array.isArray(approvalItems) ? stripSecrets(approvalItems) : [],
    memoryEntries: Array.isArray(memoryEntries) ? stripSecrets(memoryEntries) : []
  };
}

/** 백업 파일을 읽어 사업 목록과 사업별 데이터로 나눈다. 예전 단일 백업도 받아 준다. */
export function parseWorkspaceArchive(raw, { now } = {}) {
  const archive = raw && typeof raw === "object" ? raw : {};
  const workspaceRaw = archive.workspace && typeof archive.workspace === "object" ? archive.workspace : null;

  if (workspaceRaw && Array.isArray(archive.projects)) {
    const workspace = normalizeWorkspace(workspaceRaw, { now });
    const byId = new Map();
    for (const item of archive.projects) {
      const id = text(item?.meta?.id, 60);
      if (!id) continue;
      byId.set(id, {
        id,
        project: item.project && typeof item.project === "object" ? item.project : null,
        grantPlan: item.grantPlan && typeof item.grantPlan === "object" ? item.grantPlan : null,
        work: item.work && typeof item.work === "object" ? item.work : null
      });
    }
    return {
      workspace: { ...workspace, legacyMigrated: true },
      entries: workspace.projects.map((meta) => byId.get(meta.id) || { id: meta.id, project: null, grantPlan: null, work: null }),
      legacy: false
    };
  }

  // 예전 백업: 사업 하나짜리 파일.
  const project = archive.project && typeof archive.project === "object" ? archive.project : null;
  const grantPlan = archive.grantPlan && typeof archive.grantPlan === "object" ? archive.grantPlan : null;
  const base = createEmptyWorkspace({ now, name: text(project?.projectName, 80) || "복원한 사업" });
  return {
    workspace: { ...base, legacyMigrated: true },
    entries: [{ id: base.activeProjectId, project, grantPlan, work: null }],
    legacy: true
  };
}

/** 사업별 저장 키. id가 없으면 예전 단일 키를 가리킨다. */
export function projectStorageKey(id) {
  return id ? `${LEGACY_PROJECT_KEY}:${id}` : LEGACY_PROJECT_KEY;
}

export function grantStorageKey(id) {
  return id ? `${LEGACY_GRANT_KEY}:${id}` : LEGACY_GRANT_KEY;
}

/** 사업별 운영 데이터 저장 키(업무·회차·리비전·변경 이력). */
export function projectWorkStorageKey(id) {
  return `${PROJECT_WORK_KEY_PREFIX}:${id || ""}`;
}
