import type { ChangeLogEntry } from "../lib/projectOperations.mjs";

const ENTITY_LABEL: Record<string, string> = {
  meta: "사업 정보",
  task: "업무",
  session: "회차",
  budget: "예산",
  plan: "계획"
};

function formatChangedAt(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 계획·예산·일정 변경의 전후 값과 사유를 보여 준다. */
export function ProjectChangeLogView({
  changes,
  limit = 20,
  title = "변경 이력",
  emptyText = "아직 기록된 변경이 없습니다. 사업 정보·업무·회차·예산을 고치면 여기에 전후 값과 사유가 남습니다."
}: {
  changes: ChangeLogEntry[];
  limit?: number;
  title?: string;
  emptyText?: string;
}) {
  const shown = (Array.isArray(changes) ? changes : []).slice(0, limit);
  return (
    <section className="pc-changelog" aria-label={title}>
      <div className="block-head">
        <h3>{title}</h3>
        <span className="block-count">{(changes || []).length}건</span>
      </div>
      {shown.length === 0 ? (
        <p className="block-note">{emptyText}</p>
      ) : (
        <ul className="pc-changelog-list">
          {shown.map((entry) => (
            <li key={entry.id} className="pc-changelog-item">
              <span className="pc-changelog-when">{formatChangedAt(entry.changedAt)}</span>
              <span className="pc-changelog-body">
                <strong>
                  {ENTITY_LABEL[entry.entityType] || entry.entityType} · {entry.field}
                </strong>
                <span className="pc-changelog-values">
                  <em>{entry.before || "빈 값"}</em>
                  <span aria-hidden="true">→</span>
                  <em>{entry.after || "빈 값"}</em>
                </span>
                {entry.reason && <small>사유: {entry.reason}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
