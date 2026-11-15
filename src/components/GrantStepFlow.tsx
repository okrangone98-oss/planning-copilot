import type { GrantPlan, SectionId } from "../types";
import { grantProgress } from "../lib/grantWorkflow.mjs";

/**
 * 예산 편성 → 정산 증빙 → 결과보고 → 워크브레인 내보내기 하단 이동 바.
 * 네 화면이 같은 진행률과 같은 순서를 쓰므로, 어느 화면에서 멈춰도 다음 단계가 보인다.
 */
export function GrantStepFlow({
  current,
  plan,
  onNavigate
}: {
  current: Exclude<SectionId, "home">;
  plan: GrantPlan;
  onNavigate: (section: SectionId) => void;
}) {
  const progress = grantProgress(plan);
  const index = Math.max(0, progress.steps.findIndex((step) => step.section === current));
  const currentStep = progress.steps[index];
  const previousStep = index > 0 ? progress.steps[index - 1] : null;
  const nextStep = index < progress.steps.length - 1 ? progress.steps[index + 1] : null;

  return (
    <section className="step-flow" aria-label="사업 흐름 단계 이동">
      <div className="step-flow-head">
        <div>
          <strong>
            사업 흐름 {index + 1}/{progress.steps.length} · {currentStep.label}
          </strong>
          <span>
            전체 진행률 {progress.overall}% · {currentStep.detail}
          </span>
        </div>
        <div className="step-flow-percent" aria-hidden="true">{progress.overall}%</div>
      </div>

      <div
        className="step-flow-progress"
        role="progressbar"
        aria-valuenow={progress.overall}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="사업 흐름 전체 진행률"
      >
        <i style={{ width: `${progress.overall}%` }} />
      </div>

      <ol className="step-flow-list">
        {progress.steps.map((step, stepIndex) => (
          <li key={step.id}>
            <button
              className={`step-flow-chip ${step.section === current ? "is-current" : ""} ${stepIndex < index ? "is-done" : ""}`}
              type="button"
              aria-current={step.section === current ? "step" : undefined}
              onClick={() => onNavigate(step.section as SectionId)}
            >
              <span className="step-flow-number" aria-hidden="true">{stepIndex + 1}</span>
              <span className="step-flow-label">
                {step.label}
                <small>{step.percent}%</small>
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="step-flow-actions">
        {previousStep ? (
          <button className="secondary-button" type="button" onClick={() => onNavigate(previousStep.section as SectionId)}>
            ← 이전 단계 · {previousStep.label}
          </button>
        ) : (
          <button className="secondary-button" type="button" onClick={() => onNavigate("home")}>
            ← 업무 홈
          </button>
        )}
        {nextStep ? (
          <button className="primary-button step-flow-next" type="button" onClick={() => onNavigate(nextStep.section as SectionId)}>
            다음 단계로 이동 · {nextStep.label} →
          </button>
        ) : (
          <button className="primary-button step-flow-next" type="button" onClick={() => onNavigate("home")}>
            내보내기를 마치고 업무 홈으로 →
          </button>
        )}
      </div>
    </section>
  );
}
