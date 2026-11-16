import { useEffect, useState } from "react";
import type { BudgetSheetColumn, GrantBudgetLine, GrantPlan, ProjectData, SectionId } from "../types";
import { budgetSummary, formatWon } from "../lib/grantWorkflow.mjs";
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  dDayInfo,
  projectProgress,
  type ProjectMeta,
  type ProjectTypeId,
  type ProjectStatusId,
  type Workspace
} from "../lib/projectWorkspace.mjs";
import {
  CONFIRM_REQUIRED_STATUSES,
  expenseSummary,
  sessionSummary,
  taskBuckets,
  workSummary,
  type ProjectWork
} from "../lib/projectOperations.mjs";
import { ProjectChangeLogView } from "./ProjectChangeLogView";
import { ProjectPlanTransition, type ConfirmPlanRequest, type ConfirmPlanResult } from "./ProjectPlanTransition";
import { ProjectTaskView } from "./ProjectTaskView";
import { ProjectSessionView } from "./ProjectSessionView";
import { ProjectBudgetTab } from "./ProjectBudgetTab";

export type DetailTab = "overview" | "tasks" | "sessions" | "budget";

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "개요" },
  { id: "tasks", label: "업무·일정" },
  { id: "sessions", label: "회차" },
  { id: "budget", label: "예산·집행" }
];

const QUICK_LINKS: Array<{ section: SectionId; label: string }> = [
  { section: "notice", label: "공고 해석" },
  { section: "templateFill", label: "양식 채우기" },
  { section: "grantBudget", label: "예산 편성" },
  { section: "grantChecklist", label: "정산 증빙" },
  { section: "grantReport", label: "결과보고" }
];

