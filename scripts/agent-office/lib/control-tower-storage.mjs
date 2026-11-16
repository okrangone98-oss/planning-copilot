import { validateControlTowerSnapshot } from "./control-tower-snapshot.mjs";

const STORAGE_KEY = "planningCopilotControlTower";
const EMPTY_STATE = { snapshot: null, approvals: {} };

export function loadControlTowerState(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}");
    const checked = validateControlTowerSnapshot(parsed.snapshot);
    if (!checked.ok) return { ...EMPTY_STATE, approvals: {} };
    const approvals = {};
    if (parsed.approvals && typeof parsed.approvals === "object" && !Array.isArray(parsed.approvals)) {
      for (const [key, status] of Object.entries(parsed.approvals)) {
        if (key.startsWith(checked.value.run.id + ":") && (status === "approved" || status === "blocked")) {
          approvals[key] = status;
        }
      }
    }
    return { snapshot: checked.value, approvals };
  } catch {
    return { snapshot: null, approvals: {} };
  }
}

export function saveControlTowerSnapshot(snapshot, storage = defaultStorage()) {
  const checked = validateControlTowerSnapshot(snapshot);
  if (!checked.ok) throw new Error(checked.error);
  const previous = loadControlTowerState(storage);
  const prefix = checked.value.run.id + ":";
  const approvals = Object.fromEntries(Object.entries(previous.approvals).filter(([key]) => key.startsWith(prefix)));
  const next = { snapshot: checked.value, approvals };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function saveControlTowerApproval(runId, approvalId, status, storage = defaultStorage()) {
  if (status !== "approved" && status !== "blocked") throw new Error("승인 상태가 올바르지 않습니다.");
  const current = loadControlTowerState(storage);
  if (!current.snapshot || current.snapshot.run.id !== runId ||
      !current.snapshot.approvals.some((item) => item.id === approvalId)) {
    throw new Error("현재 snapshot의 승인 항목을 찾을 수 없습니다.");
  }
  const key = runId + ":" + approvalId;
  const next = { ...current, approvals: { ...current.approvals, [key]: status } };
  storage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearControlTowerState(storage = defaultStorage()) {
  storage.removeItem(STORAGE_KEY);
}

function defaultStorage() {
  if (typeof window === "undefined") throw new Error("브라우저 저장소를 사용할 수 없습니다.");
  return window.localStorage;
}
