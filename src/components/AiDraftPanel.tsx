import type { AiDraftResult, AiDraftRow } from "../lib/carryoverAiDraft.mjs";

/**
 * 3단계 ‘AI로 남은 칸·문구 초안 채우기’ 패널.
 * AI가 낸 제안은 여기서만 보여 주고, 체크한 칸만 양식 값으로 들어간다.
 */
export function AiDraftPanel({
  targetCount,
  providerLabel,
  busy,
  error,
  note,
  result,
  selected,
  onDraft,
  onToggle,
  onToggleAll,
  onEdit,
  onApply,
  onClear
}: {
  /** AI로 채울 수 있는 남은 칸 수 */
  targetCount: number;
  providerLabel: string;
  busy: boolean;
  error: string;
  note: string;
  result: AiDraftResult | null;
  selected: Set<string>;
  onDraft: () => void;
  onToggle: (fieldId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onEdit: (fieldId: string, value: string) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const rows: AiDraftRow[] = result?.rows || [];
  const selectedCount = rows.filter((row) => selected.has(row.fieldId)).length;

  return (
    <section className="ai-draft" aria-label="AI로 남은 칸 초안 채우기">
      <div className="ai-draft-head">
        <div>
          <strong>남은 칸은 AI 초안으로 채울 수 있습니다</strong>
          <small>
            {targetCount > 0
              ? `작년 값이 남았거나 비어 있는 칸 ${targetCount}개만 보냅니다. 사업명·기간·예산 같은 나머지 값은 보내지 않습니다.`
              : "지금은 보낼 남은 칸이 없습니다. 1~2단계를 마치면 여기에 나타납니다."}
            {" "}경로: {providerLabel}
          </small>
        </div>
        <button className="secondary-button" type="button" onClick={onDraft} disabled={busy || targetCount === 0}>
          {busy ? "초안 받는 중" : "AI로 남은 칸·문구 초안 채우기"}
        </button>
      </div>

      {error && <p className="pc-notice is-warning">{error}</p>}
      {note && <p className="material-result">{note}</p>}

      {rows.length > 0 && (
        <div className="ai-draft-review">
          <div className="ai-draft-review-head">
            <strong>받은 초안 {rows.length}개 — 확인한 칸만 양식에 들어갑니다</strong>
            <div className="ai-draft-review-actions">
              <button className="ghost-light-button" type="button" onClick={() => onToggleAll(true)}>모두 체크</button>
              <button className="ghost-light-button" type="button" onClick={() => onToggleAll(false)}>모두 해제</button>
              <button className="ghost-light-button" type="button" onClick={onClear}>초안 지우기</button>
            </div>
          </div>
          <ul className="ai-draft-rows">
            {rows.map((row) => {
              const checked = selected.has(row.fieldId);
              return (
                <li key={row.fieldId} className={`ai-draft-row ${checked ? "is-checked" : ""}`}>
                  <label className="ai-draft-check">
                    <input type="checkbox" checked={checked} onChange={(event) => onToggle(row.fieldId, event.target.checked)} />
                    <span>
                      <strong>{row.label || "칸"}</strong>
                      {row.sectionTitle && <small> {row.sectionTitle}</small>}
                      {row.previous && <small className="ai-draft-previous"> 이전 값: {row.previous}</small>}
                    </span>
                  </label>
                  <textarea
                    className="ai-draft-value"
                    rows={2}
                    value={row.value}
                    aria-label={`${row.label || "칸"} 초안 값`}
                    onChange={(event) => onEdit(row.fieldId, event.target.value)}
                  />
                  <div className="ai-draft-meta">
                    {row.reason && <small>{row.reason}</small>}
                    {row.yearRisk && (
                      <small className="ai-draft-risk">
                        {row.riskYears.length ? `${row.riskYears.join("·")}년` : "지난 연도"}이 들어 있습니다 — 올해 값인지 확인하세요
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={onApply} disabled={!selectedCount}>
              {selectedCount ? `체크한 ${selectedCount}칸 양식에 넣기` : "넣을 칸을 체크하세요"}
            </button>
            <span className="ai-draft-hint">넣은 뒤에도 아래 표에서 칸마다 고칠 수 있습니다. 초안은 AI 제안이므로 숫자·기관명을 꼭 확인하세요.</span>
          </div>
        </div>
      )}
    </section>
  );
}