function formatIsoDate(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 목표·출처는 목록을 편집한다. 입력 중 공백이 잘리지 않도록 blur에서 저장한다. */
function TextListEditor({
  items,
  max,
  addLabel,
  placeholder,
  onChange
}: {
  items: string[];
  max: number;
  addLabel: string;
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState<string[]>(items);
  useEffect(() => setDraft(items), [items]);

  const update = (index: number, value: string) => setDraft(draft.map((item, position) => (position === index ? value : item)));
  const commit = () => onChange(draft.map((item) => item.trim()).filter(Boolean));
  const remove = (index: number) => {
    const next = draft.filter((_, position) => position !== index);
    setDraft(next);
    onChange(next.map((item) => item.trim()).filter(Boolean));
  };

  return (
    <div className="pc-list-editor">
      {draft.map((item, index) => (
        <div className="pc-list-row" key={index}>
          <input
            value={item}
            placeholder={placeholder}
            aria-label={`${placeholder} ${index + 1}`}
            onChange={(event) => update(index, event.target.value)}
            onBlur={commit}
          />
          <button className="ghost-light-button" type="button" onClick={() => remove(index)} aria-label="삭제">삭제</button>
        </div>
      ))}
      {draft.length < max && (
        <button className="secondary-button" type="button" onClick={() => setDraft([...draft, ""])}>{addLabel}</button>
      )}
    </div>
  );
}

/** 사업 상세: 네 탭(개요·업무·회차·예산)과 계획 확정·변경 이력. */
export function ProjectDetailView({
  workspace,
  meta,
  project,
  grantPlan,
  work,
  tab,
  onTabChange,
  onBack,
  onUpdateMeta,
  onRename,
  onUpdateWork,
  onChangeGrantLines,
  onChangeGrantColumns,
  onNavigate,
  onConfirmPlan,
  notify,
  focusTaskId,
  onSendBudgetToTemplate
}: {
  workspace: Workspace;
  meta: ProjectMeta;
  project: ProjectData;
  grantPlan: GrantPlan;
  work: ProjectWork;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onBack: () => void;
  onUpdateMeta: (id: string, patch: Partial<ProjectMeta>) => void;
  onRename: (name: string) => void;
  onUpdateWork: (next: ProjectWork) => void;
  onChangeGrantLines: (lines: GrantBudgetLine[]) => void;
  /** 예산 관리표의 머리글·열을 사업에 저장한다. */
  onChangeGrantColumns: (columns: BudgetSheetColumn[]) => void;
  onNavigate: (section: SectionId) => void;
  onConfirmPlan: (request: ConfirmPlanRequest) => ConfirmPlanResult;
  notify: (message: string) => void;
  focusTaskId?: string;
  /** 예산 관리표 숫자를 서류 양식 채우기(2단계)로 보낸다. */
  onSendBudgetToTemplate?: () => void;
}) {
  const [showAllChanges, setShowAllChanges] = useState(false);
  const progress = projectProgress({ project, plan: grantPlan });
  const budget = budgetSummary(grantPlan);
  const summary = workSummary(work);
  const sessions = sessionSummary(work);
  const ledger = expenseSummary(work, grantPlan);
  const buckets = taskBuckets(work);
  const dday = dDayInfo(meta.deadline);
  const statusLabel = PROJECT_STATUSES.find((status) => status.id === meta.status)?.label || meta.status;
  const confirmRequired = CONFIRM_REQUIRED_STATUSES.includes(meta.status);

  return (
    <div className="pc-detail">
      <header className="pc-detail-head">
        <button className="ghost-light-button" type="button" onClick={onBack}>‹ 사업 목록</button>
        <div className="pc-detail-title">
          <p className="eyebrow">사업 상세</p>
          <h2>{project.projectName.trim() || meta.name}</h2>
          <div className="pc-detail-badges">
            <span className={`board-status is-${meta.status}`}>{statusLabel}</span>
            <span className="board-type">{PROJECT_TYPES.find((type) => type.id === meta.type)?.label}</span>
            <span className="board-type">{meta.year}년</span>
            {meta.deadline && <span className={`board-dday is-${dday.tone}`}>신청 {dday.label}</span>}
            <span className="board-type">진행 {progress.percent}%</span>
          </div>
        </div>
        <div className="draft-actions pc-detail-actions">
          <button className="secondary-button" type="button" onClick={() => onNavigate("grantBudget")}>예산 편성</button>
          <button className="secondary-button" type="button" onClick={() => onNavigate("workbrainExport")}>내보내기</button>
        </div>
      </header>

      <nav className="pc-detail-tabs" role="tablist" aria-label="사업 상세 탭">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`pc-detail-tab ${tab === item.id ? "is-selected" : ""}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
            {item.id === "tasks" && summary.overdue > 0 && <em className="pc-tab-badge">{summary.overdue}</em>}
            {item.id === "sessions" && sessions.total > 0 && <em className="pc-tab-count">{sessions.total}</em>}
            {item.id === "budget" && ledger.evidence.missing > 0 && <em className="pc-tab-badge">{ledger.evidence.missing}</em>}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="pc-overview">
          <section className="pc-card" aria-label="사업 정보">
            <div className="block-head">
              <h3>사업 마스터</h3>
              <span className="block-count">수정하면 바로 저장됩니다</span>
            </div>
            <div className="form-grid">
              <label className="field wide">
                <span>사업명</span>
                <input value={project.projectName} placeholder={meta.name} onChange={(event) => onRename(event.target.value)} />
              </label>
              <label className="field">
                <span>유형</span>
                <select value={meta.type} onChange={(event) => onUpdateMeta(meta.id, { type: event.target.value as ProjectTypeId })}>
                  {PROJECT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>연도</span>
                <input
                  value={meta.year}
                  inputMode="numeric"
                  placeholder="2027"
                  onChange={(event) => onUpdateMeta(meta.id, { year: event.target.value })}
                />
              </label>
              <label className="field">
                <span>담당자</span>
                <input value={meta.ownerName} placeholder="이름" onChange={(event) => onUpdateMeta(meta.id, { ownerName: event.target.value })} />
              </label>
              <label className="field">
                <span>상태</span>
                <select value={meta.status} onChange={(event) => onUpdateMeta(meta.id, { status: event.target.value as ProjectStatusId })}>
                  {PROJECT_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>사업 시작</span>
                <input type="date" value={meta.startDate} onChange={(event) => onUpdateMeta(meta.id, { startDate: event.target.value })} />
              </label>
              <label className="field">
                <span>사업 종료</span>
                <input type="date" value={meta.endDate} onChange={(event) => onUpdateMeta(meta.id, { endDate: event.target.value })} />
              </label>
              <label className="field">
                <span>신청·제출 마감</span>
                <input type="date" value={meta.deadline} onChange={(event) => onUpdateMeta(meta.id, { deadline: event.target.value })} />
              </label>
              <div className="field">
                <span>예산(계획액)</span>
                <div className="pc-derived-value">
                  <strong>{formatWon(budget.total)}</strong>
                  <button className="block-link" type="button" onClick={() => onNavigate("grantBudget")}>예산 편성에서 채우기</button>
                </div>
              </div>
            </div>
            <p className="block-note">
              예산은 예산 편성의 비목 합계를 그대로 보여 줍니다(여기서 따로 더하지 않습니다). 마감일은 신청·제출 마감, 사업 기간은 운영 기간입니다.
            </p>

            <div className="block-head">
              <h3>목표</h3>
              <span className="block-count">{meta.goals.length}/5</span>
            </div>
            <TextListEditor
              items={meta.goals}
              max={5}
              addLabel="목표 추가"
              placeholder="예: 청년 10명이 자기 마을 콘텐츠를 기획한다"
              onChange={(goals) => onUpdateMeta(meta.id, { goals })}
            />

            <details className="pc-source-refs">
              <summary>출처·참고 ({meta.sourceRefs.length})</summary>
              <TextListEditor
                items={meta.sourceRefs}
                max={8}
                addLabel="출처 추가"
                placeholder="예: 2027 관광두레 공고문.pdf"
                onChange={(sourceRefs) => onUpdateMeta(meta.id, { sourceRefs })}
              />
              <p className="block-note">공고문·회의록 이름이나 링크를 적어 두면 나중에 근거를 찾기 쉽습니다. 민감한 원본 파일은 여기에 붙이지 마세요.</p>
            </details>
          </section>

          <section className="pc-card" aria-label="진행 상황">
            <div className="block-head">
              <h3>진행 상황</h3>
              <span className="block-count">계획 {progress.percent}% · 업무 {summary.percent}%</span>
            </div>
            <div className="board-progress-parts">
              {progress.parts.map((part) => (
                <div className="board-progress-part" key={part.key}>
                  <span>{part.label}</span>
                  <em>{part.percent}%</em>
                  <small>가중 {part.weight}</small>
                </div>
              ))}
            </div>
            <div className="pc-digest-row">
              <button className="pc-digest" type="button" onClick={() => onTabChange("tasks")}>
                <span>오늘 마감</span><strong>{summary.dueToday}</strong>
              </button>
              <button className={`pc-digest ${summary.overdue ? "is-danger" : ""}`} type="button" onClick={() => onTabChange("tasks")}>
                <span>지연 업무</span><strong>{summary.overdue}</strong>
              </button>
              <button className="pc-digest" type="button" onClick={() => onTabChange("tasks")}>
                <span>남은 업무</span><strong>{summary.open}</strong>
              </button>
              <button className="pc-digest" type="button" onClick={() => onTabChange("sessions")}>
                <span>회차</span><strong>{sessions.total}</strong>
              </button>
              <button className="pc-digest" type="button" onClick={() => onTabChange("sessions")}>
                <span>참석 합계</span><strong>{sessions.tracked ? sessions.attended : "—"}</strong>
              </button>
              <button className={`pc-digest ${ledger.evidence.missing ? "is-danger" : ""}`} type="button" onClick={() => onTabChange("budget")}>
                <span>증빙 미확인</span><strong>{ledger.evidence.missing}</strong>
              </button>
            </div>
            {buckets.overdue.length > 0 && (
              <p className="pc-notice is-danger">
                지연 업무 {buckets.overdue.length}개: {buckets.overdue.slice(0, 3).map((task) => task.title).join(", ")}
                {buckets.overdue.length > 3 ? " 외" : ""}
              </p>
            )}
          </section>

          <section className="pc-card" aria-label="바로 가기">
            <div className="block-head"><h3>이 사업으로 이어서 하기</h3></div>
            <div className="pc-quick-links">
              {QUICK_LINKS.map((link) => (
                <button className="secondary-button" key={link.section} type="button" onClick={() => onNavigate(link.section)}>
                  {link.label}
                </button>
              ))}
            </div>
          </section>

          <section className="pc-card" aria-label="계획 확정">
            <ProjectPlanTransition meta={meta} plan={grantPlan} work={work} onConfirm={onConfirmPlan} notify={notify} />
          </section>

          <section className="pc-card" aria-label="계획 리비전">
            <div className="block-head">
              <h3>계획 리비전</h3>
              <span className="block-count">{work.revisions.length}건</span>
            </div>
            {work.revisions.length === 0 ? (
              <p className="block-note">확정하면 그 시점의 계획 스냅샷이 남습니다. 이후 수정과 비교하는 기준이 됩니다.</p>
            ) : (
              <ul className="pc-revision-list">
                {work.revisions.slice(0, 6).map((revision) => (
                  <li key={revision.id}>
                    <strong>리비전 {revision.revision}</strong>
                    <span>{formatIsoDate(revision.approvedAt)}</span>
                    <em>{revision.reason || "사유 없음"}</em>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pc-card" aria-label="변경 이력">
            <ProjectChangeLogView changes={work.changes} limit={showAllChanges ? 100 : 6} />
            {work.changes.length > 6 && (
              <button className="ghost-light-button" type="button" onClick={() => setShowAllChanges((current) => !current)}>
                {showAllChanges ? "최근 6건만 보기" : `전체 ${work.changes.length}건 보기`}
              </button>
            )}
          </section>

          <p className="block-note">
            {meta.status === "done"
              ? "완료한 사업입니다. 필요한 업무는 직접 추가할 수 있지만 새 초안 생성은 막혀 있습니다."
              : confirmRequired
                ? "아직 확정 전입니다. 계획을 확정하면 업무·회차 초안이 만들어집니다."
                : `${workspace.projects.length}개 사업 중 하나입니다. 사업을 바꾸려면 사업 목록으로 돌아가세요.`}
          </p>
        </div>
      )}

      {tab === "tasks" && (
        <ProjectTaskView meta={meta} work={work} onUpdateWork={onUpdateWork} notify={notify} focusTaskId={focusTaskId} />
      )}

      {tab === "sessions" && (
        <ProjectSessionView meta={meta} work={work} onUpdateWork={onUpdateWork} notify={notify} />
      )}

      {tab === "budget" && (
        <ProjectBudgetTab
          meta={meta}
          plan={grantPlan}
          work={work}
          onChangeLines={onChangeGrantLines}
          onChangeColumns={onChangeGrantColumns}
          onUpdateWork={onUpdateWork}
          notify={notify}
          onNavigate={onNavigate}
          onOpenTab={onTabChange}
          onSendBudgetToTemplate={onSendBudgetToTemplate}
        />
      )}
    </div>
  );
}
