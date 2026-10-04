export const MAX_RETRIES = 2;
export const HARNESS_STATUSES = Object.freeze([
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "SUCCEEDED",
  "NEEDS_ATTENTION",
  "FAILED",
  "CANCELLED"
]);

const ALLOWED_TRANSITIONS = {
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["WAITING_APPROVAL", "SUCCEEDED", "NEEDS_ATTENTION", "FAILED", "CANCELLED"],
  WAITING_APPROVAL: ["SUCCEEDED", "NEEDS_ATTENTION", "CANCELLED"],
  SUCCEEDED: [],
  NEEDS_ATTENTION: [],
  FAILED: [],
  CANCELLED: []
};

export function transitionStatus(current, next) {
  if (!HARNESS_STATUSES.includes(current) || !ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new Error("허용되지 않는 상태 전이: " + current + " → " + next);
  }
  return next;
}

export class RetryableStepError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryableStepError";
  }
}

export function isRetryableStepError(error) {
  return error instanceof RetryableStepError;
}
