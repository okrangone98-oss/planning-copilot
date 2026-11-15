// 사업 하나의 운영 데이터(업무·일정·회차·리비전·변경 이력) 로직.
// 브라우저(localStorage)와 node 테스트에서 함께 쓰므로 mjs로 두고, 타입은 projectOperations.d.mts에 둔다.
// 금액은 여기서 다루지 않는다. 예산의 유일한 원천은 grantPlan.budgetLines이고, 이 모듈은 개수·상태만 센다.

import { daysUntil } from "./grantWorkflow.mjs";
import { normalizeDeadline } from "./projectWorkspace.mjs";
import {
  MAX_SESSION_COUNT,
  buildSkeletonSessions,
  buildTemplateTasks,
  isStageId,
  stageIndex,
  stageLabel,
  TEMPLATE_VERSION
} from "./stageTemplate.mjs";

export const PROJECT_WORK_SCHEMA_VERSION = 1;

export const WORK_LIMITS = {
  tasks: 400,
  sessions: 60,
  revisions: 20,
  changes: 300,
  generations: 50,
  snapshotBytes: 200_000
};

export const TASK_STATUSES = [
  { id: "planned", label: "예정" },
  { id: "doing", label: "진행" },
  { id: "done", label: "완료" },
  { id: "hold", label: "보류" },
  { id: "cancelled", label: "취소" }
];

export const TASK_PRIORITIES = [
  { id: "high", label: "높음" },
  { id: "normal", label: "보통" },
  { id: "low", label: "낮음" }
];

export const SESSION_STATUSES = [
  { id: "planned", label: "예정" },
  { id: "done", label: "완료" },
  { id: "cancelled", label: "취소" }
];

/** 확정 전 단계 — 업무를 만들려면 먼저 계획을 확정해야 한다. */
export const CONFIRM_REQUIRED_STATUSES = ["idea", "planning", "submitted", "review"];
/** 확정 이후 단계 — 운영 업무 생성이 허용된다. */
export const GENERATABLE_STATUSES = ["confirmed", "preparing", "running", "settling"];
/** 끝난 사업 — 새 업무를 만들지 않는다. */
export const CLOSED_STATUSES = ["done", "hold", "cancelled"];

const TASK_STATUS_IDS = new Set(TASK_STATUSES.map((status) => status.id));
const TASK_PRIORITY_IDS = new Set(TASK_PRIORITIES.map((priority) => priority.id));
const SESSION_STATUS_IDS = new Set(SESSION_STATUSES.map((status) => status.id));
const ENTITY_TYPES = new Set(["meta", "task", "session", "budget", "plan"]);

const TASK_FIELD_LABELS = {
  title: "업무명",
  stage: "단계",
  owner: "담당",
  dueDate: "기한",
  status: "상태",
  priority: "우선순위",
  completionCriteria: "완료 조건",
  dependsOn: "선행 업무",
  sessionId: "회차"
};

const SESSION_FIELD_LABELS = {
  sequence: "회차 번호",
  title: "회차명",
  startAt: "일시",
  venue: "장소",
  instructorName: "강사",
  capacity: "정원",
  registered: "신청",
  attended: "참석",
  status: "상태",
  notes: "메모"
};

let workIdCounter = 0;

