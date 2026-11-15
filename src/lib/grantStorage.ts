import type { GrantPlan } from "../types";
import { createEmptyGrantPlan, sanitizeGrantPlan } from "./grantWorkflow.mjs";

const GRANT_PLAN_KEY = "planningCopilotGrantPlan";

export function loadGrantPlan(): GrantPlan {
  try {
    return sanitizeGrantPlan(JSON.parse(localStorage.getItem(GRANT_PLAN_KEY) || "{}"));
  } catch {
    return createEmptyGrantPlan();
  }
}

export function saveGrantPlan(plan: GrantPlan) {
  // 예산·정산 화면에는 민감자료 메모가 들어올 수 있다. 저장은 허용 목록으로만 한다.
  localStorage.setItem(GRANT_PLAN_KEY, JSON.stringify(sanitizeGrantPlan(plan)));
}

export function clearGrantPlan() {
  localStorage.removeItem(GRANT_PLAN_KEY);
}
