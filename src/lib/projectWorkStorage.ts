// 사업별 운영 데이터(업무·일정·회차·리비전·변경 이력) 저장 계층.
// 저장 키는 사업 id 하나에 묶고, 읽을 때는 반드시 sanitizeProjectWork를 거친다.
// 금액은 여기에 두지 않는다 — 예산의 유일한 원천은 grantPlan.budgetLines다.

import { createEmptyProjectWork, isProjectWorkEmpty, sanitizeProjectWork, type ProjectWork } from "./projectOperations.mjs";
import { projectWorkStorageKey } from "./projectWorkspace.mjs";

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // 저장 공간이 부족해도 화면 작업은 계속한다. 화면 상태는 메모리에 남아 있다.
    return false;
  }
}

export function loadProjectWork(id: string): ProjectWork {
  const stored = readJson<unknown>(projectWorkStorageKey(id));
  return sanitizeProjectWork(stored, { projectId: id });
}

export function saveProjectWork(id: string, work: ProjectWork) {
  if (!id) return;
  if (isProjectWorkEmpty(work)) {
    // 비어 있는 사업의 키를 만들지 않는다. 이미 있던 빈 키만 정리한다.
    try {
      localStorage.removeItem(projectWorkStorageKey(id));
    } catch {
      /* 지울 수 없으면 그대로 둔다. */
    }
    return;
  }
  writeJson(projectWorkStorageKey(id), sanitizeProjectWork(work, { projectId: id }));
}

/**
 * 사업 복제: 업무·회차는 새 id로 한 벌 더 만들고, 멱등 키(sourceKey)는 그대로 둔다.
 * 변경 이력은 원본에 남은 기록이라 복사하지 않는다(가리키는 업무 id가 이미 바뀌었다).
 */
export function copyProjectWork(fromId: string, toId: string) {
  const source = readJson<unknown>(projectWorkStorageKey(fromId));
  if (!source) return;
  const work = sanitizeProjectWork(source, { projectId: toId });

  const sessionIds = new Map<string, string>();
  const sessions = work.sessions.map((session) => {
    const id = `ses_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    sessionIds.set(session.id, id);
    return { ...session, id };
  });
  const taskIds = new Map<string, string>();
  const tasks = work.tasks.map((task) => {
    const id = `task_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
    taskIds.set(task.id, id);
    return { ...task, id, sessionId: task.sessionId ? sessionIds.get(task.sessionId) || "" : "" };
  });
  const withDeps = tasks.map((task) => ({
    ...task,
    dependsOn: task.dependsOn.map((id) => taskIds.get(id)).filter((id): id is string => Boolean(id))
  }));

  // 지출도 새 id를 받고, 회차를 가리키던 참조는 복제된 회차 id로 바꾼다.
  // 비목 id는 예산도 함께 복제되므로 그대로 둔다(같은 계획 행을 가리킨다).
  const expenses = work.expenses.map((expense) => ({
    ...expense,
    id: `exp_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    sessionId: expense.sessionId ? sessionIds.get(expense.sessionId) || "" : ""
  }));

  const next = sanitizeProjectWork(
    {
      ...work,
      projectId: toId,
      sessions,
      tasks: withDeps,
      expenses,
      changes: [],
      revisions: work.revisions,
      generations: work.generations
    },
    { projectId: toId }
  );
  writeJson(projectWorkStorageKey(toId), next);
}

export function removeProjectWork(id: string) {
  try {
    localStorage.removeItem(projectWorkStorageKey(id));
  } catch {
    // 이미 지워졌으면 그대로 둔다.
  }
}

/** 시작 화면에서 모든 사업의 오늘 마감·지연을 세기 위해 한 번에 읽는다. */
export function loadAllProjectWorks(projects: Array<{ id: string }>): Record<string, ProjectWork> {
  const map: Record<string, ProjectWork> = {};
  for (const project of projects) {
    map[project.id] = loadProjectWork(project.id);
  }
  return map;
}

export function emptyProjectWork(projectId: string): ProjectWork {
  return createEmptyProjectWork(projectId);
}
