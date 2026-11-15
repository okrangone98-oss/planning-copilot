import { useMemo, useState } from "react";
import type { ProjectMeta } from "../lib/projectWorkspace.mjs";
import {
  SESSION_STATUSES,
  addSession,
  cancelSession,
  sessionStatusLabel,
  sessionSummary,
  updateSession,
  type ProjectSession,
  type ProjectWork,
  type SessionStatusId
} from "../lib/projectOperations.mjs";

function formatStartAt(value: string) {
  if (!value) return "일시 미정";
  const [date, time] = value.split("T");
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}${time ? ` ${time}` : ""}`;
}

function SessionEditForm({
  session,
  onSave,
  onClose
}: {
  session: ProjectSession;
  onSave: (patch: Partial<ProjectSession>, reason: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    title: session.title,
    startAt: session.startAt,
    venue: session.venue,
    instructorName: session.instructorName,
    capacity: String(session.capacity || ""),
    registered: String(session.registered || ""),
    attended: String(session.attended || ""),
    status: session.status as SessionStatusId,
    notes: session.notes
  });
  const [reason, setReason] = useState("");

  return (
    <section className="pc-edit-panel" aria-label="회차 수정">
      <div className="block-head">
        <h3>{session.sequence}회차 수정</h3>
        <button className="ghost-light-button" type="button" onClick={onClose}>닫기</button>
      </div>
      <div className="form-grid">
        <label className="field wide">
          <span>회차명</span>
          <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </label>
        <label className="field">
          <span>일시</span>
          <input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} />
        </label>
        <label className="field">
          <span>장소</span>
          <input value={form.venue} placeholder="예: 양양 이음터 2층" onChange={(event) => setForm({ ...form, venue: event.target.value })} />
        </label>
        <label className="field">
          <span>강사</span>
          <input value={form.instructorName} onChange={(event) => setForm({ ...form, instructorName: event.target.value })} />
        </label>
        <label className="field">
          <span>정원</span>
          <input type="number" min={0} value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
        </label>
        <label className="field">
          <span>신청</span>
          <input type="number" min={0} value={form.registered} onChange={(event) => setForm({ ...form, registered: event.target.value })} />
        </label>
        <label className="field">
          <span>참석</span>
          <input type="number" min={0} value={form.attended} onChange={(event) => setForm({ ...form, attended: event.target.value })} />
        </label>
        <label className="field">
          <span>상태</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as SessionStatusId })}>
            {SESSION_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
          </select>
        </label>
        <label className="field wide">
          <span>메모</span>
          <input value={form.notes} placeholder="준비물·특이사항" onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <label className="field wide">
          <span>변경 사유 (선택)</span>
          <input value={reason} placeholder="예: 장소를 이음터로 옮김" onChange={(event) => setReason(event.target.value)} />
        </label>
      </div>
      <div className="draft-actions">
        <button
          className="primary-button"
          type="button"
          onClick={() =>
            onSave(
              {
                title: form.title,
                startAt: form.startAt,
                venue: form.venue,
                instructorName: form.instructorName,
                capacity: Number(form.capacity) || 0,
                registered: Number(form.registered) || 0,
                attended: Number(form.attended) || 0,
                status: form.status,
                notes: form.notes
              },
              reason
            )
          }
          disabled={!form.title.trim()}
        >
          저장
        </button>
        <button className="ghost-light-button" type="button" onClick={onClose}>닫기</button>
      </div>
    </section>
  );
}

/** 회차 탭: 1사업 여러 회차, 회차별 담당·강사·장소·인원, 일부 취소. */
export function ProjectSessionView({
  meta,
  work,
  onUpdateWork,
  notify
}: {
  meta: ProjectMeta;
  work: ProjectWork;
  onUpdateWork: (next: ProjectWork) => void;
  notify: (message: string) => void;
}) {
  const summary = useMemo(() => sessionSummary(work), [work]);
  const [editingId, setEditingId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState({ title: "", startAt: "", venue: "", capacity: "" });

  const editing = work.sessions.find((session) => session.id === editingId) || null;

  const submitAdd = () => {
    const result = addSession(
      work,
      {
        title: addDraft.title.trim() || undefined,
        startAt: addDraft.startAt,
        venue: addDraft.venue,
        capacity: Number(addDraft.capacity) || 0
      },
      new Date()
    );
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    setAdding(false);
    setAddDraft({ title: "", startAt: "", venue: "", capacity: "" });
    notify(`${result.session?.sequence}회차를 추가했습니다.`);
  };

  const saveSession = (id: string, patch: Partial<ProjectSession>, reason: string) => {
    const result = updateSession(work, id, patch, { now: new Date(), reason });
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(`${result.session?.sequence}회차를 저장했습니다.`);
  };

  const cancel = (session: ProjectSession) => {
    const linked = work.tasks.filter((task) => task.sessionId === session.id && !["done", "cancelled", "hold"].includes(task.status)).length;
    const message = linked
      ? `${session.sequence}회차를 취소할까요? 연결된 업무 ${linked}개는 보류로 바꿉니다. 회차 기록은 남고 인원 합계에서 빠집니다.`
      : `${session.sequence}회차를 취소할까요? 회차 기록은 남고 인원 합계에서 빠집니다.`;
    if (!window.confirm(message)) return;
    const result = cancelSession(work, session.id, { now: new Date(), holdTasks: true, reason: "회차 취소" });
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(`${session.sequence}회차를 취소했습니다. 연결 업무 ${result.held}개를 보류로 두었습니다.`);
  };

  const restore = (session: ProjectSession) => {
    const result = updateSession(work, session.id, { status: "planned" }, { now: new Date(), reason: "회차 취소 철회" });
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(`${session.sequence}회차를 다시 예정으로 되돌렸습니다. 연결 업무는 직접 풀어 주세요.`);
  };

  return (
    <div className="pc-sessions">
      <div className="pc-stat-row" aria-label="회차 집계">
        <div className="pc-stat"><span>회차</span><strong>{summary.total}</strong></div>
        <div className="pc-stat"><span>진행 예정</span><strong>{summary.planned}</strong></div>
        <div className="pc-stat"><span>완료</span><strong>{summary.done}</strong></div>
        <div className={`pc-stat ${summary.cancelled ? "is-warning" : ""}`}><span>취소</span><strong>{summary.cancelled}</strong></div>
        <div className="pc-stat"><span>정원 합계</span><strong>{summary.capacity}</strong></div>
        <div className="pc-stat"><span>신청 합계</span><strong>{summary.registered}</strong></div>
        <div className="pc-stat"><span>참석 합계</span><strong>{summary.attended}</strong></div>
      </div>
      <p className="block-note">
        인원 합계는 취소한 회차를 빼고 셉니다. 회차를 지우지 않고 취소로 남겨 증빙·실적 이력을 지킵니다.
        {meta.startDate || meta.endDate ? ` 사업 기간 ${meta.startDate || "미정"} ~ ${meta.endDate || "미정"}.` : ""}
      </p>

      <div className="pc-toolbar">
        <button className="primary-button" type="button" onClick={() => setAdding((current) => !current)} aria-expanded={adding}>
          {adding ? "추가 접기" : "회차 추가"}
        </button>
      </div>

      {adding && (
        <section className="pc-add" aria-label="회차 추가">
          <div className="form-grid">
            <label className="field">
              <span>회차명</span>
              <input value={addDraft.title} placeholder="비우면 번호로 채웁니다" onChange={(event) => setAddDraft({ ...addDraft, title: event.target.value })} />
            </label>
            <label className="field">
              <span>일시</span>
              <input type="datetime-local" value={addDraft.startAt} onChange={(event) => setAddDraft({ ...addDraft, startAt: event.target.value })} />
            </label>
            <label className="field">
              <span>장소</span>
              <input value={addDraft.venue} onChange={(event) => setAddDraft({ ...addDraft, venue: event.target.value })} />
            </label>
            <label className="field">
              <span>정원</span>
              <input type="number" min={0} value={addDraft.capacity} onChange={(event) => setAddDraft({ ...addDraft, capacity: event.target.value })} />
            </label>
          </div>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={submitAdd}>추가</button>
            <button className="ghost-light-button" type="button" onClick={() => setAdding(false)}>취소</button>
          </div>
        </section>
      )}

      {editing && (
        <SessionEditForm
          key={editing.id}
          session={editing}
          onSave={(patch, reason) => saveSession(editing.id, patch, reason)}
          onClose={() => setEditingId("")}
        />
      )}

      {work.sessions.length === 0 ? (
        <div className="office-empty">
          <strong>아직 회차가 없습니다.</strong>
          <span>개요 탭에서 계획을 확정하면 회차가 만들어지고, 여기서 날짜·장소·강사·인원을 채웁니다.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stacked-table pc-session-table">
            <thead>
              <tr>
                <th>회차</th>
                <th>회차명</th>
                <th>일시</th>
                <th>장소</th>
                <th>강사</th>
                <th>정원</th>
                <th>신청</th>
                <th>참석</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {work.sessions.map((session) => (
                <tr key={session.id} className={session.status === "cancelled" ? "is-cancelled" : ""}>
                  <td data-label="회차">{session.sequence}</td>
                  <td data-label="회차명">
                    <button className="pc-task-title" type="button" onClick={() => setEditingId(session.id)}>{session.title}</button>
                  </td>
                  <td data-label="일시">{formatStartAt(session.startAt)}</td>
                  <td data-label="장소">{session.venue || "—"}</td>
                  <td data-label="강사">{session.instructorName || "—"}</td>
                  <td data-label="정원">{session.capacity || "—"}</td>
                  <td data-label="신청">{session.registered || "—"}</td>
                  <td data-label="참석">{session.attended || "—"}</td>
                  <td data-label="상태">
                    <span className={`pc-task-status is-session-${session.status}`}>{sessionStatusLabel(session.status)}</span>
                  </td>
                  <td data-label="관리">
                    {session.status === "cancelled" ? (
                      <button className="ghost-light-button" type="button" onClick={() => restore(session)}>되돌리기</button>
                    ) : (
                      <button className="ghost-light-button" type="button" onClick={() => cancel(session)}>취소</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
