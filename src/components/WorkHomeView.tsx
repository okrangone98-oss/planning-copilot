import { useRef } from "react";
import type { GrantPlan, SectionId } from "../types";
import { budgetSummary, formatWon, grantProgress } from "../lib/grantWorkflow.mjs";

const START_CARDS: Array<{
  id: string;
  step: string;
  title: string;
  description: string;
  path: string;
  section?: SectionId;
  file?: boolean;
}> = [
  {
    id: "plan",
    step: "1",
    title: "새 사업계획서 쓰기",
    description: "공고문을 붙여넣으면 평가 포인트와 다음 질문을 먼저 정리합니다. 그대로 초안까지 이어집니다.",
    path: "공고문 분석 → 문제정의 → 초안 조립",
    section: "notice"
  },
  {
    id: "budget",
    step: "2",
    title: "예산·정산 관리하기",
    description: "비목별 예산표를 만들고, 증빙 체크와 결과보고를 한 흐름으로 관리합니다.",
    path: "예산 편성 → 정산 증빙 → 결과보고",
    section: "grantBudget"
  },
  {
    id: "import",
    step: "3",
    title: "기존 문서 불러오기",
    description: "이미 쓰던 공고문·사업계획서 파일을 열어 내용을 채운 뒤 바로 다듬습니다.",
    path: "PDF · DOCX · HWPX · TXT",
    file: true
  }
];

/** 받침에 따라 '으로/로'를 고른다. '정산 증빙로' 같은 표기를 막는다. */
function withDirectionParticle(label: string) {
  const last = label.trim().slice(-1);
  const code = last.charCodeAt(0);
  const hasFinalConsonant = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${label}${hasFinalConsonant ? "으로" : "로"}`;
}

const QUICK_LINKS: Array<{ label: string; section: SectionId }> = [
  { label: "AI 사무국", section: "agentOffice" },
  { label: "업무 관제탑", section: "controlTower" },
  { label: "질문 받기", section: "cowork" },
  { label: "프로젝트 기억", section: "projectMemory" },
  { label: "백업", section: "driveBackup" },
  { label: "모델 설정", section: "modelSettings" }
];

export function WorkHomeView({
  projectName,
  plan,
  started,
  onNavigate,
  onImportFile,
  onLoadExample
}: {
  projectName: string;
  plan: GrantPlan;
  started: boolean;
  onNavigate: (section: SectionId) => void;
  onImportFile: (file: File) => void;
  onLoadExample: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const progress = grantProgress(plan);
  const summary = budgetSummary(plan);
  const nextStep = progress.steps.find((step) => step.percent < 100) || progress.steps[progress.steps.length - 1];

  return (
    <div className="home-view">
      <section className="home-hero">
        <h3>무엇부터 시작할까요?</h3>
        <p>
          메뉴가 많아도 다 알 필요는 없습니다. 지금 하려는 일 하나를 고르면 필요한 화면만 순서대로 이어집니다.
          나머지 메뉴는 왼쪽에서 그룹을 펼치면 그대로 있습니다.
        </p>
      </section>

      <div className="home-start-grid" aria-label="목적별 시작">
        {START_CARDS.map((card) => (
          <button
            className={`home-start-card is-${card.id}`}
            key={card.id}
            type="button"
            onClick={() => {
              if (card.file) fileRef.current?.click();
              else if (card.section) onNavigate(card.section);
            }}
          >
            <span className="home-start-step" aria-hidden="true">{card.step}</span>
            <strong>{card.title}</strong>
            <span className="home-start-desc">{card.description}</span>
            <span className="home-start-path">{card.path} →</span>
          </button>
        ))}
      </div>
      <input
        ref={fileRef}
        className="home-file-input"
        type="file"
        accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.html,.htm,.json,.xml"
        aria-label="기존 문서 파일 불러오기"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImportFile(file);
          event.target.value = "";
        }}
      />

      <section className="home-resume" aria-label="이어서 하기">
        <div className="home-resume-head">
          <div>
            <strong>{started ? "이어서 하기" : "아직 저장된 작업이 없습니다"}</strong>
            <span>
              {started
                ? `${projectName.trim() || "이름 없는 프로젝트"} · 예산 ${summary.lineCount}개 비목 ${formatWon(summary.total)}`
                : "위 카드에서 시작하거나 예시로 화면을 먼저 둘러보세요."}
            </span>
          </div>
          {started ? (
            <button className="primary-button" type="button" onClick={() => onNavigate(nextStep.section as SectionId)}>
              {withDirectionParticle(nextStep.label)} 이동 →
            </button>
          ) : (
            <button className="secondary-button" type="button" onClick={onLoadExample}>예시 불러오기</button>
          )}
        </div>

        <div
          className="home-progress"
          role="progressbar"
          aria-valuenow={progress.overall}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="사업 흐름 전체 진행률"
        >
          <i style={{ width: `${progress.overall}%` }} />
        </div>

        <ol className="home-step-list">
          {progress.steps.map((step, index) => (
            <li key={step.id}>
              <button
                className={`home-step ${step.percent >= 100 ? "is-done" : ""}`}
                type="button"
                onClick={() => onNavigate(step.section as SectionId)}
              >
                <span className="home-step-index" aria-hidden="true">{index + 1}</span>
                <span>
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
                <em>{step.percent}%</em>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <nav className="home-quick-links" aria-label="바로 가기">
        {QUICK_LINKS.map((link) => (
          <button className="home-quick-link" key={link.section} type="button" onClick={() => onNavigate(link.section)}>
            {link.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
