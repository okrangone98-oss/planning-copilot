import { HARNESS_STATUSES } from "./harness-contracts.mjs";

const JOB_TYPES = new Set(["daily-briefing", "agent-office-command"]);
const APPROVAL_STATUSES = new Set(["pending", "approved", "blocked"]);
const SEVERITIES = new Set(["info", "warning", "error"]);
const SOURCE_TYPES = new Set(["gmail", "calendar", "drive", "sheets", "agent-office", "local"]);

export function buildControlTowerSnapshot(input) {
  return normalizeSnapshot({
    schemaVersion: "1.0",
    generatedAt: input.generatedAt,
    run: input.run,
    steps: input.steps || [],
    alerts: input.alerts || [],
    approvals: input.approvals || [],
    artifacts: input.artifacts || [],
    sources: input.sources || []
  });
}

export function validateControlTowerSnapshot(value) {
  try {
    if (!isObject(value) || value.schemaVersion !== "1.0") {
      throw new Error("지원하지 않는 snapshot 형식입니다.");
    }
    return { ok: true, value: normalizeSnapshot(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "snapshot을 읽지 못했습니다." };
  }
}

function normalizeSnapshot(value) {
  if (!isObject(value) || typeof value.generatedAt !== "string" || !isObject(value.run)) {
    throw new Error("snapshot의 필수 정보가 없습니다.");
  }
  const run = value.run;
  if (!text(run.id) || !JOB_TYPES.has(run.jobType) || !HARNESS_STATUSES.includes(run.status) || !text(run.startedAt) || !text(run.summary)) {
    throw new Error("실행 정보 형식이 올바르지 않습니다.");
  }

  const steps = list(value.steps, "단계").map((step) => {
    if (!isObject(step) || !text(step.id) || !text(step.label) || !HARNESS_STATUSES.includes(step.status)) {
      throw new Error("단계 정보 형식이 올바르지 않습니다.");
    }
    return {
      id: clean(step.id, 100),
      label: clean(step.label, 120),
      status: step.status,
      ...(text(step.message) ? { message: clean(step.message, 500) } : "")
    };
  });

  const alerts = list(value.alerts, "알림").map((alert) => {
    if (!isObject(alert) || !text(alert.id) || !text(alert.message) || !SEVERITIES.has(alert.severity)) {
      throw new Error("알림 정보 형식이 올바르지 않습니다.");
    }
    return { id: clean(alert.id, 100), severity: alert.severity, message: clean(alert.message, 500) };
  });

  const approvals = list(value.approvals, "승인").map((approval) => {
    if (!isObject(approval) || !text(approval.id) || !text(approval.title) || !APPROVAL_STATUSES.has(approval.status)) {
      throw new Error("승인 정보 형식이 올바르지 않습니다.");
    }
    return {
      id: clean(approval.id, 100),
      title: clean(approval.title, 180),
      summary: clean(approval.summary || "", 500),
      status: approval.status,
      ...(text(approval.artifactId) ? { artifactId: clean(approval.artifactId, 100) } : "")
    };
  });

  const artifacts = list(value.artifacts, "산출물").map((artifact) => {
    if (!isObject(artifact) || !text(artifact.id) || !text(artifact.name) || !safeRelativePath(artifact.path)) {
      throw new Error("산출물 경로 또는 정보가 올바르지 않습니다.");
    }
    return {
      id: clean(artifact.id, 100),
      name: clean(artifact.name, 180),
      mediaType: clean(artifact.mediaType || "text/markdown", 80),
      path: artifact.path
    };
  });

  const sources = list(value.sources, "출처").map((source) => {
    if (!isObject(source) || !SOURCE_TYPES.has(source.sourceType) || !text(source.sourceUrl)) {
      throw new Error("출처 정보 형식이 올바르지 않습니다.");
    }
    const sourceUrl = safeUrl(source.sourceUrl);
    if (!sourceUrl) throw new Error("출처 주소는 HTTPS URL이어야 합니다.");
    return {
      sourceType: source.sourceType,
      sourceUrl,
      ...(text(source.projectId) ? { projectId: clean(source.projectId, 100) } : ""),
      ...(text(source.detectedAt) ? { detectedAt: clean(source.detectedAt, 50) } : "")
    };
  });

  return {
    schemaVersion: "1.0",
    generatedAt: clean(value.generatedAt, 50),
    run: {
      id: clean(run.id, 100),
      jobType: run.jobType,
      status: run.status,
      startedAt: clean(run.startedAt, 50),
      ...(text(run.finishedAt) ? { finishedAt: clean(run.finishedAt, 50) } : ""),
      summary: clean(run.summary, 500)
    },
    steps,
    alerts,
    approvals,
    artifacts,
    sources
  };
}

function list(value, label) {
  if (!Array.isArray(value)) throw new Error(label + " 목록 형식이 올바르지 않습니다.");
  return value.slice(0, 100);
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length <= 240 && !value.startsWith("/") &&
    !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|key|auth/i.test(key)) url.searchParams.delete(key);
    }
    return clean(url.toString(), 1000);
  } catch {
    return "";
  }
}

function clean(value, maxLength) {
  return String(value).slice(0, maxLength)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[이메일]")
    .replace(/\b\d{6}[- ]?[1-4]\d{6}\b/g, "[주민번호]")
    .replace(/\b0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}\b/g, "[전화번호]")
    .replace(/\s+/g, " ").trim();
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseControlTowerSnapshot(text) {
  try {
    return validateControlTowerSnapshot(JSON.parse(text));
  } catch {
    return { ok: false, error: "JSON 파일을 읽을 수 없습니다." };
  }
}
