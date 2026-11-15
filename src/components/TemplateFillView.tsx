import { useState } from "react";
import {
  HWP_BINARY_GUIDANCE,
  SAMPLE_ACCEPT,
  TEMPLATE_PROFILE_FIELDS,
  renderSchemaOutline,
  summarizeSchema,
  type TemplateProfile,
  type TemplateSchema
} from "../lib/sampleTemplateParser.mjs";

const KIND_LABEL: Record<string, string> = {
  blank: "빈칸",
  label: "라벨",
  item: "작성 항목",
  guide: "작성 요령",
  "table-cell": "표 빈칸"
};

function TemplateField({
  label,
  value,
  onChange,
  placeholder = "",
  rows = 4,
  wide = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function TemplateFillView({
  schema,
  profile,
  result,
  busy,
  error,
  providerLabel,
  modelNote,
  onProfileChange,
  onPickFile,
  onParsePaste,
  onUseProjectValues,
  onFill,
  onResultChange,
  onCopyResult,
  onCopyPrompt,
  onDownload,
  onSendToDraft,
  onExportWorkbrain,
  onAddToApproval,
  onOpenModelSettings,
  onClear
}: {
  schema: TemplateSchema | null;
  profile: TemplateProfile;
  result: string;
  busy: boolean;
  error: string;
  providerLabel: string;
  modelNote: string;
  onProfileChange: (patch: Partial<TemplateProfile>) => void;
  onPickFile: (file: File) => void;
  onParsePaste: (text: string) => void;
  onUseProjectValues: () => void;
  onFill: (mode: "ai" | "rule") => void;
  onResultChange: (value: string) => void;
  onCopyResult: () => void;
  onCopyPrompt: () => void;
  onDownload: () => void;
  onSendToDraft: () => void;
  onExportWorkbrain: () => void;
  onAddToApproval: () => void;
  onOpenModelSettings: () => void;
  onClear: () => void;
}) {
  const [pasteText, setPasteText] = useState("");
  const [showTables, setShowTables] = useState(true);
  const summary = summarizeSchema(schema);
  const ready = Boolean(schema && (summary.sections || summary.tables || summary.slots));

  return (
    <div className="template-layout">
      <section className="coach-bar">
        <div>
          <strong>샘플 양식 1 · 올리기</strong>
          <span>
            사업계획서·공고 양식 파일을 올리면 목차, 표의 열과 행, 빈칸·작성 항목을 먼저 읽어 보여 줍니다. 읽는 일은 브라우저 안에서만 합니다.
          </span>
        </div>
        <div className="draft-actions">
          {schema && (
            <button className="ghost-light-button" type="button" onClick={onClear}>읽은 양식 지우기</button>
          )}
        </div>
      </section>

      <label className="file-drop">
        <span>샘플 양식 파일</span>
        <input
          type="file"
          accept={SAMPLE_ACCEPT}
          aria-label="샘플 양식 파일 올리기"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onPickFile(file);
            event.currentTarget.value = "";
          }}
        />
        <small title={HWP_BINARY_GUIDANCE}>
          HWPX · DOCX · PDF · MD · TXT · CSV를 읽습니다. 구형 .hwp는 한글에서 HWPX·DOCX·PDF로 저장해 올려 주세요.
        </small>
      </label>

      <details className="setup-details template-paste">
        <summary>파일 없이 양식 내용을 붙여넣기</summary>
        <div className="template-paste-body">
          <TemplateField
            label="양식 텍스트(붙여넣기)"
            value={pasteText}
            onChange={setPasteText}
            rows={10}
            wide
            placeholder={"Ⅰ. 사업 개요\n1. 추진 배경\n○ (작성 요령) ...\n\n| 구분 | 사업명 | 내용 |\n| --- | --- | --- |"}
          />
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              if (!pasteText.trim()) return;
              onParsePaste(pasteText);
              setPasteText("");
            }}
          >
            붙여넣은 내용 구조 분석
          </button>
        </div>
      </details>

      {schema && (
        <section className="template-summary" aria-label="읽은 양식 요약">
          <div className="template-summary-head">
            <div>
              <strong>{summary.title || "샘플 양식"}</strong>
              <span>
                {schema.fileName || "붙여넣은 양식"} · 섹션 {summary.sections}개 · 표 {summary.tables}개 · 작성 항목 {summary.slots}개 · 표 빈칸 {summary.emptyCells}개
              </span>
            </div>
            <span className={`template-badge is-${ready ? "ready" : "warn"}`}>{ready ? "구조 읽음" : "구조 없음"}</span>
          </div>
          {schema.warnings.length > 0 && (
            <ul className="template-warnings">
              {schema.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </section>
      )}

      {schema && (
        <section className="grant-block" aria-label="양식 구조 미리보기">
          <div className="grant-block-head">
            <div>
              <strong>2 · 구조 미리보기</strong>
              <span>AI가 이 목차와 표 구조를 그대로 지킵니다. 빈칸은 채울 자리로 표시됩니다.</span>
            </div>
            <div className="draft-actions">
              <button className="secondary-button" type="button" onClick={() => setShowTables((current) => !current)}>
                {showTables ? "표 접기" : "표 펼치기"}
              </button>
            </div>
          </div>

          <div className="template-preview-grid">
            <div className="template-preview-block">
              <h4>목차 · 섹션 {summary.sections}개</h4>
              {schema.sections.length ? (
                <ol className="template-outline">
                  {schema.sections.map((section) => (
                    <li key={section.id} style={{ marginLeft: `${(section.level - 1) * 14}px` }} data-level={section.level}>
                      <span className="template-level-dot" aria-hidden="true" />
                      {section.title}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="template-empty-note">제목을 찾지 못했습니다. 양식에 ‘1.’, ‘가.’ 같은 번호가 있으면 목차로 읽습니다.</p>
              )}
            </div>

            <div className="template-preview-block">
              <h4>작성 항목 {summary.slots}개</h4>
              {schema.slots.length ? (
                <ul className="template-slot-list">
                  {schema.slots.slice(0, 60).map((slot) => (
                    <li key={slot.id}>
                      <span className={`template-slot-kind is-${slot.kind}`}>{KIND_LABEL[slot.kind] || slot.kind}</span>
                      <span className="template-slot-label">{slot.label}</span>
                      {slot.sectionTitle && <small>{slot.sectionTitle}</small>}
                    </li>
                  ))}
                  {schema.slots.length > 60 && <li className="template-more">… {schema.slots.length - 60}개 더 있음</li>}
                </ul>
              ) : (
                <p className="template-empty-note">빈칸·작성 항목을 찾지 못했습니다. 빈칸(___), ( ), ‘작성 요령’ 표시가 있는 양식에서 잘 동작합니다.</p>
              )}
            </div>
          </div>

          {showTables && schema.tables.length > 0 && (
            <div className="template-tables">
              <h4>표 {summary.tables}개</h4>
              {schema.tables.map((table) => (
                <div className="template-table-card" key={table.id}>
                  <div className="template-table-head">
                    <strong>{table.caption}</strong>
                    <span>{table.headers.length}열 × {table.rowCount}행 · 빈칸 {table.emptyCells}</span>
                  </div>
                  <div className="table-wrap">
                    <table className="template-table stacked-table">
                      <thead>
                        <tr>{table.headers.map((header, index) => <th key={`${table.id}-${index}`}>{header}</th>)}</tr>
                      </thead>
                      <tbody>
                        {table.rows.slice(0, 12).map((row, rowIndex) => (
                          <tr key={`${table.id}-r${rowIndex}`}>
                            {table.headers.map((header, column) => {
                              const value = String(row[column] ?? "").trim();
                              return (
                                <td key={`${table.id}-r${rowIndex}-c${column}`} data-label={header}>
                                  {value || <span className="template-blank">빈칸</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {table.rowCount > 12 && <p className="template-empty-note">… {table.rowCount - 12}행 더 있음</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {schema && (
        <section className="grant-block" aria-label="내 사업 정보">
          <div className="grant-block-head">
            <div>
              <strong>3 · 내 사업 정보</strong>
              <span>여기에 적은 값으로 양식을 채웁니다. 비워 두면 결과에 ‘확인 필요’로 남습니다.</span>
            </div>
            <div className="draft-actions">
              <button className="secondary-button" type="button" onClick={onUseProjectValues}>프로젝트 입력값 가져오기</button>
            </div>
          </div>
          <div className="form-grid">
            {TEMPLATE_PROFILE_FIELDS.map((field) => (
              <TemplateField
                key={field.key}
                label={field.label}
                value={profile[field.key]}
                onChange={(value) => onProfileChange({ [field.key]: value })}
                placeholder={field.placeholder}
                rows={field.key === "summary" || field.key === "notes" ? 5 : 2}
                wide={field.key === "projectName" || field.key === "summary" || field.key === "notes"}
              />
            ))}
          </div>
        </section>
      )}

      {schema && (
        <section className="grant-block" aria-label="양식에 맞춰 채우기">
          <div className="grant-block-head">
            <div>
              <strong>4 · 이 양식에 맞춰 채우기</strong>
              <span>현재 실행 경로: {providerLabel}. AI가 실패하면 규칙 기반 초안과 프롬프트 복사로 이어집니다.</span>
            </div>
            <div className="draft-actions">
              <button className="primary-button" type="button" onClick={() => onFill("ai")} disabled={busy}>
                {busy ? "채우는 중" : "이 양식에 맞춰 채우기"}
              </button>
              <button className="secondary-button" type="button" onClick={() => onFill("rule")} disabled={busy}>규칙 기반으로 채우기</button>
              <button className="ghost-light-button" type="button" onClick={onCopyPrompt}>프롬프트 복사</button>
            </div>
          </div>
          <div className="model-status-bar">
            <strong>입력 자료는 이 브라우저 안에서 정리됩니다</strong>
            <span>{modelNote}</span>
          </div>
          {error && (
            <div className="office-execution-note has-error" role="alert">
              <strong>AI 채우기 실패</strong>
              <span>{error}</span>
              <div className="draft-actions">
                <button className="secondary-button" type="button" onClick={() => onFill("rule")}>규칙 기반 초안 만들기</button>
                <button className="secondary-button" type="button" onClick={onCopyPrompt}>프롬프트 복사</button>
                <button className="ghost-light-button" type="button" onClick={onOpenModelSettings}>모델 설정 열기</button>
              </div>
            </div>
          )}
          <details className="setup-details template-outline-details">
            <summary>AI에 보내는 양식 구조 미리보기</summary>
            <textarea className="draft-output" rows={14} readOnly value={renderSchemaOutline(schema)} />
          </details>
        </section>
      )}

      {result && (
        <section className="grant-block" aria-label="양식에 맞춘 결과">
          <div className="grant-block-head">
            <div>
              <strong>5 · 결과 (원본 목차·표 구조 유지)</strong>
              <span>검토 전 초안입니다. 기관명·예산·일정·수치는 원본 자료와 대조한 뒤 사용하세요.</span>
            </div>
            <div className="draft-actions">
              <button className="secondary-button" type="button" onClick={onCopyResult}>복사</button>
              <button className="secondary-button" type="button" onClick={onDownload}>.md 받기</button>
              <button className="secondary-button" type="button" onClick={onExportWorkbrain}>워크브레인 내보내기</button>
              <button className="secondary-button" type="button" onClick={onAddToApproval}>승인함에 추가</button>
              <button className="ghost-light-button" type="button" onClick={onSendToDraft}>초안 조립으로</button>
            </div>
          </div>
          <textarea
            className="draft-output template-result"
            rows={26}
            value={result}
            aria-label="양식에 맞춰 채운 결과"
            onChange={(event) => onResultChange(event.target.value)}
          />
        </section>
      )}

      {!schema && (
        <div className="office-empty">
          <strong>아직 읽은 양식이 없습니다.</strong>
          <span>위에서 샘플 양식 파일을 올리거나 양식 내용을 붙여넣으면 목차·표·작성 항목을 바로 보여 줍니다.</span>
        </div>
      )}
    </div>
  );
}
