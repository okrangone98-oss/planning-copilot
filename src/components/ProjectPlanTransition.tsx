import { useMemo, useState } from "react";
import type { GrantPlan } from "../types";
import { budgetSummary, formatWon } from "../lib/grantWorkflow.mjs";
import type { ProjectMeta } from "../lib/projectWorkspace.mjs";
import { STAGES, listStages } from "../lib/stageTemplate.mjs";
import {
  buildGenerationPreview,
  taskPriorityLabel,
  type ProjectWork
} from "../lib/projectOperations.mjs";

export type ConfirmPlanRequest = { sessionCount: number; skipStages: string[]; reason: string };
export type ConfirmPlanResult = {
  ok: boolean;
  message: string;
  added?: number;
  skipped?: number;
  revision?: number;
};

function formatDueDate(value: string) {
  if (!value) return "기한 없음";
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/**
 * 계획 → 운영 전환 패널.
 * 확정 전에는 무엇이 만들어질지 미리 보여 주고(적용 불가), 확정 뒤 승인하면 업무를 만든다.
 * 공고문이 없어도 확정할 수 있다 — 경고만 남긴다.
 */
export function ProjectPlanTransition({
  meta,
  plan,
  work,
  onConfirm,
  notify
}: {
  meta: ProjectMeta;
  plan: GrantPlan;
  work: ProjectWork;
  onConfirm: (request: ConfirmPlanRequest) => ConfirmPlanResult;
  notify: (message: string) => void;
}) {
  const existingSessions = work.sessions.length;
  const [sessionCount, setSessionCount] = useState(() => (existingSessions > 0 ? existingSessions : 1));
  const [skipStages, setSkipStages] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [result, setResult] = useState<ConfirmPlanResult | null>(null);

  const preview = useMemo(
    () =>
      buildGenerationPreview({
        meta,
        plan,
        work,
        options: { sessionCount, skipStages }
      }),
    [meta, plan, work, sessionCount, skipStages]
  );

  const budget = budgetSummary(plan);
  const checks = [
    { label: "사업 기간", ok: Boolean(meta.startDate || meta.endDate), detail: meta.startDate || meta.endDate ? `${meta.startDate || "미정"} ~ ${meta.endDate || "미정"}` : "기간을 넣으면 업무 기한이 자동으로 채워집니다." },
    { label: "목표", ok: meta.goals.length > 0, detail: meta.goals.length ? `${meta.goals.length}개` : "개요 탭에서 목표를 한 줄이라도 적어 두세요." },
    { label: "예산", ok: budget.lineCount > 0, detail: budget.lineCount ? `${budget.lineCount}개 비목 · ${formatWon(budget.total)}` : "예산이 비어 있어도 확정할 수 있지만, 계획액은 예산 편성에서 채웁니다." },
    { label: "회차", ok: preview.sessionCount > 0, detail: existingSessions ? `이미 등록된 ${existingSessions}회차 기준` : `${preview.sessionCount}회차를 새로 만듭니다.` }
  ];

  const confirmLabel = preview.confirmRequired
    ? `계획 확정 · 업무 ${preview.counts.newTasks}개 만들기`
    : preview.counts.newTasks > 0
      ? `업무 ${preview.counts.newTasks}개 더 만들기`
      : "확정 스냅샷만 저장";

  const submit = () => {
    const response = onConfirm({ sessionCount: preview.sessionCount, skipStages, reason: reason.trim() });
    setResult(response);
    if (response.ok) {
      setReason("");
      notify(response.message);
    } else {
      notify(response.message);
    }
  };

  const toggleStage = (id: string) => {
    setSkipStages((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const shownTasks = showAll ? preview.tasks : preview.tasks.slice(0, 30);

  return (
    <section className="pc-transition" aria-label="계획 확정과 운영 업무 만들기">
      <div className="block-head">
        <h3>{preview.confirmRequired ? "계획 확정" : "운영 업무 다시 만들기"}</h3>
        <span className="block-count">
          {preview.confirmRequired ? "확정 전 미리보기" : `확정 ${preview.counts.stages}단계`}
        </span>
      </div>
      <p className="block-note">
        {preview.confirmRequired
          ? "확정하면 지금 계획을 스냅샷으로 남기고 12단계 운영 업무·일정 초안을 만듭니다. 공고문이 없어도 됩니다. 미리보기는 지금도 볼 수 있습니다."
          : "이미 확정된 사업입니다. 다시 실행해도 같은 업무는 만들지 않고, 고친 제목·기한·상태는 그대로 둡니다."}
      </p>

      {preview.blocked && (
        <p className="pc-notice is-danger" role="status">{preview.blockedReason}</p>
      )}

      <div className="pc-check-list" aria-label="확정 전 확인">
        {checks.map((check) => (
          <div className={`pc-check ${check.ok ? "is-ok" : "is-missing"}`} key={check.label}>
            <strong>{check.ok ? "✓" : "!"} {check.label}</strong>
            <span>{check.detail}</span>
          </div>
        ))}
      </div>

      {existingSessions === 0 && (
        <label className="field pc-session-count">
          <span>만들 회차 수</span>
          <input
            type="number"
            min={1}
            max={60}
            value={sessionCount}
            onChange={(event) => setSessionCount(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
          />
          <small>10회차 사업이면 10을 넣으세요. 회차 날짜는 회차 탭에서 채웁니다.</small>
        </label>
      )}

      <div className="pc-stage-toggle" aria-label="만들지 않을 단계">
        <p className="pc-stage-toggle-label">빼고 싶은 단계는 눌러서 끕니다(템플릿은 필수가 아닙니다).</p>
        <div className="pc-stage-chips">
          {listStages().map((stage) => {
            const skipped = skipStages.includes(stage.id);
            return (
              <button
                key={stage.id}
                className={`pc-stage-chip ${skipped ? "is-off" : "is-on"}`}
                type="button"
                aria-pressed={!skipped}
                onClick={() => toggleStage(stage.id)}
                title={stage.skipHint || stage.purpose}
              >
                <span>{stage.label}</span>
                <small>{stage.sessionScoped ? "회차별" : `${stage.taskCount}개`}</small>
              </button>
            );
          })}
        </div>
      </div>

      <label className="field width-full">
        <span>확정 사유 (선택)</span>
        <input
          value={reason}
          placeholder="예: 내부 검토 완료, 2027년 본예산 반영"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      <div className="pc-transition-summary">
        <strong>
          업무 {preview.counts.taskTotal}개 중 새로 만들 {preview.counts.newTasks}개 · 이미 있어 건너뜀 {preview.counts.keptTasks}개
        </strong>
        <span>
          회차 {preview.counts.sessionCount}개
          {preview.counts.newSessions ? ` (새로 ${preview.counts.newSessions}개)` : " (등록된 회차 기준)"}
          {preview.startDate || preview.endDate ? ` · ${preview.startDate || "미정"} ~ ${preview.endDate || "미정"}` : ""}
        </span>
      </div>

      {preview.warnings.map((warning) => (
        <p className="pc-notice" role="status" key={warning}>{warning}</p>
      ))}

      <div className="table-wrap">
        <table className="stacked-table pc-preview-table">
          <thead>
            <tr>
              <th>단계</th>
              <th>업무</th>
              <th>회차</th>
              <th>기한</th>
              <th>우선순위</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {shownTasks.map((task) => (
              <tr key={task.sourceKey}>
                <td data-label="단계">{task.stageLabel}</td>
                <td data-label="업무">{task.title}</td>
                <td data-label="회차">{task.sessionSequence ? `${task.sessionSequence}회차` : "공통"}</td>
                <td data-label="기한">{formatDueDate(task.dueDate)}</td>
                <td data-label="우선순위">{taskPriorityLabel(task.priority)}</td>
                <td data-label="상태">
                  <span className={`pc-state-chip is-${task.state}`}>
                    {task.state === "new" ? "신규" : task.state === "kept" ? "유지" : "확정 필요"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.tasks.length > shownTasks.length && (
        <button className="ghost-light-button" type="button" onClick={() => setShowAll(true)}>
          나머지 {preview.tasks.length - shownTasks.length}개 보기
        </button>
      )}

      <div className="draft-actions">
        <button className="primary-button" type="button" onClick={submit} disabled={preview.blocked}>
          {confirmLabel}
        </button>
        <span className="pc-transition-hint">
          {preview.blocked ? "상태를 되돌리면 다시 만들 수 있습니다." : `템플릿 ${preview.templateVersion}`}
        </span>
      </div>

      {result && (
        <p className={`pc-notice ${result.ok ? "is-success" : "is-danger"}`} role="status">
          {result.message}
          {result.ok && typeof result.revision === "number" ? ` (계획 리비전 ${result.revision})` : ""}
        </p>
      )}

      <p className="block-note">
        단계 정의: {STAGES.map((stage) => stage.label).join(" · ")}
      </p>
    </section>
  );
}
