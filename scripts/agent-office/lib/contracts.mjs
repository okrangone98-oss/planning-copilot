export const SOURCE_TYPES = Object.freeze(["gmail", "calendar", "drive", "sheets"]);
export const EMAIL_CATEGORIES = Object.freeze([
  "ACTION_REQUIRED", "WAITING", "FINANCE", "APPLICATION", "CANCELLATION",
  "DOCUMENT", "SCHEDULE", "REFERENCE", "IGNORE"
]);
export const PROJECT_STATUSES = Object.freeze(["NORMAL", "WARNING", "RISK"]);

export function sourceRef(sourceType, sourceId, sourceUrl, detectedAt, projectId) {
  return { sourceType, sourceId, sourceUrl, ...(projectId ? { projectId } : {}), detectedAt };
}
