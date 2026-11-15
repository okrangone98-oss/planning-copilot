import { useRef } from "react";
import type { GrantPlan, SectionId } from "../types";
import { budgetSummary, formatWon, grantProgress } from "../lib/grantWorkflow.mjs";
import { SAMPLE_ACCEPT } from "../lib/sampleTemplateParser.mjs";
import { PROJECT_STATUSES, dDayInfo, type ProjectMeta } from "../lib/projectWorkspace.mjs";

const START_CARDS: Array<{
  id: string;
  title: string;
  description: string;
  action: string;
  section?: SectionId;
  file?: boolean;
}> = [
  {
    id: "plan",
    title: "공고문부터 읽기",
    description: "공고문을 붙여넣으면 평가 포인트와 다음 질문을 먼저 정리합니다.",
    action: "공고 해석 열기",
    section: "notice"
  },
  {
    id: "template",
    title: "기관 양식 채우기",
    description: "이미 쓰는 사업계획서 양식(HWPX·DOCX·PDF)을 올리면 목차와 표를 그대로 채웁니다.",
    action: "샘플 양식 채우기",
    section: "templateFill"
  },
  {
    id: "budget",
    title: "예산·정산 잡기",
    description: "비목별 예산표를 만들고 증빙 체크와 결과보고를 한 흐름으로 관리합니다.",
    action: "예산 편성 열기",
    section: "grantBudget"
  }
];

