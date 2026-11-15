import { useEffect, useMemo, useState } from "react";
import type { ProjectMeta } from "../lib/projectWorkspace.mjs";
import { dDayInfo } from "../lib/projectWorkspace.mjs";
import { listStages, stageLabel } from "../lib/stageTemplate.mjs";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  addTask,
  applyBulkDateChanges,
  bulkDatePreview,
  removeTask,
  taskDependencyState,
  taskPriorityLabel,
  taskStatusLabel,
  updateTask,
  workSummary,
  type BulkDatePreview,
  type ProjectWork,
  type TaskPriorityId,
  type TaskStatusId,
  type WorkTask
} from "../lib/projectOperations.mjs";
import { CalendarMonthGrid, currentMonth, type CalendarItem } from "./CalendarMonthGrid";

const FILTERS: Array<{ id: "all" | "open" | "overdue" | "today" | "done"; label: string }> = [
  { id: "all", label: "전체" },
  { id: "open", label: "남은 일" },
  { id: "overdue", label: "지연" },
  { id: "today", label: "오늘 마감" },
  { id: "done", label: "완료" }
];

function todayText() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string) {
  if (!value) return "—";
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** 업무 하나를 고치는 폼. 저장할 때 사유를 남기면 변경 이력에 함께 남는다. */
function TaskEditForm({
  task,
  work,
  onSave,
  onDelete,
  onClose
}: {
  task: WorkTask;
  work: ProjectWork;
  onSave: (patch: Partial<WorkTask>, reason: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: task.title,
    stage: task.stage as string,
    sessionId: task.sessionId,
    owner: task.owner,
    dueDate: task.dueDate,
    status: task.status as TaskStatusId,
    priority: task.priority as TaskPriorityId,
    completionCriteria: task.completionCriteria
  });
  const [dependsOn, setDependsOn] = useState<string[]>(task.dependsOn);
  const [reason, setReason] = useState("");

  const candidates = work.tasks.filter((item) => item.id !== task.id).slice(0, 60);
  const toggleDependency = (id: string) => {
    setDependsOn((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 5) return current;
      return [...current, id];
    });
  };

  return (
    <section className="pc-edit-panel" aria-label="업무 수정">
      <div className="block-head">
        <h3>업무 수정</h3>
        <button className="ghost-light-button" type="button" onClick={onClose}>닫기</button>
      </div>
      <div className="form-grid">
        <label className="field wide">
          <span>업무명</span>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label className="field">
          <span>단계</span>
          <select value={form.stage} onChange={(event) => setForm({ ...form, stage: event.target.value })}>
            <option value="">단계 없음</option>
            {listStages().map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>회차</span>
          <select value={form.sessionId} onChange={(event) => setForm({ ...form, sessionId: event.target.value })}>
            <option value="">공통(회차 없음)</option>
            {work.sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.sequence}회차 · {session.title}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>담당</span>
          <input value={form.owner} placeholder="이름 또는 역할" onChange={(event) => setForm({ ...form, owner: event.target.value })} />
        </label>
        <label className="field">
          <span>기한</span>
          <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
        </label>
        <label className="field">
          <span>상태</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as TaskStatusId })}>
            {TASK_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>우선순위</span>
          <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as TaskPriorityId })}>
            {TASK_PRIORITIES.map((priority) => <option key={priority.id} value={priority.id}>{priority.label}</option>)}
          </select>
        </label>
        <label className="field wide">
          <span>완료 조건</span>
          <input value={form.completionCriteria} placeholder="예: 출석부와 사진을 폴더에 넣었다" onChange={(event) => setForm({ ...form, completionCriteria: event.target.value })} />
        </label>
        <label className="field wide">
          <span>변경 사유 (선택)</span>
          <input value={reason} placeholder="예: 강사 일정이 하루 밀림" onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>

      <div className="pc-dependency-picker">
        <strong>선행 업무 (최대 5개)</strong>
        <p className="block-note">선행 업무가 끝나기 전에는 목록에 ‘대기’로 표시됩니다.</p>
        <div className="pc-dependency-list">
          {candidates.length === 0 && <span className="block-note">함께 묶을 업무가 아직 없습니다.</span>}
          {candidates.map((candidate) => (
            <label className="pc-dependency-item" key={candidate.id}>
              <input
                type="checkbox"
                checked={dependsOn.includes(candidate.id)}
                onChange={() => toggleDependency(candidate.id)}
              />
              <span>{candidate.title}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="draft-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() => onSave({ ...form, stage: form.stage as WorkTask["stage"], dependsOn }, reason)}
          disabled={!form.title.trim()}
        >
          저장
        </button>
        <button className="ghost-light-button" type="button" onClick={onDelete}>업무 삭제</button>
      </div>
    </section>
  );
}

/** 업무·일정 탭: 목록·달력·일괄 날짜 변경·지연 표시. */
export function ProjectTaskView({
  meta,
  work,
  onUpdateWork,
  notify,
  focusTaskId
}: {
  meta: ProjectMeta;
  work: ProjectWork;
  onUpdateWork: (next: ProjectWork) => void;
  notify: (message: string) => void;
  focusTaskId?: string;
}) {
  const now = new Date();
  const summary = useMemo(() => workSummary(work, now), [work]);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filter, setFilter] = useState<"all" | "open" | "overdue" | "today" | "done">("all");
  const [stageFilter, setStageFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string>(focusTaskId || "");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ title: "", stage: "", sessionId: "", dueDate: "", owner: "" });
  const [month, setMonth] = useState(() => currentMonth());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkScope, setBulkScope] = useState<"all" | "stage" | "session">("all");
  const [bulkMode, setBulkMode] = useState<"shift" | "set">("shift");
  const [bulkDays, setBulkDays] = useState(7);
  const [bulkDate, setBulkDate] = useState("");
  const [preview, setPreview] = useState<BulkDatePreview | null>(null);

  const today = todayText();
  const sessionById = useMemo(() => new Map(work.sessions.map((session) => [session.id, session])), [work.sessions]);

  const visible = useMemo(() => {
    const needle = query.trim();
    return work.tasks
      .filter((task) => {
        if (filter === "done" && task.status !== "done") return false;
        if (filter === "open" && !["planned", "doing", "hold"].includes(task.status)) return false;
        if (filter === "overdue") {
          if (task.status === "done" || task.status === "cancelled") return false;
          if (!task.dueDate || task.dueDate >= today) return false;
        }
        if (filter === "today") {
          if (task.status === "done" || task.status === "cancelled") return false;
          if (task.dueDate !== today) return false;
        }
        if (stageFilter && task.stage !== stageFilter) return false;
        if (sessionFilter && task.sessionId !== sessionFilter) return false;
        if (needle && !`${task.title} ${task.owner} ${stageLabel(task.stage)}`.includes(needle)) return false;
        return true;
      })
      .sort((left, right) => {
        if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate < right.dueDate ? -1 : 1;
        if (left.dueDate && !right.dueDate) return -1;
        if (!left.dueDate && right.dueDate) return 1;
        return left.title < right.title ? -1 : 1;
      });
  }, [work.tasks, filter, stageFilter, sessionFilter, query, today]);

  // 달력으로 바꾸면 일이 있는 달을 먼저 보여 준다(이번 달이 비어 있을 때만).
  useEffect(() => {
    if (view !== "calendar") return;
    if (visible.some((task) => task.dueDate.startsWith(month))) return;
    const dates = visible.map((task) => task.dueDate).filter(Boolean).sort();
    if (!dates.length) return;
    const target = dates.find((date) => date >= today) || dates[0];
    setMonth(target.slice(0, 7));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const editing = work.tasks.find((task) => task.id === editingId) || null;
  const calendarItems: CalendarItem[] = visible
    .filter((task) => task.dueDate)
    .map((task) => ({ id: task.id, date: task.dueDate, title: task.title, tone: task.status }));

  const saveTask = (id: string, patch: Partial<WorkTask>, reason: string) => {
    const result = updateTask(work, id, patch, { now: new Date(), reason });
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(`‘${result.task?.title}’ 업무를 저장했습니다.`);
  };

  const toggleDone = (task: WorkTask) => {
    const nextStatus: TaskStatusId = task.status === "done" ? "planned" : "done";
    const result = updateTask(work, task.id, { status: nextStatus }, { now: new Date() });
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(nextStatus === "done" ? `‘${task.title}’을 완료로 표시했습니다.` : `‘${task.title}’을 다시 열었습니다.`);
  };

  const submitAdd = () => {
    const title = addDraft.title.trim();
    if (!title) return;
    const result = addTask(
      work,
      {
        title,
        stage: addDraft.stage as WorkTask["stage"],
        sessionId: addDraft.sessionId,
        dueDate: addDraft.dueDate,
        owner: addDraft.owner
      },
      new Date()
    );
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    setAddDraft({ title: "", stage: addDraft.stage, sessionId: addDraft.sessionId, dueDate: "", owner: "" });
    setAdding(false);
    notify(`‘${title}’ 업무를 추가했습니다.`);
  };

  const deleteTask = (task: WorkTask) => {
    if (!window.confirm(`‘${task.title}’ 업무를 지울까요? 변경 이력은 남습니다.`)) return;
    const result = removeTask(work, task.id, new Date());
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    setEditingId("");
    notify(`‘${task.title}’ 업무를 지웠습니다.`);
  };

  const runPreview = () => {
    const result = bulkDatePreview(work, {
      scope: bulkScope,
      stage: stageFilter,
      sessionId: sessionFilter || work.sessions[0]?.id || "",
      mode: bulkMode,
      days: bulkDays,
      date: bulkDate
    });
    setPreview(result);
    if (result.error) notify(result.error);
  };

  const applyPreview = () => {
    if (!preview || !preview.count) return;
    const result = applyBulkDateChanges(work, preview, { now: new Date(), reason: `일괄 날짜 변경(${bulkMode === "shift" ? `${bulkDays}일` : bulkDate})` });
    onUpdateWork(result.work);
    setPreview(null);
    notify(`업무 ${result.changed}개의 기한을 바꿨습니다.`);
  };

  return (
    <div className="pc-tasks">
      <div className="pc-stat-row" aria-label="업무 현황">
        <div className="pc-stat"><span>전체</span><strong>{summary.total}</strong></div>
        <div className="pc-stat"><span>남은 일</span><strong>{summary.open}</strong></div>
        <div className={`pc-stat ${summary.overdue ? "is-danger" : ""}`}><span>지연</span><strong>{summary.overdue}</strong></div>
        <div className={`pc-stat ${summary.dueToday ? "is-warning" : ""}`}><span>오늘 마감</span><strong>{summary.dueToday}</strong></div>
        <div className="pc-stat"><span>완료율</span><strong>{summary.percent}%</strong></div>
      </div>

      <div className="pc-toolbar">
        <div className="seg pc-view-seg" role="group" aria-label="보기 방식">
          <button className={`seg-item ${view === "list" ? "is-selected" : ""}`} type="button" onClick={() => setView("list")} aria-pressed={view === "list"}>리스트</button>
          <button className={`seg-item ${view === "calendar" ? "is-selected" : ""}`} type="button" onClick={() => setView("calendar")} aria-pressed={view === "calendar"}>달력</button>
        </div>
        <button className="secondary-button" type="button" onClick={() => setBulkOpen((current) => !current)} aria-expanded={bulkOpen}>
          일괄 날짜 변경
        </button>
        <button className="primary-button" type="button" onClick={() => setAdding((current) => !current)} aria-expanded={adding}>
          {adding ? "추가 접기" : "업무 추가"}
        </button>
      </div>

      {bulkOpen && (
        <section className="pc-bulk" aria-label="일괄 날짜 변경">
          <div className="pc-bulk-row">
            <label className="field">
              <span>대상</span>
              <select value={bulkScope} onChange={(event) => { setBulkScope(event.target.value as "all" | "stage" | "session"); setPreview(null); }}>
                <option value="all">모든 업무</option>
                <option value="stage">아래에서 고른 단계</option>
                <option value="session">아래에서 고른 회차</option>
              </select>
            </label>
            <label className="field">
              <span>방식</span>
              <select value={bulkMode} onChange={(event) => { setBulkMode(event.target.value as "shift" | "set"); setPreview(null); }}>
                <option value="shift">기존 기한에서 며칠 미루기</option>
                <option value="set">한 날짜로 맞추기</option>
              </select>
            </label>
            {bulkMode === "shift" ? (
              <label className="field">
                <span>며칠</span>
                <input type="number" value={bulkDays} onChange={(event) => { setBulkDays(Number(event.target.value) || 0); setPreview(null); }} />
              </label>
            ) : (
              <label className="field">
                <span>날짜</span>
                <input type="date" value={bulkDate} onChange={(event) => { setBulkDate(event.target.value); setPreview(null); }} />
              </label>
            )}
          </div>
          {bulkScope === "stage" && (
            <label className="field">
              <span>단계</span>
              <select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); setPreview(null); }}>
                <option value="">단계 고르기</option>
                {listStages().map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </label>
          )}
          {bulkScope === "session" && (
            <label className="field">
              <span>회차</span>
              <select value={sessionFilter} onChange={(event) => { setSessionFilter(event.target.value); setPreview(null); }}>
                <option value="">회차 고르기</option>
                {work.sessions.map((session) => <option key={session.id} value={session.id}>{session.sequence}회차 · {session.title}</option>)}
              </select>
            </label>
          )}
          <div className="draft-actions">
            <button className="secondary-button" type="button" onClick={runPreview}>미리보기</button>
            <button className="primary-button" type="button" onClick={applyPreview} disabled={!preview || !preview.count}>적용</button>
          </div>
          {preview && !preview.error && (
            <div className="pc-bulk-preview">
              <strong>{preview.count}개 업무의 기한이 바뀝니다.</strong>
              {preview.unchanged > 0 && <span>이미 같은 날짜인 {preview.unchanged}개는 그대로 둡니다.</span>}
              <ul>
                {preview.items.slice(0, 8).map((item) => (
                  <li key={item.taskId}>{item.title}: {formatDate(item.before)} → {formatDate(item.after)}</li>
                ))}
              </ul>
              {preview.items.length > 8 && <span>외 {preview.items.length - 8}개</span>}
            </div>
          )}
          {preview?.error && <p className="pc-notice is-danger">{preview.error}</p>}
        </section>
      )}

      {adding && (
        <section className="pc-add" aria-label="업무 추가">
          <div className="form-grid">
            <label className="field wide">
              <span>업무명</span>
              <input
                value={addDraft.title}
                autoFocus
                placeholder="예: 3회차 강사 섭외 확인 전화"
                onChange={(event) => setAddDraft({ ...addDraft, title: event.target.value })}
                onKeyDown={(event) => { if (event.key === "Enter") submitAdd(); }}
              />
            </label>
            <label className="field">
              <span>단계</span>
              <select value={addDraft.stage} onChange={(event) => setAddDraft({ ...addDraft, stage: event.target.value })}>
                <option value="">단계 없음</option>
                {listStages().map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>회차</span>
              <select value={addDraft.sessionId} onChange={(event) => setAddDraft({ ...addDraft, sessionId: event.target.value })}>
                <option value="">공통</option>
                {work.sessions.map((session) => <option key={session.id} value={session.id}>{session.sequence}회차</option>)}
              </select>
            </label>
            <label className="field">
              <span>기한</span>
              <input type="date" value={addDraft.dueDate} onChange={(event) => setAddDraft({ ...addDraft, dueDate: event.target.value })} />
            </label>
            <label className="field">
              <span>담당</span>
              <input value={addDraft.owner} onChange={(event) => setAddDraft({ ...addDraft, owner: event.target.value })} />
            </label>
          </div>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={submitAdd} disabled={!addDraft.title.trim()}>추가</button>
            <button className="ghost-light-button" type="button" onClick={() => setAdding(false)}>취소</button>
          </div>
        </section>
      )}

      <div className="pc-filter-row">
        <div className="grant-filter-row" role="group" aria-label="업무 거르기">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={`grant-filter ${filter === item.id ? "is-selected" : ""}`}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
              {item.id === "overdue" && summary.overdue ? ` ${summary.overdue}` : ""}
              {item.id === "today" && summary.dueToday ? ` ${summary.dueToday}` : ""}
            </button>
          ))}
        </div>
        <label className="field pc-filter-field">
          <span className="pc-sr-only">단계</span>
          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} aria-label="단계로 거르기">
            <option value="">모든 단계</option>
            {listStages().map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}
          </select>
        </label>
        <label className="field pc-filter-field">
          <span className="pc-sr-only">회차</span>
          <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} aria-label="회차로 거르기">
            <option value="">모든 회차</option>
            {work.sessions.map((session) => <option key={session.id} value={session.id}>{session.sequence}회차</option>)}
          </select>
        </label>
        <label className="field pc-filter-field is-grow">
          <span className="pc-sr-only">검색</span>
          <input value={query} placeholder="업무명·담당으로 찾기" aria-label="업무 검색" onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      {editing && (
        <TaskEditForm
          key={editing.id}
          task={editing}
          work={work}
          onSave={(patch, reason) => saveTask(editing.id, patch, reason)}
          onDelete={() => deleteTask(editing)}
          onClose={() => setEditingId("")}
        />
      )}

      {view === "calendar" ? (
        <>
          {calendarItems.length === 0 && visible.length > 0 && (
            <p className="pc-notice">
              기한이 있는 업무가 없어 달력에 표시할 것이 없습니다. 업무명을 눌러 기한을 넣거나, 위의 ‘일괄 날짜 변경’으로 한 번에 채울 수 있습니다.
            </p>
          )}
          <CalendarMonthGrid month={month} items={calendarItems} onMonthChange={setMonth} onSelect={(id) => setEditingId(id)} />
        </>
      ) : visible.length === 0 ? (
        <div className="office-empty">
          <strong>조건에 맞는 업무가 없습니다.</strong>
          <span>{work.tasks.length === 0 ? "개요 탭에서 계획을 확정하면 12단계 업무 초안이 만들어집니다. 직접 추가해도 됩니다." : "거르기 조건을 바꿔 보세요."}</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stacked-table pc-task-table">
            <thead>
              <tr>
                <th>완료</th>
                <th>업무</th>
                <th>단계</th>
                <th>회차</th>
                <th>담당</th>
                <th>기한</th>
                <th>상태</th>
                <th>선행</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => {
                const dday = task.dueDate ? dDayInfo(task.dueDate) : null;
                const dependency = taskDependencyState(task, work);
                const session = task.sessionId ? sessionById.get(task.sessionId) : null;
                return (
                  <tr key={task.id} className={task.status === "done" ? "is-done" : ""}>
                    <td data-label="완료">
                      <button
                        className={`pc-check-button ${task.status === "done" ? "is-checked" : ""}`}
                        type="button"
                        aria-pressed={task.status === "done"}
                        aria-label={`${task.title} 완료 표시`}
                        onClick={() => toggleDone(task)}
                      >
                        {task.status === "done" ? "✓" : ""}
                      </button>
                    </td>
                    <td data-label="업무">
                      <button className="pc-task-title" type="button" onClick={() => setEditingId(task.id)}>
                        {task.title}
                      </button>
                      {task.completionCriteria && <small className="pc-task-criteria">{task.completionCriteria}</small>}
                    </td>
                    <td data-label="단계">{stageLabel(task.stage)}</td>
                    <td data-label="회차">{session ? `${session.sequence}회차` : "공통"}</td>
                    <td data-label="담당">{task.owner || "—"}</td>
                    <td data-label="기한">
                      {task.dueDate ? (
                        <span className={`pc-due is-${dday?.tone || "normal"}`}>
                          {formatDate(task.dueDate)} <small>{dday?.label}</small>
                        </span>
                      ) : "—"}
                    </td>
                    <td data-label="상태">
                      <span className={`pc-task-status is-${task.status}`}>{taskStatusLabel(task.status)}</span>
                      <small className="pc-priority">{taskPriorityLabel(task.priority)}</small>
                    </td>
                    <td data-label="선행">{dependency.blocked ? "대기" : task.dependsOn.length ? "충족" : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "list" && work.tasks.length > 0 && (
        <p className="block-note">
          업무명을 누르면 담당·기한·선행 업무를 고칠 수 있습니다. 완료 칸을 누르면 바로 완료로 바뀌고 변경 이력에 남습니다.
          {meta.startDate || meta.endDate ? ` 사업 기간 ${meta.startDate || "미정"} ~ ${meta.endDate || "미정"}.` : ""}
        </p>
      )}
    </div>
  );
}
