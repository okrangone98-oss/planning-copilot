import { useRef } from "react";
import type { GrantPlan, SectionId } from "../types";
import { budgetSummary, formatWon, grantProgress } from "../lib/grantWorkflow.mjs";
import { SAMPLE_ACCEPT } from "../lib/sampleTemplateParser.mjs";
import { PROJECT_STATUSES, dDayInfo, type ProjectMeta } from "../lib/projectWorkspace.mjs";
import type { NextAction, ProjectDigest } from "../lib/projectOperations.mjs";

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
  templateSummary,
  digest,
  onOpenNextAction,
  onOpenSession,
  onOpenEvidence,
  onStartCarryover
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
  digest?: ProjectDigest | null;
  onOpenNextAction?: (action: NextAction) => void;
  /** 다가오는 회차를 눌렀을 때 그 사업의 회차 탭으로 간다. */
  onOpenSession?: (projectId: string, sessionId: string) => void;
  /** 증빙 미확인 사업을 눌렀을 때 지출 원장(예산·집행)으로 간다. */
  onOpenEvidence?: (projectId: string) => void;
  /** 첫 화면의 큰 버튼 — 작년 결과보고서를 올해 것으로 바꾸는 3단계 화면을 연다. */
  onStartCarryover: () => void;
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
      <section className="home-choices" aria-label="무엇을 할까요">
        <button className="home-choice is-primary" type="button" onClick={onStartCarryover}>
          <span className="home-choice-icon" aria-hidden="true">🔄</span>
          <span className="home-choice-main">
            <strong>작년 결과보고서 → 올해 것으로 바꾸기</strong>
            <small>작년 결과보고서(.hwpx)를 올리고 올해 계획서·정산 자료만 넣으면 숫자와 내용을 갈아끼워 내려받습니다.</small>
          </span>
          <span className="home-choice-go" aria-hidden="true">시작 ›</span>
        </button>
        <button className="home-choice" type="button" onClick={() => onNavigate("templateFill")}>
          <span className="home-choice-icon" aria-hidden="true">📄</span>
          <span className="home-choice-main">
            <strong>새 계획서·양식 채우기</strong>
            <small>공고에서 받은 빈 양식(.hwpx)을 올려 처음부터 채웁니다.</small>
          </span>
          <span className="home-choice-go" aria-hidden="true">열기 ›</span>
        </button>
      </section>

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

      {digest && (
        <section className="block home-today" aria-label="오늘 할 일">
          <div className="block-head">
            <h3>오늘 할 일</h3>
            <span className="block-count">사업 {projects.length}개 합산</span>
          </div>
          <div className="home-today-grid">
            <div className={`home-today-stat ${digest.overdue ? "is-danger" : ""}`}>
              <span>지연 업무</span>
              <strong>{digest.overdue}</strong>
            </div>
            <div className={`home-today-stat ${digest.dueToday ? "is-warning" : ""}`}>
              <span>오늘 마감</span>
              <strong>{digest.dueToday}</strong>
            </div>
            <div className="home-today-stat">
              <span>7일 안 마감</span>
              <strong>{digest.dueSoon}</strong>
            </div>
            <div className={`home-today-stat ${digest.evidence?.missing ? "is-warning" : ""}`}>
              <span>증빙 미확인</span>
              <strong>{digest.evidence?.missing || 0}</strong>
            </div>
            <div className="home-today-stat">
              <span>다가오는 회차</span>
              <strong>{digest.upcomingSessions?.length || 0}</strong>
            </div>
            <div className="home-today-stat">
              <span>운영 중 사업</span>
              <strong>{digest.running.length}</strong>
            </div>
          </div>

          {digest.next ? (
            <button className="home-next" type="button" onClick={() => onOpenNextAction?.(digest.next as NextAction)}>
              <span className="home-next-kicker">다음 권장 행동</span>
              <strong>{digest.next.label}</strong>
              <span className="home-next-detail">{digest.next.detail}</span>
              <em>{digest.next.actionLabel} ›</em>
            </button>
          ) : (
            <p className="block-note">
              지금 급한 업무가 없습니다. 새 사업을 만들거나 사업 관리에서 다음 단계를 정해 보세요.
            </p>
          )}

          {digest.upcomingSessions?.length > 0 && (
            <div className="home-upcoming">
              <div className="home-upcoming-head">
                <strong>다가오는 회차</strong>
                <span>30일 안 · 가까운 순</span>
              </div>
              <ul className="home-session-list">
                {digest.upcomingSessions.slice(0, 4).map((session) => (
                  <li key={session.sessionId}>
                    <button
                      className="home-session"
                      type="button"
                      onClick={() => onOpenSession?.(session.projectId, session.sessionId)}
                    >
                      <span className="home-session-dday">{session.days === 0 ? "오늘" : `D-${session.days}`}</span>
                      <span className="home-session-main">
                        <strong>{session.title.startsWith(`${session.sequence}회차`) ? session.title : `${session.sequence}회차 · ${session.title}`}</strong>
                        <small>{session.projectName}{session.venue ? ` · ${session.venue}` : ""}</small>
                      </span>
                      <span className="home-session-time">{session.startAt.slice(5, 10).replace("-", "/")}{session.startAt.includes("T") ? ` ${session.startAt.slice(11, 16)}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {digest.evidence?.missing > 0 && (
            <div className="home-evidence">
              <div className="home-upcoming-head">
                <strong>증빙 미확인</strong>
                <span>{digest.evidence.missing}건 · {formatWon(digest.evidence.amount)}</span>
              </div>
              <div className="home-running">
                {digest.evidence.items.map((item) => (
                  <button key={item.projectId} className="home-running-chip is-warning" type="button" onClick={() => onOpenEvidence?.(item.projectId)}>
                    {item.projectName} 미확인 {item.missing}건
                  </button>
                ))}
              </div>
            </div>
          )}

          {digest.overdueItems.length > 0 && (
            <ul className="home-overdue-list">
              {digest.overdueItems.slice(0, 3).map((item) => (
                <li key={`${item.projectId}-${item.title}`}>
                  <strong>{item.title}</strong>
                  <span>{item.projectName} · {item.dueDate}</span>
                </li>
              ))}
            </ul>
          )}

          {digest.running.length > 0 && (
            <div className="home-running">
              <span>운영 중</span>
              {digest.running.slice(0, 4).map((item) => (
                <button key={item.id} className="home-running-chip" type="button" onClick={() => onSelectProject(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <details className="block home-more" aria-label="다른 작업">
        <summary>
          <strong>다른 작업</strong>
          <span className="block-count">문서에서 정산까지 4단계 · 읽어 둔 양식 · 내 사업</span>
        </summary>
      <section className="block home-more-inner" aria-label="문서·예산 흐름">
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

      <section className="block home-more-inner" aria-label="샘플 양식">
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

      </details>

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
