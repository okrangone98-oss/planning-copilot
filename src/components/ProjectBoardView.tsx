import { useMemo, useState } from "react";
import type { GrantPlan, ProjectData, SectionId } from "../types";
import {
  PROJECT_STATUSES,
  PROJECT_TYPES,
  dDayInfo,
  findProject,
  projectProgress,
  sortProjects,
  workspaceSummary,
  type ProjectMeta,
  type ProjectStatusId,
  type ProjectTypeId,
  type Workspace
} from "../lib/projectWorkspace.mjs";

function formatUpdatedAt(value: string) {
  if (!value) return "기록 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "기록 없음";
  return date.toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(id: string) {
  return PROJECT_STATUSES.find((status) => status.id === id)?.label || id;
}

function typeLabel(id: string) {
  return PROJECT_TYPES.find((type) => type.id === id)?.label || id;
}

type NewProjectDraft = {
  name: string;
  type: ProjectTypeId;
  status: ProjectStatusId;
  deadline: string;
};

const EMPTY_DRAFT: NewProjectDraft = { name: "", type: "contest", status: "planning", deadline: "" };

export function ProjectBoardView({
  workspace,
  project,
  grantPlan,
  onCreate,
  onSelect,
  onDuplicate,
  onRemove,
  onUpdateMeta,
  onRename,
  onNavigate,
  onLoadExample,
  onOpenDetail
}: {
  workspace: Workspace;
  project: ProjectData;
  grantPlan: GrantPlan;
  onCreate: (meta: NewProjectDraft) => void;
  onSelect: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateMeta: (id: string, patch: Partial<ProjectMeta>) => void;
  onRename: (name: string) => void;
  onNavigate: (section: SectionId) => void;
  onLoadExample: () => void;
  onOpenDetail: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<NewProjectDraft>(EMPTY_DRAFT);

  const summary = useMemo(() => workspaceSummary(workspace), [workspace]);
  const ordered = useMemo(() => sortProjects(workspace.projects), [workspace.projects]);
  const active = findProject(workspace, workspace.activeProjectId);
  const activeProgress = projectProgress({ project, plan: grantPlan });

  const submitNewProject = () => {
    const name = draft.name.trim();
    if (!name) return;
    onCreate({ ...draft, name });
    setDraft(EMPTY_DRAFT);
    setCreating(false);
  };

  return (
    <div className="project-board">
      <section className="board-summary" aria-label="사업 현황">
        <div>
          <strong>사업 {summary.total}개</strong>
        </div>
        <div className="board-summary-counts">
          {summary.byStatus.map((status) => (
            <span className={`board-count is-${status.id}`} key={status.id}>
              {status.label} {status.count}
            </span>
          ))}
        </div>
        <div className="draft-actions">
          <button className="primary-button" type="button" onClick={() => setCreating((current) => !current)} aria-expanded={creating}>
            {creating ? "새 사업 접기" : "새 사업 만들기"}
          </button>
        </div>
      </section>

      {creating && (
        <section className="board-create" aria-label="새 사업 만들기">
          <div className="form-grid">
            <label className="field wide">
              <span>사업명</span>
              <input
                value={draft.name}
                autoFocus
                placeholder="예: 2027 청년 관광두레 플러스사업"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submitNewProject();
                }}
              />
            </label>
            <label className="field">
              <span>유형</span>
              <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as ProjectTypeId })}>
                {PROJECT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>상태</span>
              <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ProjectStatusId })}>
                {PROJECT_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>마감일</span>
              <input type="date" value={draft.deadline} onChange={(event) => setDraft({ ...draft, deadline: event.target.value })} />
            </label>
          </div>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={submitNewProject} disabled={!draft.name.trim()}>만들고 전환</button>
            <button className="ghost-light-button" type="button" onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); }}>취소</button>
          </div>
          {!draft.name.trim() && <p className="board-hint">사업명을 적으면 만들 수 있습니다.</p>}
        </section>
      )}

      <div className="board-grid" aria-label="사업 목록">
        {ordered.map((meta) => {
          const dday = dDayInfo(meta.deadline);
          const isActive = meta.id === workspace.activeProjectId;
          const percent = isActive ? activeProgress.percent : meta.progress;
          return (
            <article className={`board-card ${isActive ? "is-active" : ""}`} key={meta.id} aria-current={isActive ? "true" : undefined}>
              <div className="board-card-head">
                <button className="board-card-name" type="button" onClick={() => onSelect(meta.id)} title="이 사업으로 전환">
                  {meta.name}
                </button>
                {isActive && <span className="board-current">현재</span>}
              </div>
              <div className="board-card-badges">
                <span className={`board-status is-${meta.status}`}>{statusLabel(meta.status)}</span>
                <span className="board-type">{typeLabel(meta.type)}</span>
                <span className={`board-dday is-${dday.tone}`}>{dday.label}</span>
              </div>
              <div
                className="board-progress"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${meta.name} 진행률`}
              >
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="board-card-meta">
                <span>진행 {percent}%</span>
                <span>수정 {formatUpdatedAt(meta.updatedAt)}</span>
              </div>
              <div className="board-card-actions">
                <button className="secondary-button" type="button" onClick={() => onOpenDetail(meta.id)}>상세</button>
                <button className="secondary-button" type="button" onClick={() => onSelect(meta.id)} disabled={isActive}>
                  {isActive ? "작업 중" : "전환"}
                </button>
                <button className="secondary-button" type="button" onClick={() => onDuplicate(meta.id)}>복제</button>
                <button className="ghost-light-button" type="button" onClick={() => onRemove(meta.id)} disabled={workspace.projects.length <= 1}>삭제</button>
              </div>
            </article>
          );
        })}
      </div>

      {active && (
        <section className="board-editor" aria-label="현재 사업 정보">
          <div className="grant-block-head">
            <div>
              <strong>현재 사업 · {active.name}</strong>
              <span>사업명·유형·상태·마감일은 저장되는 즉시 반영됩니다. 진행률은 계획서·예산·정산·결과보고를 합쳐 자동으로 계산합니다.</span>
            </div>
            <div className="draft-actions">
              <button className="primary-button" type="button" onClick={() => onOpenDetail(active.id)}>상세 열기</button>
              <button className="secondary-button" type="button" onClick={() => onNavigate("home")}>시작 화면으로</button>
              <button className="secondary-button" type="button" onClick={() => onNavigate("grantBudget")}>예산·정산 열기</button>
            </div>
          </div>
          <div className="form-grid">
            <label className="field wide">
              <span>사업명</span>
              <input value={project.projectName} placeholder={active.name} onChange={(event) => onRename(event.target.value)} />
            </label>
            <label className="field">
              <span>유형</span>
              <select value={active.type} onChange={(event) => onUpdateMeta(active.id, { type: event.target.value as ProjectTypeId })}>
                {PROJECT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>상태</span>
              <select value={active.status} onChange={(event) => onUpdateMeta(active.id, { status: event.target.value as ProjectStatusId })}>
                {PROJECT_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>마감일</span>
              <input type="date" value={active.deadline} onChange={(event) => onUpdateMeta(active.id, { deadline: event.target.value })} />
            </label>
            {!project.projectName.trim() && (
              <p className="board-hint wide">사업명을 비우면 목록에는 ‘{active.name}’ 이름이 그대로 남습니다.</p>
            )}
          </div>
          <div className="board-progress-parts" aria-label="진행률 구성">
            {activeProgress.parts.map((part) => (
              <div className="board-progress-part" key={part.key}>
                <span>{part.label}</span>
                <em>{part.percent}%</em>
                <small>가중 {part.weight}</small>
              </div>
            ))}
          </div>
          <div className="draft-actions">
            <button className="ghost-light-button" type="button" onClick={onLoadExample}>예시 불러오기</button>
          </div>
        </section>
      )}
    </div>
  );
}
