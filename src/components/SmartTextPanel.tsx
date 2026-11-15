import { useMemo } from "react";
import type { AssignmentRow, SmartMapResult } from "../lib/smartTextMapper.mjs";
import { summarizeSmartMap } from "../lib/smartTextMapper.mjs";
import type { FormField } from "../lib/kordocFormSpec.mjs";

const TYPE_LABEL: Record<string, string> = {
  text: "글",
  date: "날짜",
  amount: "금액·수량",
  phone: "전화",
  email: "메일",
  idnum: "번호",
  checkbox: "체크"
};

const SAMPLE_TEXT = `사업명: 양양 생활문화 혁신 지원사업
수행기관: 양양군농촌활성화지원센터
사업기간: 2027년 3월 ~ 11월
총사업비: 총 4,800만원 (국비 3,360, 군비 960, 자부담 480)

지역에 빈집이 120채 있고 청년이 계속 떠나고 있습니다.
목표: 청년 10명이 마을 콘텐츠를 기획해 수익을 만들 수 있게 합니다.`;

export function SmartTextPanel({
  fields,
  text,
  onTextChange,
  result,
  selected,
  busy,
  note,
  error,
  providerLabel,
  onMap,
  onApply,
  onToggle,
  onToggleAll,
  clear,
  onSendLeftoversToDraft,
  onLoadProjectData,
  projectDataNote,
  projectDataStale
}: {
  fields: FormField[];
  text: string;
  onTextChange: (value: string) => void;
  result: SmartMapResult | null;
  selected: Set<string>;
  busy: boolean;
  note: string;
  error: string;
  providerLabel: string;
  onMap: (mode: "auto" | "rule") => void;
  onApply: () => void;
  onToggle: (fieldId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  clear: () => void;
  onSendLeftoversToDraft: () => void;
  /** 이 사업에 적힌 계획·예산·회차·지출·결과보고를 이 칸에 한 번에 넣는다. */
  onLoadProjectData: () => void;
  /** 마지막으로 불러온 사업 데이터 설명(불러온 시각·항목 수·비어 있는 항목). */
  projectDataNote: string;
  /** 불러온 뒤 사업 데이터가 바뀌었는지 */
  projectDataStale: boolean;
}) {
  const summary = useMemo(() => summarizeSmartMap(result, selected), [result, selected]);
  const rows = result?.rows || [];
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.fieldId));
  const fillable = fields.filter((field) => field.empty).length;

  return (
    <section className="grant-block smart-text" aria-label="자유 텍스트로 칸 채우기">
      <div className="grant-block-head">
        <div>
          <strong>② 자료 붙여넣기</strong>
          <span>
            카톡·메모·회의록·기존 문서의 글을 통째로 붙여넣으면, 위 양식의 칸 {fields.length}개(번 칸 {fillable}개) 중
            알맞은 곳으로 나눠 넣습니다. 지금 실행 경로: {providerLabel}.
          </span>
        </div>
        <div className="draft-actions">
          <button className="primary-button" type="button" onClick={() => onMap("auto")} disabled={busy || !text.trim() || !fields.length}>
            {busy ? "나누는 중" : "자동으로 칸 나누기"}
          </button>
          <button className="secondary-button" type="button" onClick={() => onMap("rule")} disabled={busy || !text.trim() || !fields.length}>
            규칙만으로 나누기
          </button>
          {(text || result) && (
            <button className="ghost-light-button" type="button" onClick={clear}>지우기</button>
          )}
        </div>
      </div>

      <div className="smart-text-digest-row">
        <button className="secondary-button" type="button" onClick={onLoadProjectData}>
          {text.trim() ? "현재 사업 데이터 다시 불러오기" : "현재 사업 데이터 불러오기"}
        </button>
        <span>
          이 사업의 사업명·기관·기간·비목별 예산과 집행·회차·참석 인원·결과보고에 쓴 글을 아래 칸에 그대로 넣습니다.
          직접 쓴 글이 있으면 지우지 않고 뒤에 이어 붙이며, 빈 항목은 0으로 채우지 않고 비워 둡니다.
        </span>
      </div>

      {projectDataNote && (
        <p className={`smart-text-digest-note ${projectDataStale ? "is-stale" : ""}`} role="status">
          <span>{projectDataNote}</span>
          {projectDataStale && (
            <button className="ghost-light-button small" type="button" onClick={onLoadProjectData}>
              최신 값으로 다시 불러오기
            </button>
          )}
        </p>
      )}

      {!fields.length && (
        <p className="block-note">먼저 ①단계에서 양식을 읽어야 칸을 알 수 있습니다. 양식을 올리거나 연습 양식을 불러와 주세요.</p>
      )}

      <label className="field wide">
        <span>붙여넣을 글 (카톡·메모·회의록·기존 사업계획서)</span>
        <textarea
          rows={8}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder={SAMPLE_TEXT}
          aria-label="자유 텍스트 붙여넣기"
        />
      </label>
      <div className="smart-text-hint">
        <span>AI 없이도 “사업명: …”처럼 라벨이 붙은 줄, 날짜·금액·인원 같은 숫자, 칸 이름과 비슷한 낱말로 나눕니다.</span>
        {!text && (
          <button className="ghost-light-button small" type="button" onClick={() => onTextChange(SAMPLE_TEXT)}>
            예시 글 넣어 보기
          </button>
        )}
      </div>

      {note && <p className="office-execution-note" role="status">{note}</p>}
      {error && <div className="office-execution-note has-error" role="alert"><strong>자동 분류 실패</strong><span>{error}</span></div>}

      {result && (
        <div className="smart-text-result">
          <div className="smart-text-summary">
            <span className="template-badge is-ready">칸에 넣을 글 {summary.filling}개</span>
            {summary.conflicts > 0 && <span className="template-badge is-warn">이미 글이 있는 칸 {summary.conflicts}개</span>}
            {summary.leftovers > 0 && <span className="template-badge is-warn">배치 못한 글 {summary.leftovers}개</span>}
            <span className="smart-text-summary-note">
              체크한 칸만 채웁니다. 이미 글이 있는 칸은 체크하지 않으면 그대로 둡니다.
            </span>
          </div>

          <div className="draft-actions smart-text-actions">
            <label className="smart-text-check-all">
              <input type="checkbox" checked={allSelected} onChange={(event) => onToggleAll(event.target.checked)} />
              <span>모두 선택</span>
            </label>
            <button className="primary-button" type="button" onClick={onApply} disabled={!summary.filling}>
              선택한 {summary.filling}칸 채우기
            </button>
          </div>

          <ul className="smart-text-rows">
            {rows.map((row) => (
              <SmartTextRow
                key={row.fieldId}
                row={row}
                checked={selected.has(row.fieldId)}
                onToggle={(checked) => onToggle(row.fieldId, checked)}
              />
            ))}
            {!rows.length && <li className="template-empty-note">붙여넣은 글에서 칸에 넣을 만한 곳을 찾지 못했습니다. ‘라벨: 값’ 꼴로 적거나 아래 ‘배치 못한 글’을 직접 옮겨 주세요.</li>}
          </ul>

          {result.leftovers.length > 0 && (
            <details className="setup-details smart-text-leftovers">
              <summary>배치하지 못한 글 {result.leftovers.length}개</summary>
              <ul>
                {result.leftovers.slice(0, 12).map((item) => (
                  <li key={item.id}>
                    <span>{item.text}</span>
                    {item.reason && <small>{item.reason}</small>}
                  </li>
                ))}
              </ul>
              <button className="secondary-button" type="button" onClick={onSendLeftoversToDraft}>
                남은 글을 초안 조립으로 보내기
              </button>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function SmartTextRow({ row, checked, onToggle }: { row: AssignmentRow; checked: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <li className={`smart-text-row ${checked ? "is-checked" : ""} ${row.conflict ? "has-existing" : ""}`}>
      <label className="smart-text-row-check">
        <input type="checkbox" checked={checked} onChange={(event) => onToggle(event.target.checked)} />
        <span className="visually-hidden">{row.label} 칸에 넣기</span>
      </label>
      <div className="smart-text-row-body">
        <div className="smart-text-row-head">
          <strong>{row.label}</strong>
          <span className="template-slot-kind is-blank">{TYPE_LABEL[row.type] || "글"}</span>
          {row.source === "ai" && <span className="template-slot-kind">AI</span>}
          {row.merged && <span className="template-slot-kind">여러 곳에서 모음 · 확인 필요</span>}
          <small>{row.where}</small>
        </div>
        <p className="smart-text-row-value">{row.proposed}</p>
        {row.conflict && (
          <p className="smart-text-row-existing">
            지금 적힌 글: {row.current.slice(0, 80)}
            {row.current.length > 80 ? "…" : ""} · 체크하면 바뀝니다
          </p>
        )}
        {row.reasons.length > 0 && <small className="smart-text-row-reason">{row.reasons.slice(0, 2).join(" · ")}</small>}
      </div>
    </li>
  );
}