function createWorkId(prefix) {
  workIdCounter += 1;
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${stamp}${workIdCounter.toString(36)}${random}`;
}

function text(value, max = 120) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value !== "string") return "";
  return value.replace(/\s+$/g, "").trim().slice(0, max);
}

function isoNow(now) {
  const date = now instanceof Date ? now : now ? new Date(now) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function count(value, max = 100_000) {
  const number = Math.round(Number(value) || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(max, number));
}

function dayText(value) {
  return String(value || "").slice(0, 10);
}

/** 회차 일시는 YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm만 받는다. 달력에 없는 날짜는 버린다. */
function dateTimeText(value) {
  const raw = text(value, 20);
  const match = /^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?$/.exec(raw);
  if (!match) return "";
  const [, year, month, day, , hour, minute] = match;
  if (!normalizeDeadline(`${year}-${month}-${day}`)) return "";
  if (hour !== undefined) {
    if (Number(hour) > 23 || Number(minute) > 59) return "";
  }
  return raw;
}

function todayText(now) {
  const date = now instanceof Date ? now : now ? new Date(now) : new Date();
  if (Number.isNaN(date.getTime())) return dayText(new Date().toISOString());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(dateTextValue, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateTextValue || "").trim());
  if (!match) return "";
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(base)) return "";
  return new Date(base + Math.round(Number(days) || 0) * 86400000).toISOString().slice(0, 10);
}

export function taskStatusLabel(id) {
  return TASK_STATUSES.find((status) => status.id === id)?.label || TASK_STATUSES[0].label;
}

export function taskPriorityLabel(id) {
  return TASK_PRIORITIES.find((priority) => priority.id === id)?.label || TASK_PRIORITIES[1].label;
}

export function sessionStatusLabel(id) {
  return SESSION_STATUSES.find((status) => status.id === id)?.label || SESSION_STATUSES[0].label;
}

export function taskFieldLabel(field) {
  return TASK_FIELD_LABELS[field] || field;
}

export function sessionFieldLabel(field) {
  return SESSION_FIELD_LABELS[field] || field;
}

/* ── 기본 모양 ─────────────────────────────────────────────── */

export function createEmptyProjectWork(projectId = "", now) {
  return {
    schemaVersion: PROJECT_WORK_SCHEMA_VERSION,
    projectId: text(projectId, 60),
    tasks: [],
    sessions: [],
    revisions: [],
    changes: [],
    generations: [],
    updatedAt: isoNow(now)
  };
}

function createTask(raw, now) {
  const source = raw && typeof raw === "object" ? raw : {};
  const status = TASK_STATUS_IDS.has(source.status) ? source.status : "planned";
  const stage = isStageId(source.stage) ? source.stage : "";
  const createdAt = text(source.createdAt, 40) || isoNow(now);
  return {
    id: text(source.id, 60) || createWorkId("task"),
    title: text(source.title, 120) || "이름 없는 업무",
    stage,
    sessionId: text(source.sessionId, 60),
    owner: text(source.owner, 40),
    dueDate: normalizeDeadline(source.dueDate),
    status,
    priority: TASK_PRIORITY_IDS.has(source.priority) ? source.priority : "normal",
    dependsOn: Array.isArray(source.dependsOn)
      ? Array.from(new Set(source.dependsOn.map((id) => text(id, 60)).filter(Boolean))).slice(0, 5)
      : [],
    completionCriteria: text(source.completionCriteria, 200),
    sourceKey: text(source.sourceKey, 160),
    createdAt,
    updatedAt: text(source.updatedAt, 40) || createdAt,
    completedAt: status === "done" ? text(source.completedAt, 40) || createdAt : ""
  };
}

function createSession(raw, now) {
  const source = raw && typeof raw === "object" ? raw : {};
  const createdAt = text(source.createdAt, 40) || isoNow(now);
  const startAt = dateTimeText(source.startAt);
  return {
    id: text(source.id, 60) || createWorkId("ses"),
    sequence: Math.max(1, Math.min(MAX_SESSION_COUNT, Math.round(Number(source.sequence) || 1))),
    title: text(source.title, 120) || `${Math.max(1, Math.round(Number(source.sequence) || 1))}회차`,
    startAt,
    venue: text(source.venue, 80),
    instructorName: text(source.instructorName, 40),
    capacity: count(source.capacity, 100_000),
    registered: count(source.registered, 100_000),
    attended: count(source.attended, 100_000),
    status: SESSION_STATUS_IDS.has(source.status) ? source.status : "planned",
    notes: text(source.notes, 300),
    createdAt,
    updatedAt: text(source.updatedAt, 40) || createdAt
  };
}

function sanitizeRevision(raw, now) {
  const source = raw && typeof raw === "object" ? raw : {};
  const snapshotRaw = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
  let snapshot = {
    meta: snapshotRaw.meta && typeof snapshotRaw.meta === "object" ? snapshotRaw.meta : {},
    plan: snapshotRaw.plan && typeof snapshotRaw.plan === "object" ? snapshotRaw.plan : {},
    grant: snapshotRaw.grant && typeof snapshotRaw.grant === "object" ? snapshotRaw.grant : {}
  };
  // 스냅샷 하나가 저장 공간을 삼키지 않게 예산 행과 긴 글을 줄인다.
  if (Array.isArray(snapshot.grant.budgetLines)) {
    snapshot = {
      ...snapshot,
      grant: { ...snapshot.grant, budgetLines: snapshot.grant.budgetLines.slice(0, 120) }
    };
  }
  if (JSON.stringify(snapshot).length > WORK_LIMITS.snapshotBytes) {
    snapshot = { meta: snapshot.meta, plan: {}, grant: { programName: text(snapshot.grant?.programName, 120) } };
  }
  return {
    id: text(source.id, 60) || createWorkId("rev"),
    revision: Math.max(1, Math.round(Number(source.revision) || 1)),
    approvedAt: text(source.approvedAt, 40) || isoNow(now),
    reason: text(source.reason, 200),
    snapshot
  };
}

function sanitizeChange(raw, now) {
  const source = raw && typeof raw === "object" ? raw : {};
  const entityType = ENTITY_TYPES.has(source.entityType) ? source.entityType : "task";
  return {
    id: text(source.id, 60) || createWorkId("chg"),
    entityType,
    entityId: text(source.entityId, 60),
    field: text(source.field, 40) || "값",
    before: text(source.before, 120),
    after: text(source.after, 120),
    reason: text(source.reason, 200),
    changedAt: text(source.changedAt, 40) || isoNow(now)
  };
}

function sanitizeGeneration(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: text(source.id, 60) || createWorkId("gen"),
    templateVersion: text(source.templateVersion, 40) || TEMPLATE_VERSION,
    revision: Math.max(0, Math.round(Number(source.revision) || 0)),
    appliedAt: text(source.appliedAt, 40) || "",
    added: count(source.added, 1000),
    skipped: count(source.skipped, 1000),
    sessionCount: count(source.sessionCount, MAX_SESSION_COUNT)
  };
}

/** 저장된 값을 믿지 않고 다시 세운다. 상태·우선순위·날짜·상한을 모두 여기서 맞춘다. */
export function sanitizeProjectWork(raw, { projectId = "", now } = {}) {
  if (!raw || typeof raw !== "object") return createEmptyProjectWork(projectId, now);
  const source = raw;

  const sessionSeen = new Set();
  const sessions = (Array.isArray(source.sessions) ? source.sessions : [])
    .slice(0, WORK_LIMITS.sessions)
    .map((item) => createSession(item, now))
    .filter((session) => {
      if (sessionSeen.has(session.id)) return false;
      sessionSeen.add(session.id);
      return true;
    });
  const sessionIds = new Set(sessions.map((session) => session.id));

  const taskSeen = new Set();
  const tasks = (Array.isArray(source.tasks) ? source.tasks : [])
    .slice(0, WORK_LIMITS.tasks)
    .map((item) => createTask(item, now))
    .filter((task) => {
      if (taskSeen.has(task.id)) return false;
      taskSeen.add(task.id);
      return true;
    })
    .map((task) => (task.sessionId && !sessionIds.has(task.sessionId) ? { ...task, sessionId: "" } : task));

  const revisions = (Array.isArray(source.revisions) ? source.revisions : [])
    .slice(0, WORK_LIMITS.revisions)
    .map((item) => sanitizeRevision(item, now));

  const changes = (Array.isArray(source.changes) ? source.changes : [])
    .slice(0, WORK_LIMITS.changes)
    .map((item) => sanitizeChange(item, now));

  const generations = (Array.isArray(source.generations) ? source.generations : [])
    .slice(0, WORK_LIMITS.generations)
    .map((item) => sanitizeGeneration(item));

  return {
    schemaVersion: PROJECT_WORK_SCHEMA_VERSION,
    projectId: text(source.projectId, 60) || text(projectId, 60),
    tasks,
    sessions: sessions.sort((left, right) => left.sequence - right.sequence),
    revisions,
    changes,
    generations,
    updatedAt: text(source.updatedAt, 40) || isoNow(now)
  };
}

export function isProjectWorkEmpty(work) {
  if (!work || typeof work !== "object") return true;
  return !(
    (Array.isArray(work.tasks) && work.tasks.length) ||
    (Array.isArray(work.sessions) && work.sessions.length) ||
    (Array.isArray(work.revisions) && work.revisions.length) ||
    (Array.isArray(work.changes) && work.changes.length) ||
    (Array.isArray(work.generations) && work.generations.length)
  );
}

/* ── 집계 ─────────────────────────────────────────────────── */

/** 열려 있는 업무만 센다(취소는 분모에서 뺀다). */
export function workSummary(work, now) {
  const today = todayText(now);
  const tasks = Array.isArray(work?.tasks) ? work.tasks : [];
  const active = tasks.filter((task) => task.status !== "cancelled");
  const open = active.filter((task) => task.status !== "done");
  const byStatus = Object.fromEntries(TASK_STATUSES.map((status) => [status.id, 0]));
  for (const task of tasks) byStatus[task.status] = (byStatus[task.status] || 0) + 1;

  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;
  for (const task of open) {
    if (!task.dueDate) continue;
    const days = daysUntil(task.dueDate, now);
    if (days === null) continue;
    if (days < 0) overdue += 1;
    else if (days === 0) dueToday += 1;
    else if (days <= 7) dueSoon += 1;
  }

  const done = byStatus.done || 0;
  return {
    total: tasks.length,
    active: active.length,
    open: open.length,
    byStatus,
    done,
    overdue,
    dueToday,
    dueSoon,
    percent: active.length ? Math.round((done / active.length) * 100) : 0,
    today,
    sessions: sessionSummary(work)
  };
}

/** 오늘 할 일: 지연 → 오늘 마감 → 7일 안 마감 → 기한 없음. */
export function taskBuckets(work, now) {
  const today = todayText(now);
  const open = (Array.isArray(work?.tasks) ? work.tasks : []).filter((task) => task.status === "planned" || task.status === "doing");
  const byDue = (left, right) => (left.dueDate || "9999-12-31") < (right.dueDate || "9999-12-31") ? -1 : 1;
  const buckets = { overdue: [], today: [], upcoming: [], unscheduled: [] };
  for (const task of open) {
    if (!task.dueDate) {
      buckets.unscheduled.push(task);
      continue;
    }
    const days = daysUntil(task.dueDate, now);
    if (days === null) buckets.unscheduled.push(task);
    else if (days < 0 || task.dueDate < today) buckets.overdue.push(task);
    else if (days === 0) buckets.today.push(task);
    else if (days <= 7) buckets.upcoming.push(task);
  }
  buckets.overdue.sort(byDue);
  buckets.today.sort(byDue);
  buckets.upcoming.sort(byDue);
  return buckets;
}

/** 회차 집계 — 취소 회차는 인원 합계에서 뺀다(이력은 남긴다). */
export function sessionSummary(work) {
  const sessions = Array.isArray(work?.sessions) ? work.sessions : [];
  const active = sessions.filter((session) => session.status !== "cancelled");
  const sum = (key) => active.reduce((total, session) => total + count(session[key]), 0);
  return {
    total: sessions.length,
    active: active.length,
    planned: sessions.filter((session) => session.status === "planned").length,
    done: sessions.filter((session) => session.status === "done").length,
    cancelled: sessions.filter((session) => session.status === "cancelled").length,
    capacity: sum("capacity"),
    registered: sum("registered"),
    attended: sum("attended")
  };
}

/** 선행 업무가 남아 있으면 '대기'로 본다. */
export function taskDependencyState(task, work) {
  const tasks = Array.isArray(work?.tasks) ? work.tasks : [];
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const pending = (Array.isArray(task?.dependsOn) ? task.dependsOn : [])
    .map((id) => byId.get(id))
    .filter((item) => item && item.status !== "done" && item.status !== "cancelled")
    .map((item) => ({ id: item.id, title: item.title }));
  return { blocked: pending.length > 0, pending };
}

/* ── 변경 이력 ─────────────────────────────────────────────── */

function formatValue(value) {
  if (Array.isArray(value)) return value.map((item) => text(item, 40)).filter(Boolean).join(" · ");
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  return text(String(value), 160);
}

/** 필드별 전후 값을 남긴다. 바뀐 것만 남기고, 값은 120자에서 자른다. */
export function buildChangeEntries({
  entityType = "task",
  entityId = "",
  before = {},
  after = {},
  fields,
  labels = {},
  formatters = {},
  reason = "",
  now
} = {}) {
  const keys = Array.isArray(fields) ? fields : Object.keys(after || {});
  const changedAt = isoNow(now);
  const entries = [];
  for (const field of keys) {
    const format = typeof formatters[field] === "function" ? formatters[field] : formatValue;
    const beforeText = format(before?.[field]);
    const afterText = format(after?.[field]);
    if (beforeText === afterText) continue;
    entries.push({
      id: createWorkId("chg"),
      entityType,
      entityId: text(entityId, 60),
      field: labels[field] || text(field, 40),
      before: beforeText.slice(0, 120),
      after: afterText.slice(0, 120),
      reason: text(reason, 200),
      changedAt
    });
  }
  return entries;
}

/** 새 기록을 앞에 두고 300건까지만 남긴다(오래된 것부터 버린다). */
export function appendChanges(work, entries) {
  if (!Array.isArray(entries) || !entries.length) return work;
  return {
    ...work,
    changes: [...entries, ...(Array.isArray(work.changes) ? work.changes : [])].slice(0, WORK_LIMITS.changes)
  };
}

function withChanges(work, entries, now) {
  const next = appendChanges(work, entries);
  return { ...next, updatedAt: isoNow(now) };
}

/* ── 업무 ─────────────────────────────────────────────────── */

export function addTask(work, input = {}, now) {
  const base = work || createEmptyProjectWork();
  if ((base.tasks || []).length >= WORK_LIMITS.tasks) {
    return { work: base, task: null, error: `업무는 사업당 ${WORK_LIMITS.tasks}개까지 만들 수 있습니다.` };
  }
  const task = createTask({ ...input, createdAt: isoNow(now), updatedAt: isoNow(now) }, now);
  const next = { ...base, tasks: [...(base.tasks || []), task], updatedAt: isoNow(now) };
  return { work: next, task, error: "" };
}

export function updateTask(work, id, patch = {}, { now, reason = "" } = {}) {
  const base = work || createEmptyProjectWork();
  const current = (base.tasks || []).find((task) => task.id === id);
  if (!current) return { work: base, task: null, error: "업무를 찾지 못했습니다." };
  const merged = createTask({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: isoNow(now) }, now);
  if (merged.status === "done" && current.status !== "done") merged.completedAt = isoNow(now);
  if (merged.status !== "done") merged.completedAt = "";
  const titles = new Map((base.tasks || []).map((task) => [task.id, task.title]));
  const entries = buildChangeEntries({
    entityType: "task",
    entityId: id,
    before: current,
    after: merged,
    fields: Object.keys(TASK_FIELD_LABELS),
    labels: TASK_FIELD_LABELS,
    formatters: {
      status: (value) => taskStatusLabel(value),
      priority: (value) => taskPriorityLabel(value),
      stage: (value) => (value ? stageLabel(value) : ""),
      dependsOn: (value) => (Array.isArray(value) ? value.map((item) => titles.get(item) || "").filter(Boolean).join(" · ") : "")
    },
    reason,
    now
  });
  const next = withChanges({ ...base, tasks: base.tasks.map((task) => (task.id === id ? merged : task)) }, entries, now);
  return { work: next, task: merged, error: "" };
}

export function removeTask(work, id, now) {
  const base = work || createEmptyProjectWork();
  const target = (base.tasks || []).find((task) => task.id === id);
  if (!target) return { work: base, removed: null, error: "업무를 찾지 못했습니다." };
  return {
    work: { ...base, tasks: base.tasks.filter((task) => task.id !== id), updatedAt: isoNow(now) },
    removed: target,
    error: ""
  };
}

/* ── 회차 ─────────────────────────────────────────────────── */

export function addSession(work, input = {}, now) {
  const base = work || createEmptyProjectWork();
  if ((base.sessions || []).length >= WORK_LIMITS.sessions) {
    return { work: base, session: null, error: `회차는 사업당 ${WORK_LIMITS.sessions}개까지 만들 수 있습니다.` };
  }
  const nextSequence = (base.sessions || []).reduce((max, session) => Math.max(max, session.sequence), 0) + 1;
  const session = createSession({ ...input, sequence: input.sequence ?? nextSequence, createdAt: isoNow(now), updatedAt: isoNow(now) }, now);
  const next = {
    ...base,
    sessions: [...(base.sessions || []), session].sort((left, right) => left.sequence - right.sequence),
    updatedAt: isoNow(now)
  };
  return { work: next, session, error: "" };
}

export function updateSession(work, id, patch = {}, { now, reason = "" } = {}) {
  const base = work || createEmptyProjectWork();
  const current = (base.sessions || []).find((session) => session.id === id);
  if (!current) return { work: base, session: null, error: "회차를 찾지 못했습니다." };
  const merged = createSession({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: isoNow(now) }, now);
  const entries = buildChangeEntries({
    entityType: "session",
    entityId: id,
    before: current,
    after: merged,
    fields: Object.keys(SESSION_FIELD_LABELS),
    labels: SESSION_FIELD_LABELS,
    formatters: { status: (value) => sessionStatusLabel(value) },
    reason,
    now
  });
  const next = withChanges(
    { ...base, sessions: base.sessions.map((session) => (session.id === id ? merged : session)) },
    entries,
    now
  );
  return { work: next, session: merged, error: "" };
}

/**
 * 회차 취소는 삭제가 아니라 상태 전이다(증빙·실적 이력을 남긴다).
 * 연결된 업무는 기본 보류로 두고, 사용자가 다시 열 수 있다.
 */
export function cancelSession(work, id, { now, holdTasks = true, reason = "" } = {}) {
  const base = work || createEmptyProjectWork();
  const current = (base.sessions || []).find((session) => session.id === id);
  if (!current) return { work: base, session: null, held: 0, error: "회차를 찾지 못했습니다." };
  if (current.status === "cancelled") return { work: base, session: current, held: 0, error: "" };

  const entries = buildChangeEntries({
    entityType: "session",
    entityId: id,
    before: current,
    after: { ...current, status: "cancelled" },
    fields: ["status"],
    labels: SESSION_FIELD_LABELS,
    formatters: { status: (value) => sessionStatusLabel(value) },
    reason: reason || "회차 취소",
    now
  });

  let held = 0;
  const tasks = (base.tasks || []).map((task) => {
    if (task.sessionId !== id) return task;
    if (!holdTasks) return task;
    if (task.status === "done" || task.status === "cancelled" || task.status === "hold") return task;
    held += 1;
    return { ...task, status: "hold", updatedAt: isoNow(now) };
  });

  const sessions = base.sessions.map((session) => (
    session.id === id ? { ...session, status: "cancelled", updatedAt: isoNow(now) } : session
  ));
  const next = withChanges({ ...base, sessions, tasks }, entries, now);
  return { work: next, session: next.sessions.find((session) => session.id === id) || null, held, error: "" };
}

/* ── 일괄 날짜 변경 ───────────────────────────────────────── */

export function bulkDatePreview(work, request = {}) {
  const { scope = "all", taskIds = [], stage = "", sessionId = "", mode = "shift", days = 0, date = "", includeDone = true } = request;
  const tasks = Array.isArray(work?.tasks) ? work.tasks : [];
  let selected = tasks;
  if (Array.isArray(taskIds) && taskIds.length) {
    const set = new Set(taskIds);
    selected = tasks.filter((task) => set.has(task.id));
  } else if (scope === "stage") {
    selected = tasks.filter((task) => task.stage === stage);
  } else if (scope === "session") {
    selected = tasks.filter((task) => task.sessionId === sessionId);
  }
  selected = selected.filter((task) => task.status !== "cancelled" && (includeDone || task.status !== "done"));

  let targetDate = "";
  if (mode === "set") {
    targetDate = normalizeDeadline(date);
    if (!targetDate) return { items: [], count: 0, error: "바꿀 날짜를 YYYY-MM-DD로 골라 주세요.", mode, scope };
  }

  const items = [];
  for (const task of selected) {
    let after = "";
    if (mode === "set") after = targetDate;
    else {
      if (!task.dueDate) continue;
      after = shiftDate(task.dueDate, Number(days) || 0);
      if (!after) continue;
    }
    items.push({ taskId: task.id, title: task.title, before: task.dueDate, after });
  }
  const unchanged = items.filter((item) => item.before === item.after).length;
  return {
    items,
    count: items.length - unchanged,
    unchanged,
    error: "",
    mode,
    scope,
    days: mode === "shift" ? Math.round(Number(days) || 0) : 0,
    date: mode === "set" ? targetDate : ""
  };
}

export function applyBulkDateChanges(work, preview, { now, reason = "일괄 날짜 변경" } = {}) {
  const base = work || createEmptyProjectWork();
  const items = Array.isArray(preview?.items) ? preview.items : [];
  if (!items.length) return { work: base, changed: 0 };
  const byId = new Map(items.map((item) => [item.taskId, item]));
  const entries = [];
  const tasks = (base.tasks || []).map((task) => {
    const item = byId.get(task.id);
    if (!item || item.before === item.after) return task;
    entries.push(
      ...buildChangeEntries({
        entityType: "task",
        entityId: task.id,
        before: task,
        after: { ...task, dueDate: item.after },
        fields: ["dueDate"],
        labels: TASK_FIELD_LABELS,
        reason,
        now
      })
    );
    return { ...task, dueDate: item.after, updatedAt: isoNow(now) };
  });
  const next = withChanges({ ...base, tasks }, entries, now);
  return { work: next, changed: entries.length };
}

/* ── 계획 → 운영 전환 ─────────────────────────────────────── */

function generationBlockReason(status) {
  if (CLOSED_STATUSES.includes(status)) {
    return "완료·보류·취소 상태에서는 업무를 만들 수 없습니다. 상태를 되돌린 뒤 다시 시도해 주세요.";
  }
  return "";
}

/**
 * 확정 전 미리보기. 확정 전에도 무엇이 만들어질지 보여 주되(confirmRequired), 적용은 막는다.
 * 공고문이 없어도 동작한다(공고·계획서 내용은 필요 조건이 아니다).
 */
export function buildGenerationPreview({ meta, plan, work, options = {} } = {}) {
  const base = work || createEmptyProjectWork(meta?.id || "");
  const status = text(meta?.status, 20) || "planning";
  const confirmRequired = CONFIRM_REQUIRED_STATUSES.includes(status);
  const blockedReason = generationBlockReason(status);
  const blocked = Boolean(blockedReason);

  const startDate = normalizeDeadline(meta?.startDate) || normalizeDeadline(plan?.schedule?.projectStart);
  const endDate = normalizeDeadline(meta?.endDate) || normalizeDeadline(plan?.schedule?.projectEnd);

  const requested = Math.round(Number(options.sessionCount) || 0);
  const existingSessions = Array.isArray(base.sessions) ? base.sessions : [];
  const sessionCount = Math.max(
    1,
    Math.min(MAX_SESSION_COUNT, requested || existingSessions.length || 1)
  );
  const newSessions = existingSessions.length ? [] : buildSkeletonSessions(sessionCount);
  const sessionsForDraft = existingSessions.length
    ? existingSessions
    : newSessions.map((session) => ({ sequence: session.sequence, startAt: session.startAt }));

  const drafts = buildTemplateTasks({
    sessionCount,
    sessions: sessionsForDraft,
    skipStages: Array.isArray(options.skipStages) ? options.skipStages : [],
    startDate,
    endDate,
    templateVersion: options.templateVersion || TEMPLATE_VERSION
  });

  const existingBySource = new Map();
  for (const task of base.tasks || []) {
    if (task.sourceKey) existingBySource.set(task.sourceKey, task);
  }

  const tasks = drafts.map((draft) => ({
    ...draft,
    state: blocked ? "blocked" : existingBySource.has(draft.sourceKey) ? "kept" : "new"
  }));

  const warnings = [];
  if (!startDate && !endDate && !sessionsForDraft.some((session) => String(session.startAt || "").length >= 10)) {
    warnings.push("사업 기간과 회차 날짜가 비어 있어 업무 기한은 비워 둡니다. 만든 뒤 일괄 날짜 변경으로 채울 수 있습니다.");
  }
  if (confirmRequired) warnings.push("아직 확정 전입니다. 확정하면 이 초안대로 업무가 만들어집니다. 지금은 미리보기만 됩니다.");

  return {
    templateVersion: options.templateVersion || TEMPLATE_VERSION,
    status,
    blocked,
    blockedReason,
    confirmRequired,
    startDate,
    endDate,
    sessionCount: sessionsForDraft.length,
    newSessions: newSessions.map((session) => ({ sequence: session.sequence, title: session.title, startAt: "" })),
    skippedStages: (Array.isArray(options.skipStages) ? options.skipStages : []).filter((id) => isStageId(id)),
    tasks,
    counts: {
      stages: new Set(tasks.map((task) => task.stage)).size,
      taskTotal: tasks.length,
      newTasks: tasks.filter((task) => task.state === "new").length,
      keptTasks: tasks.filter((task) => task.state === "kept").length,
      newSessions: newSessions.length,
      sessionCount: sessionsForDraft.length
    },
    warnings
  };
}

/**
 * 미리보기 그대로 적용한다. 같은 sourceKey 업무가 이미 있으면 건너뛰어
 * 사용자가 고친 제목·기한·상태를 덮어쓰지 않는다(중복 생성 방지).
 */
export function applyGeneration({ work, preview, now, revision = 0 } = {}) {
  const base = work || createEmptyProjectWork();
  if (!preview) return { work: base, error: "미리보기가 없습니다.", added: 0, skipped: 0, newSessions: 0 };
  if (preview.blocked) return { work: base, error: preview.blockedReason || "지금은 업무를 만들 수 없습니다.", added: 0, skipped: 0, newSessions: 0 };
  if (preview.confirmRequired) {
    return { work: base, error: "계획을 먼저 확정해야 운영 업무를 만들 수 있습니다.", added: 0, skipped: 0, newSessions: 0 };
  }

  const sessions = [...(base.sessions || [])];
  const sessionBySequence = new Map(sessions.map((session) => [session.sequence, session]));
  let newSessions = 0;
  for (const skeleton of preview.newSessions || []) {
    if (sessionBySequence.has(skeleton.sequence)) continue;
    const created = createSession({ ...skeleton, createdAt: isoNow(now), updatedAt: isoNow(now) }, now);
    sessions.push(created);
    sessionBySequence.set(created.sequence, created);
    newSessions += 1;
  }
  sessions.sort((left, right) => left.sequence - right.sequence);

  const existingIdBySource = new Map();
  for (const task of base.tasks || []) {
    if (task.sourceKey) existingIdBySource.set(task.sourceKey, task.id);
  }

  const newIdBySource = new Map();
  const additions = [];
  let skipped = 0;
  for (const draft of preview.tasks || []) {
    if (draft.state === "kept" || existingIdBySource.has(draft.sourceKey)) {
      skipped += 1;
      continue;
    }
    const id = createWorkId("task");
    newIdBySource.set(draft.sourceKey, id);
    const session = draft.sessionSequence ? sessionBySequence.get(draft.sessionSequence) : null;
    additions.push(
      createTask(
        {
          id,
          title: draft.title,
          stage: draft.stage,
          sessionId: session?.id || "",
          owner: "",
          dueDate: draft.dueDate,
          status: "planned",
          priority: draft.priority,
          dependsOn: [],
          completionCriteria: draft.completionCriteria,
          sourceKey: draft.sourceKey,
          createdAt: isoNow(now),
          updatedAt: isoNow(now)
        },
        now
      )
    );
  }

  // 선행 업무는 sourceKey로만 약속되어 있으므로 적용 시점에 실제 id로 바꾼다.
  const resolved = additions.map((task) => {
    const draft = (preview.tasks || []).find((item) => item.sourceKey === task.sourceKey);
    const dependsOn = (draft?.dependsOn || [])
      .map((key) => existingIdBySource.get(key) || newIdBySource.get(key))
      .filter((id) => Boolean(id) && id !== task.id)
      .slice(0, 5);
    return { ...task, dependsOn };
  });

  const tasks = [...(base.tasks || []), ...resolved];
  const generation = {
    id: createWorkId("gen"),
    templateVersion: preview.templateVersion || TEMPLATE_VERSION,
    revision: Math.max(0, Math.round(Number(revision) || 0)),
    appliedAt: isoNow(now),
    added: resolved.length,
    skipped,
    sessionCount: sessions.length
  };
  const next = {
    ...base,
    sessions,
    tasks,
    generations: [generation, ...(base.generations || [])].slice(0, WORK_LIMITS.generations),
    updatedAt: isoNow(now)
  };
  return { work: next, error: "", added: resolved.length, skipped, newSessions, generation };
}

/* ── 계획 리비전 ───────────────────────────────────────────── */

function snapshotText(value, max = 4000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** 확정 시점의 계획을 남긴다. 원안·최신안 비교의 기준이 된다. */
export function createRevision({ work, meta, project, grantPlan, reason = "", now } = {}) {
  const base = work || createEmptyProjectWork(meta?.id || "");
  const revisions = Array.isArray(base.revisions) ? base.revisions : [];
  const nextRevision = revisions.reduce((max, revision) => Math.max(max, revision.revision), 0) + 1;
  const snapshot = {
    meta: {
      name: text(meta?.name, 80),
      type: text(meta?.type, 20),
      status: text(meta?.status, 20),
      year: text(meta?.year, 4),
      ownerName: text(meta?.ownerName, 40),
      startDate: normalizeDeadline(meta?.startDate),
      endDate: normalizeDeadline(meta?.endDate),
      deadline: normalizeDeadline(meta?.deadline),
      goals: (Array.isArray(meta?.goals) ? meta.goals : []).slice(0, 5).map((goal) => text(goal, 80))
    },
    plan: {
      coreIdea: snapshotText(project?.coreIdea),
      activities: snapshotText(project?.activities),
      inputs: snapshotText(project?.inputs),
      outputs: snapshotText(project?.outputs),
      shortOutcomes: snapshotText(project?.shortOutcomes),
      milestones: snapshotText(project?.milestones),
      riskPlan: snapshotText(project?.riskPlan),
      budgetPlan: snapshotText(project?.budgetPlan)
    },
    grant: {
      programName: text(grantPlan?.programName, 120),
      budgetLines: (Array.isArray(grantPlan?.budgetLines) ? grantPlan.budgetLines : []).slice(0, 120).map((line) => ({
        category: text(line?.category, 60),
        item: text(line?.item, 60),
        unitCost: text(line?.unitCost, 20),
        quantity: text(line?.quantity, 20),
        note: text(line?.note, 120)
      })),
      schedule: { ...(grantPlan?.schedule && typeof grantPlan.schedule === "object" ? grantPlan.schedule : {}) }
    }
  };

  const revision = {
    id: createWorkId("rev"),
    revision: nextRevision,
    approvedAt: isoNow(now),
    reason: text(reason, 200) || "계획 확정",
    snapshot
  };
  const nextWork = {
    ...base,
    revisions: [revision, ...revisions].slice(0, WORK_LIMITS.revisions),
    updatedAt: isoNow(now)
  };
  return { revision, work: nextWork };
}

export function latestRevision(work) {
  const revisions = Array.isArray(work?.revisions) ? work.revisions : [];
  if (!revisions.length) return null;
  return revisions.reduce((latest, revision) => (revision.revision > latest.revision ? revision : latest), revisions[0]);
}

/* ── 다음 권장 행동 ───────────────────────────────────────── */

function ddayLabel(dueDate, now) {
  const days = daysUntil(dueDate, now);
  if (days === null) return "";
  if (days === 0) return "오늘 마감";
  if (days > 0) return `${days}일 남음`;
  return `${Math.abs(days)}일 지남`;
}

/**
 * 여러 사업을 한 줄로 보고 '다음에 할 일 하나'를 고른다.
 * entries: [{ projectId, projectName, meta, work, plan }]
 */
export function nextAction(entries, now) {
  const list = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.meta);
  let best = null;

  for (const entry of list) {
    const meta = entry.meta;
    if (CLOSED_STATUSES.includes(meta.status)) continue;
    const buckets = taskBuckets(entry.work, now);
    for (const task of buckets.overdue) {
      const candidate = {
        kind: "overdue",
        priority: 0,
        projectId: meta.id,
        projectName: meta.name,
        taskId: task.id,
        sessionId: task.sessionId,
        section: "projectBoard",
        tab: "tasks",
        label: `${task.title}`,
        detail: `${meta.name} · ${ddayLabel(task.dueDate, now)}`,
        actionLabel: "지연 업무 열기"
      };
      if (!best || candidate.priority < best.priority) best = candidate;
    }
    for (const task of buckets.today) {
      const candidate = {
        kind: "today",
        priority: 1,
        projectId: meta.id,
        projectName: meta.name,
        taskId: task.id,
        sessionId: task.sessionId,
        section: "projectBoard",
        tab: "tasks",
        label: `${task.title}`,
        detail: `${meta.name} · 오늘 마감`,
        actionLabel: "오늘 업무 열기"
      };
      if (!best || candidate.priority < best.priority) best = candidate;
    }
  }
  if (best) return best;

  for (const entry of list) {
    const meta = entry.meta;
    if (CLOSED_STATUSES.includes(meta.status)) continue;
    const sessions = (entry.work?.sessions || []).filter((session) => session.status === "planned" && session.startAt);
    const today = todayText(now);
    const upcoming = sessions
      .map((session) => ({ session, days: daysUntil(session.startAt.slice(0, 10), now) }))
      .filter((item) => item.days !== null && item.days >= 0 && item.days <= 21)
      .sort((left, right) => (left.days ?? 0) - (right.days ?? 0))[0];
    if (upcoming) {
      return {
        kind: "session",
        priority: 2,
        projectId: meta.id,
        projectName: meta.name,
        sessionId: upcoming.session.id,
        section: "projectBoard",
        tab: "sessions",
        label: `${upcoming.session.sequence}회차 준비 · ${upcoming.session.title}`,
        detail: `${meta.name} · ${upcoming.session.startAt.slice(0, 10) === today ? "오늘" : ddayLabel(upcoming.session.startAt.slice(0, 10), now)}${upcoming.session.venue ? ` · ${upcoming.session.venue}` : ""}`,
        actionLabel: "회차 열기"
      };
    }
  }

  for (const entry of list) {
    const meta = entry.meta;
    if (CLOSED_STATUSES.includes(meta.status)) continue;
    if (CONFIRM_REQUIRED_STATUSES.includes(meta.status)) {
      return {
        kind: "confirm",
        priority: 3,
        projectId: meta.id,
        projectName: meta.name,
        section: "projectBoard",
        tab: "overview",
        label: `${meta.name} 계획 확정하기`,
        detail: "확정하면 12단계 운영 업무·일정 초안을 만들 수 있습니다. 공고문이 없어도 됩니다.",
        actionLabel: "확정 화면 열기"
      };
    }
  }

  for (const entry of list) {
    const meta = entry.meta;
    if (CLOSED_STATUSES.includes(meta.status)) continue;
    if (GENERATABLE_STATUSES.includes(meta.status) && !(entry.work?.tasks || []).length) {
      return {
        kind: "generate",
        priority: 4,
        projectId: meta.id,
        projectName: meta.name,
        section: "projectBoard",
        tab: "overview",
        label: `${meta.name} 운영 업무 만들기`,
        detail: "확정된 계획으로 업무·일정 초안을 만듭니다. 미리보기 후 승인합니다.",
        actionLabel: "업무 만들기"
      };
    }
  }

  for (const entry of list) {
    const meta = entry.meta;
    if (CLOSED_STATUSES.includes(meta.status)) continue;
    if (!(entry.plan?.budgetLines || []).length) {
      return {
        kind: "budget",
        priority: 5,
        projectId: meta.id,
        projectName: meta.name,
        section: "grantBudget",
        tab: "budget",
        label: `${meta.name} 예산 편성`,
        detail: "비목·단가를 채우면 계획액과 정산 기준이 한곳에 남습니다.",
        actionLabel: "예산 편성 열기"
      };
    }
  }

  return null;
}

/** 시작 화면용 묶음: 오늘 마감·지연·곧 마감·진행 중 사업·다음 행동 1개. */
export function projectDigest(entries, now) {
  const list = Array.isArray(entries) ? entries.filter((entry) => entry && entry.meta) : [];
  let overdue = 0;
  let dueToday = 0;
  let dueSoon = 0;
  const overdueItems = [];
  for (const entry of list) {
    if (CLOSED_STATUSES.includes(entry.meta.status)) continue;
    const summary = workSummary(entry.work, now);
    overdue += summary.overdue;
    dueToday += summary.dueToday;
    dueSoon += summary.dueSoon;
    const buckets = taskBuckets(entry.work, now);
    for (const task of buckets.overdue) {
      overdueItems.push({ projectId: entry.meta.id, projectName: entry.meta.name, title: task.title, dueDate: task.dueDate });
    }
  }
  overdueItems.sort((left, right) => (left.dueDate < right.dueDate ? -1 : 1));
  return {
    overdue,
    dueToday,
    dueSoon,
    overdueItems: overdueItems.slice(0, 8),
    running: list
      .filter((entry) => ["preparing", "running", "settling"].includes(entry.meta.status))
      .map((entry) => entry.meta),
    next: nextAction(list, now)
  };
}

/** 단계 순서대로 업무를 묶는다(화면 목록용). */
export function groupTasksByStage(tasks) {
  const groups = [];
  const index = new Map();
  for (const task of tasks || []) {
    const key = task.stage || "";
    if (!index.has(key)) {
      index.set(key, { stage: key, label: stageLabel(key), order: stageIndex(key), items: [] });
      groups.push(index.get(key));
    }
    index.get(key).items.push(task);
  }
  return groups.sort((left, right) => left.order - right.order);
}
