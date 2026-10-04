import { createHash, randomUUID } from "node:crypto";
import { createRunStore } from "./harness-store.mjs";
import { buildControlTowerSnapshot } from "./control-tower-snapshot.mjs";
import { HARNESS_STATUSES, isRetryableStepError, MAX_RETRIES, transitionStatus } from "./harness-contracts.mjs";

const JOB_TYPES = new Set(["daily-briefing", "agent-office-command"]);

export async function runHarness({
  jobType,
  command = "",
  mode = "oauth",
  outputRoot = "reports/private",
  now = new Date(),
  adapters = {}
} = {}) {
  if (!JOB_TYPES.has(jobType)) throw new Error("지원하지 않는 작업입니다: " + String(jobType));
  if (jobType === "agent-office-command" && !command.trim()) throw new Error("AI 사무국 작업에는 --command가 필요합니다.");

  const runId = createRunId(now);
  const store = await createRunStore({ outputRoot, runId });
  const startedAt = now.toISOString();
  let status = "QUEUED";
  let finishedAt = "";
  const commandFingerprint = command ? createHash("sha256").update(command).digest("hex") : "";
  const manifest = { id: runId, jobType, status, mode, startedAt, commandFingerprint };

  await store.writeManifest(manifest);
  await store.appendEvent({ type: "RUN_QUEUED", runId, jobType, at: startedAt });
  status = transitionStatus(status, "RUNNING");
  manifest.status = status;
  await store.writeManifest(manifest);
  await store.appendEvent({ type: "RUN_STARTED", runId, jobType, at: startedAt });

  const step = { id: jobType, label: jobType === "daily-briefing" ? "아침 업무 브리핑" : "AI 사무국 명령", status: "RUNNING" };
  await store.appendEvent({ type: "STEP_STARTED", runId, stepId: step.id, at: startedAt });

  let output;
  let failure;
  try {
    const job = adapters[jobType] || await loadJob(jobType);
    if (!job || typeof job.run !== "function") throw new Error("작업 실행기를 찾을 수 없습니다.");
    for (let retry = 0; ; retry += 1) {
      try {
        output = await job.run({ command, mode, now, runId, runDir: store.runDir });
        break;
      } catch (error) {
        const retryable = isRetryableStepError(error);
        if (!retryable || retry >= MAX_RETRIES) throw error;
        await store.appendEvent({ type: "STEP_RETRY", runId, stepId: step.id, attempt: retry + 1, at: new Date().toISOString() });
        await (adapters.sleep || delay)(250 * (2 ** retry));
      }
    }
    validateJobOutput(output);
    const artifactId = "artifact-" + runId;
    const artifactPath = await store.writeArtifact(output.artifactName, output.artifactContent);
    step.status = "SUCCEEDED";
    step.message = "산출물을 만들었습니다.";
    await store.appendEvent({ type: "STEP_SUCCEEDED", runId, stepId: step.id, at: new Date().toISOString() });
    status = transitionStatus(status, "WAITING_APPROVAL");
    finishedAt = new Date().toISOString();
    manifest.status = status;
    manifest.finishedAt = finishedAt;
    await store.writeManifest(manifest);
    await store.appendEvent({ type: "RUN_WAITING_APPROVAL", runId, at: finishedAt });
    const snapshot = buildControlTowerSnapshot({
      generatedAt: finishedAt,
      run: { id: runId, jobType, status, startedAt, finishedAt, summary: output.summary },
      steps: [step],
      alerts: [],
      approvals: [{ id: "approval-" + runId, title: output.approval.title, summary: output.approval.summary, status: "pending", artifactId }],
      artifacts: [{ id: artifactId, name: output.artifactName, mediaType: "text/markdown", path: artifactPath }],
      sources: output.sources || []
    });
    await store.writeSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    failure = error;
    const retryableExhausted = isRetryableStepError(failure);
    status = retryableExhausted ? "FAILED" : "NEEDS_ATTENTION";
    step.status = status;
    step.message = retryableExhausted ? "재시도 한도를 초과했습니다." : "인증 또는 설정을 확인해 주세요.";
    finishedAt = new Date().toISOString();
    manifest.status = status;
    manifest.finishedAt = finishedAt;
    await store.writeManifest(manifest);
    await store.appendEvent({
      type: retryableExhausted ? "RUN_FAILED" : "RUN_NEEDS_ATTENTION",
      runId,
      stepId: step.id,
      errorKind: failure instanceof Error ? failure.name : "UnknownError",
      at: finishedAt
    });
    const snapshot = buildControlTowerSnapshot({
      generatedAt: finishedAt,
      run: {
        id: runId,
        jobType,
        status,
        startedAt,
        finishedAt,
        summary: retryableExhausted ? "일시 오류가 반복되어 실행을 마쳤습니다." : "인증 또는 실행 설정을 확인해야 합니다."
      },
      steps: [step],
      alerts: [{
        id: "alert-" + runId,
        severity: retryableExhausted ? "error" : "warning",
        message: retryableExhausted ? "일시적인 오류가 반복됐습니다. 잠시 후 다시 실행해 주세요." : "인증 또는 설정을 확인한 뒤 다시 실행해 주세요."
      }],
      approvals: [],
      artifacts: [],
      sources: []
    });
    await store.writeSnapshot(snapshot);
    return snapshot;
  }
}

function validateJobOutput(output) {
  if (!output || typeof output !== "object" || typeof output.summary !== "string" ||
      typeof output.artifactName !== "string" || typeof output.artifactContent !== "string" ||
      !output.approval || typeof output.approval.title !== "string" || typeof output.approval.summary !== "string") {
    throw new Error("작업 결과 형식이 올바르지 않습니다.");
  }
}

async function loadJob(jobType) {
  if (jobType === "daily-briefing") return (await import("../jobs/daily-briefing.mjs")).dailyBriefingJob;
  return (await import("../jobs/agent-office-command.mjs")).agentOfficeCommandJob;
}

function createRunId(now) {
  const timestamp = now.toISOString().replace(/[-:.]/g, "").replace(/\.\d{3}/, "");
  return "run-" + timestamp + "-" + randomUUID().slice(0, 8);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