/** 받침에 따라 '으로/로'를 고른다. '정산 증빙로' 같은 표기를 막는다. */
function withDirectionParticle(label: string) {
  const last = label.trim().slice(-1);
  const code = last.charCodeAt(0);
  const hasFinalConsonant = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${label}${hasFinalConsonant ? "으로" : "로"}`;
}

export function WorkHomeView({
  projectName,
  plan,
  started,
  projects,
  activeProjectId,
  meta,
  onSelectProject,
  onOpenProjectBoard,
  onNavigate,
  onImportFile,
  onImportTemplate,
  onLoadExample,
  templateSummary
}: {
  projectName: string;
  plan: GrantPlan;
  started: boolean;
  projects: ProjectMeta[];
  activeProjectId: string;
  meta?: ProjectMeta;
  onSelectProject: (id: string) => void;
  onOpenProjectBoard: () => void;
  onNavigate: (section: SectionId) => void;
  onImportFile: (file: File) => void;
  onImportTemplate: (file: File) => void;
  onLoadExample: () => void;
  templateSummary: { sections: number; tables: number; slots: number } | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const templateRef = useRef<HTMLInputElement>(null);
  const progress = grantProgress(plan);
  const summary = budgetSummary(plan);
  const nextStep = progress.steps.find((step) => step.percent < 100) || progress.steps[progress.steps.length - 1];
  const dday = meta ? dDayInfo(meta.deadline) : null;
  const statusLabel = meta ? PROJECT_STATUSES.find((status) => status.id === meta.status)?.label : "";

  return (
    <div className="home-view">
      <section className="home-hero" aria-label="현재 사업 상황">
        <p className="eyebrow">지금 이 사업</p>
        <h2 className="home-title">{projectName.trim() || "이름 없는 사업"}</h2>
        <p className="home-line">
          {started
            ? `전체 진행 ${progress.overall}%. 다음은 ${withDirectionParticle(nextStep.label)} 가는 일입니다.`
            : "아직 입력한 내용이 없습니다. 공고문 한 장을 붙여넣거나 예시로 화면을 먼저 둘러보세요."}
        </p>
        <div className="home-meta">
          {statusLabel && <span className="badge is-brand">{statusLabel}</span>}
          {dday && <span className={`badge ${dday.tone === "soon" || dday.tone === "overdue" ? "is-warning" : ""}`}>{dday.label}</span>}
          <span className="badge">{summary.lineCount}개 비목 · {formatWon(summary.total)}</span>
        </div>
        <div className="home-hero-actions">
          {started ? (
            <button className="primary-button" type="button" onClick={() => onNavigate(nextStep.section as SectionId)}>
              {withDirectionParticle(nextStep.label)} 이동
            </button>
          ) : (
            <button className="primary-button" type="button" onClick={() => onNavigate("notice")}>공고문 붙여넣기</button>
          )}
          <button className="secondary-button" type="button" onClick={() => fileRef.current?.click()}>기존 문서 열기</button>
          {!started && <button className="ghost-light-button" type="button" onClick={onLoadExample}>예시로 둘러보기</button>}
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
      </section>

      <section className="block" aria-label="문서·예산 흐름">
        <div className="block-head">
          <h3>문서에서 정산까지</h3>
          <span className="block-count">4단계 · {progress.overall}%</span>
        </div>
        <ol className="home-step-list">
          {progress.steps.filter((step) => step.section !== "workbrainExport").map((step, index) => (
            <li key={step.id}>
              <button
                className={`home-step ${step.percent >= 100 ? "is-done" : ""}`}
                type="button"
                onClick={() => onNavigate(step.section as SectionId)}
              >
                <span className="home-step-index" aria-hidden="true">{step.percent >= 100 ? "✓" : index + 1}</span>
                <span className="home-step-main">
                  <strong>{step.label}</strong>
                  <small>{step.detail}</small>
                </span>
                <span className="home-step-percent">{step.percent}%</span>
              </button>
            </li>
          ))}
        </ol>
        <button className="secondary-button wide" type="button" onClick={() => onNavigate("workbrainExport")}>
          워크브레인 내보내기 · 한 문서로 묶기
        </button>
      </section>

      <section className="block" aria-label="시작하기">
        <div className="block-head">
          <h3>무엇부터 할까요</h3>
        </div>
        <div className="home-start-grid">
          {START_CARDS.map((card) => (
            <button
              className="home-start-card"
              key={card.id}
              type="button"
              onClick={() => (card.file ? fileRef.current?.click() : card.section && onNavigate(card.section))}
            >
              <strong>{card.title}</strong>
              <span>{card.description}</span>
              <em>{card.action} ›</em>
            </button>
          ))}
        </div>
      </section>

      <section className="block" aria-label="샘플 양식">
        <div className="block-head">
          <h3>이미 쓰는 양식이 있나요?</h3>
          <button className="block-link" type="button" onClick={() => onNavigate("templateFill")}>양식 채우기 열기</button>
        </div>
        <p className="block-note">
          {templateSummary
            ? `읽어 둔 양식: 섹션 ${templateSummary.sections}개 · 표 ${templateSummary.tables}개 · 작성 항목 ${templateSummary.slots}개`
            : "공고·기관 사업계획서 양식을 올리면 목차와 표 구조를 읽어 그대로 채웁니다."}
        </p>
        <div className="draft-actions">
          <button className="secondary-button" type="button" onClick={() => templateRef.current?.click()}>양식 파일 올리기</button>
          <button className="primary-button" type="button" onClick={() => onNavigate("templateFill")}>
            {templateSummary ? "양식 채우기 이어서" : "양식 채우기 열기"}
          </button>
        </div>
        <input
          ref={templateRef}
          className="home-file-input"
          type="file"
          accept={SAMPLE_ACCEPT}
          aria-label="샘플 양식 파일 올리기"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImportTemplate(file);
            event.target.value = "";
          }}
        />
      </section>

      <section className="block" aria-label="내 사업">
        <div className="block-head">
          <h3>내 사업 {projects.length}개</h3>
          <button className="block-link" type="button" onClick={onOpenProjectBoard}>사업 관리</button>
        </div>
        <div className="home-project-list">
          {projects.slice(0, 5).map((item) => {
            const isActive = item.id === activeProjectId;
            const itemDday = dDayInfo(item.deadline);
            return (
              <button
                className={`home-project ${isActive ? "is-active" : ""}`}
                key={item.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => onSelectProject(item.id)}
              >
                <span className="home-project-main">
                  <strong>{item.name}</strong>
                  <small>
                    {PROJECT_STATUSES.find((status) => status.id === item.status)?.label}
                    {item.deadline ? ` · ${itemDday.label}` : ""}
                  </small>
                </span>
                <span className="home-project-progress">{item.progress}%</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
