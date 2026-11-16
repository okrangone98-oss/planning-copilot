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

/** 비어 있는 인원 칸은 '', 적힌 0은 '0'. 미입력과 0명을 화면에서도 구분한다. */
function countText(value: number | null) {
  return typeof value === "number" ? String(value) : "";
}

/** 인원 칸을 비우면 null(미입력), 숫자를 적으면 그 수. */
function countFrom(text: string) {
  const digits = String(text).replace(/[^\d]/g, "");
  return digits === "" ? null : Number(digits);
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
    trackAttendance: session.trackAttendance,
    capacity: countText(session.capacity),
    registered: countText(session.registered),
    attended: countText(session.attended),
    status: session.status as SessionStatusId,
    notes: session.notes
  });
  const [reason, setReason] = useState("");

  const submit = () => {
    const patch: Partial<ProjectSession> = {
      title: form.title,
      startAt: form.startAt,
      venue: form.venue,
      instructorName: form.instructorName,
      trackAttendance: form.trackAttendance,
      status: form.status,
      notes: form.notes
    };
    // 인원 기록을 끄면 이미 적어 둔 값은 건드리지 않는다(합계에서만 빠진다).
    if (form.trackAttendance) {
      patch.capacity = countFrom(form.capacity);
      patch.registered = countFrom(form.registered);
      patch.attended = countFrom(form.attended);
    }
    onSave(patch, reason);
  };

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
          <span>상태</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as SessionStatusId })}>
            {SESSION_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
          </select>
        </label>
        <label className="pc-check-inline wide">
          <input
            type="checkbox"
            checked={form.trackAttendance}
            onChange={(event) => setForm({ ...form, trackAttendance: event.target.checked })}
          />
          <span>이 회차는 인원(정원·신청·참석)을 기록합니다</span>
        </label>
        {form.trackAttendance ? (
          <>
            <label className="field">
              <span>정원</span>
              <input type="number" min={0} value={form.capacity} placeholder="미입력" onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
            </label>
            <label className="field">
              <span>신청</span>
              <input type="number" min={0} value={form.registered} placeholder="미입력" onChange={(event) => setForm({ ...form, registered: event.target.value })} />
            </label>
            <label className="field">
              <span>참석</span>
              <input type="number" min={0} value={form.attended} placeholder="미입력" onChange={(event) => setForm({ ...form, attended: event.target.value })} />
            </label>
          </>
        ) : (
          <p className="pc-field-note wide">
            인원 기록을 꺼 두었습니다. 예전에 적은 값은 지우지 않고 보관하며, 합계와 결과보고에서는 빠집니다.
          </p>
        )}
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
        <button className="primary-button" type="button" onClick={submit} disabled={!form.title.trim()}>
          저장
        </button>
        <button className="ghost-light-button" type="button" onClick={onClose}>닫기</button>
      </div>
    </section>
  );
}

/** 회차 탭: 1사업 여러 회차, 회차별 담당·강사·장소·인원(선택), 일부 취소. */
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
  const [addDraft, setAddDraft] = useState({ title: "", startAt: "", venue: "", trackAttendance: false, capacity: "" });

  const editing = work.sessions.find((session) => session.id === editingId) || null;

  const submitAdd = () => {
    const result = addSession(
      work,
      {
        title: addDraft.title.trim() || undefined,
        startAt: addDraft.startAt,
        venue: addDraft.venue,
        trackAttendance: addDraft.trackAttendance,
        capacity: addDraft.trackAttendance ? countFrom(addDraft.capacity) : null
      },
      new Date()
    );
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    setAdding(false);
    setAddDraft({ title: "", startAt: "", venue: "", trackAttendance: false, capacity: "" });
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

  const toggleTrack = (session: ProjectSession) => {
    const result = updateSession(
      work,
      session.id,
      { trackAttendance: !session.trackAttendance },
      { now: new Date(), reason: session.trackAttendance ? "인원 기록 끄기" : "인원 기록 켜기" }
    );
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(
      session.trackAttendance
        ? `${session.sequence}회차 인원 기록을 껐습니다. 적어 둔 값은 보관하고 합계에서만 뺍니다.`
        : `${session.sequence}회차 인원 기록을 켰습니다. 이제 정원·신청·참석을 적고 합계에 넣습니다.`
    );
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

  const missingText = summary.missing.attended
    ? ` · 참석 미입력 ${summary.missing.attended}회차`
    : "";

  return (
    <div className="pc-sessions">
      <div className="pc-stat-row" aria-label="회차 집계">
        <div className="pc-stat"><span>회차</span><strong>{summary.total}</strong></div>
        <div className="pc-stat"><span>진행 예정</span><strong>{summary.planned}</strong></div>
        <div className="pc-stat"><span>완료</span><strong>{summary.done}</strong></div>
        <div className={`pc-stat ${summary.cancelled ? "is-warning" : ""}`}><span>취소</span><strong>{summary.cancelled}</strong></div>
        <div className="pc-stat"><span>인원 기록</span><strong>{summary.tracked}</strong></div>
        <div className={`pc-stat ${summary.untracked ? "is-warning" : ""}`}><span>집계 제외</span><strong>{summary.untracked}</strong></div>
        <div className="pc-stat"><span>정원 합계</span><strong>{summary.capacity}</strong></div>
        <div className="pc-stat"><span>신청 합계</span><strong>{summary.registered}</strong></div>
        <div className="pc-stat"><span>참석 합계</span><strong>{summary.attended}</strong></div>
      </div>
      <p className="block-note">
        인원 합계는 취소한 회차와 인원 기록을 끈 회차를 빼고 셉니다. 기록을 꺼도 적어 둔 값은 지우지 않습니다.
        {summary.untracked ? ` 지금 ${summary.untracked}회차가 집계에서 빠져 있습니다.` : ""}
        {missingText}
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
            <label className="pc-check-inline wide">
              <input
                type="checkbox"
                checked={addDraft.trackAttendance}
                onChange={(event) => setAddDraft({ ...addDraft, trackAttendance: event.target.checked })}
              />
              <span>이 회차는 인원(정원·신청·참석)을 기록합니다</span>
            </label>
            {addDraft.trackAttendance && (
              <label className="field">
                <span>정원</span>
                <input type="number" min={0} value={addDraft.capacity} placeholder="미입력" onChange={(event) => setAddDraft({ ...addDraft, capacity: event.target.value })} />
              </label>
            )}
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
              {work.sessions.map((session) => {
                const excluded = session.status !== "cancelled" && !session.trackAttendance;
                return (
                  <tr key={session.id} className={session.status === "cancelled" ? "is-cancelled" : excluded ? "is-untracked" : ""}>
                    <td data-label="회차">{session.sequence}</td>
                    <td data-label="회차명">
                      <button className="pc-task-title" type="button" onClick={() => setEditingId(session.id)}>{session.title}</button>
                      {excluded && <small className="pc-cell-note">인원 기록 꺼짐 · 집계 제외</small>}
                    </td>
                    <td data-label="일시">{formatStartAt(session.startAt)}</td>
                    <td data-label="장소">{session.venue || "—"}</td>
                    <td data-label="강사">{session.instructorName || "—"}</td>
                    <td data-label="정원">{session.trackAttendance ? (session.capacity ?? "미입력") : "—"}</td>
                    <td data-label="신청">{session.trackAttendance ? (session.registered ?? "미입력") : "—"}</td>
                    <td data-label="참석">{session.trackAttendance ? (session.attended ?? "미입력") : "—"}</td>
                    <td data-label="상태">
                      <span className={`pc-task-status is-session-${session.status}`}>{sessionStatusLabel(session.status)}</span>
                    </td>
                    <td data-label="관리">
                      <div className="pc-row-actions">
                        <button className="ghost-light-button" type="button" onClick={() => toggleTrack(session)}>
                          {session.trackAttendance ? "인원 끄기" : "인원 켜기"}
                        </button>
                        {session.status === "cancelled" ? (
                          <button className="ghost-light-button" type="button" onClick={() => restore(session)}>되돌리기</button>
                        ) : (
                          <button className="ghost-light-button" type="button" onClick={() => cancel(session)}>취소</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
