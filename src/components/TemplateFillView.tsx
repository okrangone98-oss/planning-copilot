import { useMemo, useState } from "react";
import {
  HWP_BINARY_GUIDANCE,
  SAMPLE_ACCEPT,
  TEMPLATE_PROFILE_FIELDS,
  renderSchemaOutline,
  summarizeSchema,
  type TemplateProfile,
  type TemplateSchema
} from "../lib/sampleTemplateParser.mjs";
import {
  PLAN_SOURCE_ACCEPT,
  PLAN_SOURCE_HINT,
  type PlanSourceResult
} from "../lib/hwpxSourceExtractor.mjs";
import {
  CARRYOVER_MODE_HINT,
  CARRYOVER_LEFTOVER_LABEL,
  CARRYOVER_REPLACED_LABEL,
  type CarryoverDetection,
  type CarryoverLeftover
} from "../lib/yearCarryover.mjs";
import {
  MATERIALS_ACCEPT,
  MATERIALS_HINT,
  PHOTO_ACCEPT,
  PHOTO_HINT,
  type PhotoCaptions,
  type SpreadsheetMaterial
} from "../lib/reportMaterials.mjs";
import { AiDraftPanel } from "./AiDraftPanel";
import { HwpxExportPanel } from "./HwpxExportPanel";
import { SmartTextPanel } from "./SmartTextPanel";
import { KordocFillPanel } from "./KordocFillPanel";
import type { FormField } from "../lib/kordocFormSpec.mjs";
import { isLegalDocumentSchema } from "../lib/kordocFormSpec.mjs";
import type { SmartMapResult } from "../lib/smartTextMapper.mjs";
import type { AiDraftResult } from "../lib/carryoverAiDraft.mjs";
import { FIELD_TYPE_LABEL } from "../lib/smartTextMapper.mjs";

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

/** 일반 사용자의 주 작업 순서 — ① 양식을 불러오고 ② 자료를 붙여넣고 ③ 결과를 검토·수정한 뒤 ④ .hwpx로 내려받는다. */
const FLOW_STEPS = [
  { no: "①", title: "양식 불러오기", hint: "기관 양식 파일(.hwpx)" },
  { no: "②", title: "자료 붙여넣기", hint: "카톡·메모·기존 문서" },
  { no: "③", title: "검토·수정", hint: "칸별 값 확인" },
  { no: "④", title: "HWPX 다운로드", hint: "원본 서식 그대로" }
];

/** 출석·지출 표를 파일 없이 붙여넣는 작은 칸 */
function MaterialPasteBox({ onApply }: { onApply: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="template-paste-body">
      <TemplateField
        label="출석·지출 표 (붙여넣기)"
        value={text}
        onChange={setText}
        rows={6}
        wide
        placeholder={"일자 | 참석인원 | 활동\n2026-03-02 | 18 | 창업 기초 강좌\n--- 또는 ---\n적요 | 금액 | 비목\n강사비 이체 | 1,200,000 | 인건비"}
      />
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          if (!text.trim()) return;
          onApply(text);
          setText("");
        }}
      >
        붙여넣은 표 세어 넣기
      </button>
    </div>
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
  onClear,
  notify,
  piiGuard,
  practiceLoading,
  onLoadPractice,
  fields,
  fileBase64,
  smartText,
  onSmartTextChange,
  smartResult,
  smartSelected,
  smartBusy,
  smartNote,
  smartError,
  onSmartMap,
  onSmartApply,
  onSmartToggle,
  onSmartToggleAll,
  onSmartClear,
  onSmartLeftoversToDraft,
  fillValues,
  onFillValueChange,
  onLoadProjectData,
  projectDataNote,
  projectDataStale,
  planSource = null,
  planSourceBusy = false,
  onPickPlanSource,
  materialResult = null,
  materialFileName = "",
  onPickMaterialFile,
  onApplyMaterialText,
  photoCaptions = null,
  onPickPhotoFiles,
  carryoverDetection = null,
  carryoverEnabled = false,
  onCarryoverToggle,
  carryoverPlanCounts,
  carryoverLeftover,
  carryoverById = null,
  carryoverOverwrites = null,
  textRewrites = null,
  layout = "full",
  onLayoutChange,
  aiDraftTargets = [],
  aiDraftResult = null,
  aiDraftSelected = new Set<string>(),
  aiDraftBusy = false,
  aiDraftNote = "",
  aiDraftError = "",
  onAiDraft,
  onAiDraftToggle,
  onAiDraftToggleAll,
  onAiDraftEdit,
  onAiDraftApply,
  onAiDraftClear
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
  notify: (message: string) => void;
  piiGuard?: React.ReactNode;
  practiceLoading?: boolean;
  onLoadPractice: () => void;
  fields: FormField[];
  fileBase64: string;
  smartText: string;
  onSmartTextChange: (value: string) => void;
  smartResult: SmartMapResult | null;
  smartSelected: Set<string>;
  smartBusy: boolean;
  smartNote: string;
  smartError: string;
  onSmartMap: (mode: "auto" | "rule") => void;
  onSmartApply: () => void;
  onSmartToggle: (fieldId: string, checked: boolean) => void;
  onSmartToggleAll: (checked: boolean) => void;
  onSmartClear: () => void;
  onSmartLeftoversToDraft: () => void;
  fillValues: Record<string, string>;
  /** 3단계 검토 표에서 값을 고칠 때 — 칸 id 로 값을 바꾼다. */
  onFillValueChange: (fieldId: string, value: string) => void;
  /** 2단계에 이 사업의 데이터를 한 번에 넣는다. */
  onLoadProjectData: () => void;
  projectDataNote: string;
  projectDataStale: boolean;
  /** 올해 추진계획서(.hwpx) 재료 */
  planSource?: PlanSourceResult | null;
  planSourceBusy?: boolean;
  onPickPlanSource?: (file: File) => void;
  /** 출석·지출 자료(CSV/TSV·붙여넣기) */
  materialResult?: SpreadsheetMaterial | null;
  materialFileName?: string;
  onPickMaterialFile?: (file: File) => void;
  onApplyMaterialText?: (text: string, fileName?: string) => void;
  /** 활동사진 캡션 */
  photoCaptions?: PhotoCaptions | null;
  onPickPhotoFiles?: (files: FileList | null) => void;
  /** 전년도 양식 이양 */
  carryoverDetection?: CarryoverDetection | null;
  carryoverEnabled?: boolean;
  onCarryoverToggle?: (enabled: boolean) => void;
  carryoverPlanCounts?: { total: number; strong: number; weak: number };
  carryoverLeftover?: CarryoverLeftover | null;
  /** 양식 이양 배지·덮어쓰기 목록 — 3·4단계 패널로 넘긴다 */
  carryoverById?: Record<string, { status: string; label: string; previous: string; next: string; strength: string; reason: string }> | null;
  carryoverOverwrites?: Record<string, string[]> | null;
  /** 문서 제목처럼 라벨 없이 글자 전체를 갈아끼우는 칸 */
  textRewrites?: Array<{ from: string; to: string; label?: string; fieldId?: string }> | null;
  /** carryover = 작년 결과보고서 → 올해 것으로 바꾸기 3단계 화면 */
  layout?: "full" | "carryover";
  onLayoutChange?: (layout: "full" | "carryover") => void;
  /** 3단계 AI 초안 — 남은 칸 목록·결과·선택은 앱(App)이 들고, 화면은 보여 주기만 한다. */
  aiDraftTargets?: Array<{ fieldId: string }>;
  aiDraftResult?: AiDraftResult | null;
  aiDraftSelected?: Set<string>;
  aiDraftBusy?: boolean;
  aiDraftNote?: string;
  aiDraftError?: string;
  onAiDraft?: () => void;
  onAiDraftToggle?: (fieldId: string, checked: boolean) => void;
  onAiDraftToggleAll?: (checked: boolean) => void;
  onAiDraftEdit?: (fieldId: string, value: string) => void;
  onAiDraftApply?: () => void;
  onAiDraftClear?: () => void;
}) {
  const [pasteText, setPasteText] = useState("");
  const [showStructure, setShowStructure] = useState(false);
  const summary = summarizeSchema(schema);
  const ready = Boolean(schema && (summary.sections || summary.tables || summary.slots));
  const filledCount = Object.values(fillValues).filter((value) => String(value ?? "").trim()).length;
  /** 2단계 자동 배치로 들어간 값 — 검토 표의 ‘자동 채움’ 표시에 쓴다. */
  const autoFieldIds = useMemo(() => {
    const rows = smartResult?.rows || [];
    return new Set(
      rows
        .filter((row) => smartSelected.has(row.fieldId))
        .filter((row) => String(fillValues[row.fieldId] ?? "").trim() === String(row.proposed ?? "").trim())
        .map((row) => row.fieldId)
    );
  }, [smartResult, smartSelected, fillValues]);
  /** 점수가 낮거나 여러 곳의 글이 모인 칸 — 사람이 봐야 하므로 ‘확인 필요’로 표시한다. */
  const lowConfidenceIds = useMemo(
    () => new Set(
      (smartResult?.rows || [])
        .filter((row) => Number(row.score) < 0.6 || row.merged === true)
        .map((row) => row.fieldId)
    ),
    [smartResult]
  );

  /* ── 3단계 간단 화면 — 작년 결과보고서 → 올해 것으로 바꾸기 ───────── */
  if (layout === "carryover") {
    const carryoverCounts = carryoverPlanCounts || { total: 0, strong: 0, weak: 0 };
    const replaced = Object.values(carryoverById || {}).filter((item) => item.status === "replaced").length;
    const leftoverCount = carryoverLeftover?.counts?.total || 0;
    const step2Ready = Boolean(planSource?.ok || materialResult?.line || smartText.trim());
    return (
      <div className="carryover-flow">
        <header className="carryover-flow-head">
          <h2>3단계만 하면 됩니다</h2>
          <button className="ghost-light-button" type="button" onClick={() => onLayoutChange?.("full")}>
            전체 화면 보기
          </button>
        </header>

        <ol className="carryover-steps" aria-label="작업 순서">
          <li className={schema ? "is-done" : "is-todo"}>
            <span aria-hidden="true">{schema ? "✓" : "1"}</span>
            <strong>작년 결과보고서 올리기</strong>
            <small title={schema?.fileName || ""}>
              {schema
                ? (schema.fileName || "읽음").length > 20
                  ? `${(schema.fileName || "읽음").slice(0, 18)}…`
                  : schema.fileName || "읽음"
                : ".hwpx 파일"}
            </small>
          </li>
          <li className={step2Ready ? "is-done" : schema ? "is-todo" : ""}>
            <span aria-hidden="true">{step2Ready ? "✓" : "2"}</span>
            <strong>올해 자료 넣기</strong>
            <small>{step2Ready ? "계획서·자료 넣음" : "계획서 · 정산 · 메모"}</small>
          </li>
          <li className={filledCount ? "is-done" : step2Ready ? "is-todo" : ""}>
            <span aria-hidden="true">{filledCount ? "✓" : "3"}</span>
            <strong>바뀐 항목 확인 · 내려받기</strong>
            <small>{filledCount ? `${filledCount}칸 바꿈` : ".hwpx 받기"}</small>
          </li>
        </ol>

        <section className={`carryover-step ${schema ? "is-done" : ""}`} aria-label="1단계 작년 결과보고서 올리기">
          <div className="carryover-step-head">
            <span className="carryover-step-no">1</span>
            <div>
              <strong>작년 결과보고서(.hwpx)를 올려 주세요</strong>
              <small>작년에 낸 결과보고서 파일 그대로입니다. 표가 아니라 문단에 적힌 사업명·기간·실적도 읽습니다.</small>
            </div>
          </div>
          <div className="file-drop">
            <label className="file-pick">
              {schema ? "다른 파일로 바꾸기" : "작년 결과보고서 선택"}
              <input
                type="file"
                accept={SAMPLE_ACCEPT}
                aria-label="작년 결과보고서 파일 올리기"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onPickFile(file);
                  event.currentTarget.value = "";
                }}
              />
            </label>
            <span className="file-name">{schema?.fileName ? `읽은 파일: ${schema.fileName}` : "아직 고른 파일이 없습니다"}</span>
            {schema && (
              <button className="ghost-light-button" type="button" onClick={onClear}>읽은 양식 지우기</button>
            )}
          </div>
          {schema && (
            <p className="carryover-status" role="status">
              <strong>{schema.title || "작년 결과보고서"}</strong>
              <span>
                칸 {fields.length}개(본문 {fields.filter((field) => field.origin === "text").length}개)를 읽었습니다.
                {carryoverDetection?.reason ? ` ${carryoverDetection.reason}` : ""}
              </span>
              {carryoverEnabled && carryoverCounts.total > 0 && (
                <span className="carryover-counts">
                  이양 대상 <strong>{carryoverCounts.total}칸</strong>
                  {carryoverDetection?.sourceYear ? ` · ${carryoverDetection.sourceYear}년 값` : ""}
                  {leftoverCount ? ` · 아직 그대로 ${leftoverCount}칸` : ""}
                </span>
              )}
            </p>
          )}
          {schema && onCarryoverToggle && (
            <label className="carryover-toggle is-compact">
              <input
                type="checkbox"
                checked={carryoverEnabled}
                onChange={(event) => onCarryoverToggle(event.target.checked)}
              />
              <span>
                <strong>작년 값을 올해 것으로 갈아끼우기</strong>
                <small>{CARRYOVER_MODE_HINT}</small>
              </span>
            </label>
          )}
          {!schema && (
            <div className="practice-template-row">
              <button className="secondary-button" type="button" onClick={onLoadPractice} disabled={practiceLoading}>
                {practiceLoading ? "연습 양식 불러오는 중" : "올릴 파일이 없으면 연습 양식으로 해 보기"}
              </button>
            </div>
          )}
        </section>

        {schema && (
          <section className="carryover-step" aria-label="2단계 올해 자료 넣기">
            <div className="carryover-step-head">
              <span className="carryover-step-no">2</span>
              <div>
                <strong>올해 자료를 넣어 주세요</strong>
                <small>세 가지 중 있는 것만 넣으면 됩니다. 올린 자료는 이 브라우저 안에서만 읽습니다.</small>
              </div>
            </div>
            <div className="material-rows">
              <div className="material-row">
                <div className="material-row-head">
                  <strong>올해 추진계획서 (.hwpx)</strong>
                  <label className="file-pick">
                    {planSourceBusy ? "읽는 중" : "계획서 파일 선택"}
                    <input
                      type="file"
                      accept={PLAN_SOURCE_ACCEPT}
                      disabled={planSourceBusy}
                      aria-label="올해 추진계획서 올리기"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onPickPlanSource?.(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <small>사업명·기간·예산·일정을 읽습니다. 결재란·주소·연락처와 뒤에 붙은 계약서·동의서는 빼고 읽습니다.</small>
                {planSource?.ok && (
                  <p className="material-result" role="status">
                    <span className="template-badge is-ready">항목 {planSource.counts.total}줄</span>
                    사업명·기간·예산·일정을 넣었습니다
                    {planSource.counts.appendix ? " (붙임 서식 제외)" : ""}
                    <small className="material-note">계획서 숫자는 계획값입니다 — 실적(참석 인원·집행액)은 정산 자료 값을 씁니다.</small>
                  </p>
                )}
                {planSource?.notes?.length ? (
                  <ul className="template-warnings">
                    {planSource.notes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                ) : null}
              </div>

              <div className="material-row">
                <div className="material-row-head">
                  <strong>정산 엑셀·출석 자료 (CSV)</strong>
                  <label className="file-pick">
                    자료 파일 선택
                    <input
                      type="file"
                      accept={MATERIALS_ACCEPT}
                      aria-label="정산·출석 자료 올리기"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onPickMaterialFile?.(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <small>엑셀에서 ‘CSV로 저장’한 파일을 올리면 참석 인원·집행액을 세어 넣습니다.</small>
                {materialResult?.line && (
                  <p className="material-result" role="status">
                    <span className="template-badge is-ready">{materialResult.kind === "attendance" ? "출석" : "지출"} {materialResult.rows}행</span>
                    {materialResult.line}
                  </p>
                )}
                {onApplyMaterialText && (
                  <details className="setup-details material-paste">
                    <summary>파일 없이 표를 붙여넣기</summary>
                    <MaterialPasteBox onApply={(text) => onApplyMaterialText(text, "붙여넣은 표")} />
                  </details>
                )}
              </div>
            </div>

            <SmartTextPanel
              fields={fields}
              text={smartText}
              onTextChange={onSmartTextChange}
              result={smartResult}
              selected={smartSelected}
              busy={smartBusy}
              note={smartNote}
              error={smartError}
              providerLabel={providerLabel}
              onMap={onSmartMap}
              onApply={onSmartApply}
              onToggle={onSmartToggle}
              onToggleAll={onSmartToggleAll}
              clear={onSmartClear}
              onSendLeftoversToDraft={onSmartLeftoversToDraft}
              onLoadProjectData={onLoadProjectData}
              projectDataNote={projectDataNote}
              projectDataStale={projectDataStale}
              compact
            />
          </section>
        )}

        {schema && (
          <section className="carryover-step" aria-label="3단계 검토와 내려받기">
            <div className="carryover-step-head">
              <span className="carryover-step-no">3</span>
              <div>
                <strong>바뀐 항목만 확인하고 .hwpx를 내려받으세요</strong>
                <small>
                  {replaced
                    ? `${replaced}칸이 올해 값으로 바뀌었습니다.`
                    : "아직 바뀐 칸이 없습니다 — 2단계 자료를 넣으면 자동으로 채워집니다."}
                  {leftoverCount ? ` ${leftoverCount}칸은 작년 값이 남아 있어 표시해 두었습니다.` : ""}
                </small>
              </div>
            </div>
            {onAiDraft && (
              <AiDraftPanel
                targetCount={aiDraftTargets.length}
                providerLabel={providerLabel}
                busy={aiDraftBusy}
                error={aiDraftError}
                note={aiDraftNote}
                result={aiDraftResult}
                selected={aiDraftSelected}
                onDraft={onAiDraft}
                onToggle={(fieldId, checked) => onAiDraftToggle?.(fieldId, checked)}
                onToggleAll={(checked) => onAiDraftToggleAll?.(checked)}
                onEdit={(fieldId, value) => onAiDraftEdit?.(fieldId, value)}
                onApply={() => onAiDraftApply?.()}
                onClear={() => onAiDraftClear?.()}
              />
            )}
            <KordocFillPanel
              compact
              fields={fields}
              values={fillValues}
              fileName={schema.fileName}
              fileBase64={fileBase64}
              markdown={result}
              notify={notify}
              onValueChange={onFillValueChange}
              autoFieldIds={autoFieldIds}
              lowConfidenceIds={lowConfidenceIds}
              leftovers={smartResult?.leftovers || []}
              schema={schema}
              carryoverById={carryoverEnabled ? carryoverById : null}
              carryoverOverwrites={carryoverEnabled ? carryoverOverwrites : null}
              carryoverPreflight={carryoverEnabled && carryoverLeftover ? { leftover: carryoverLeftover } : null}
              textRewrites={textRewrites}
            />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="template-layout">
      <ol className="template-flow-steps" aria-label="작업 순서">
        {FLOW_STEPS.map((step) => (
          <li key={step.title} className={step.title === "검토·수정" && !filledCount ? "is-todo" : ""}>
            <strong>{step.no} {step.title}</strong>
            <span>{step.hint}</span>
          </li>
        ))}
      </ol>

      <section className="coach-bar" aria-label="1단계 양식 불러오기">
        <div>
          <strong>① 양식 불러오기</strong>
          <span>
            사업계획서·청구서·계약서 같은 기관 양식 파일을 올리면 목차, 표의 열과 행, 빈칸·작성 항목을 먼저 읽어 보여 줍니다.
            읽는 일은 브라우저 안에서만 하고, 원본 파일은 고치지 않습니다.
          </span>
        </div>
        <div className="draft-actions">
          {schema && (
            <button className="ghost-light-button" type="button" onClick={onClear}>읽은 양식 지우기</button>
          )}
        </div>
      </section>

      <div className="file-drop">
        <span>양식 파일</span>
        <div className="draft-actions">
          <label className="file-pick">
            양식 파일 선택
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
          </label>
          <span className="file-name">{schema?.fileName ? `읽은 파일: ${schema.fileName}` : "아직 고른 파일이 없습니다"}</span>
        </div>
        <small title={HWP_BINARY_GUIDANCE}>
          HWPX · DOCX · PDF · MD · TXT · CSV를 읽습니다. 구형 .hwp는 한글에서 HWPX·DOCX·PDF로 저장해 올려 주세요.
        </small>
        <div className="practice-template-row is-primary-path">
          <button className="secondary-button" type="button" onClick={onLoadPractice} disabled={practiceLoading}>
            {practiceLoading ? "연습 양식 불러오는 중" : "처음이면 여기부터 — 연습 양식 불러오기"}
          </button>
          <span>올릴 양식이 없어도 기관 표준 사업계획서 연습 양식(예시)으로 ①→④단계를 그대로 따라 해 볼 수 있습니다. 실제로 낼 때는 공고에서 받은 양식으로 바꿔 주세요.</span>
        </div>
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
      </div>

      {schema && (
        <section className="template-summary" aria-label="읽은 양식 요약">
          <div className="template-summary-head">
            <div>
              <strong>{summary.title || "샘플 양식"}</strong>
              <span>
                {schema.fileName || "붙여넣은 양식"} · 섹션 {summary.sections}개 · 표 {summary.tables}개 · 작성 항목 {summary.slots}개 · 표 빈칸 {summary.emptyCells}개
                {fields.length ? ` · 넣을 수 있는 칸 ${fields.length}개` : ""}
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
        <details
          className="setup-details template-structure"
          open={showStructure}
          onToggle={(event) => setShowStructure((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>읽은 양식 구조 보기 — 목차 {summary.sections}개 · 표 {summary.tables}개 · 칸 {fields.length}개</summary>
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

          {fields.length > 0 && (
            <details className="setup-details template-field-details">
              <summary>이 양식의 칸 {fields.length}개 — 무엇을 넣는 자리인지</summary>
              <ul className="template-field-list">
                {fields.slice(0, 60).map((field, index) => {
                  // 같은 구역의 안내문은 구역마다 한 번만 보여 준다 — 칸마다 되풀이하면 읽기 어렵다.
                  const previous = index > 0 ? fields[index - 1] : null;
                  const firstOfSection = !previous || previous.sectionTitle !== field.sectionTitle || previous.hint !== field.hint;
                  return (
                    <li key={field.id}>
                      <span className="template-field-label">{field.label}</span>
                      <span className="template-slot-kind is-blank">{FIELD_TYPE_LABEL[field.type] || "글"}</span>
                      <span className="template-field-where">{field.sectionTitle || field.context}</span>
                      {field.hint && firstOfSection && <small>{field.hint}</small>}
                      {!field.empty && field.value && <small className="template-field-filled">지금 적힌 값: {field.value.slice(0, 60)}</small>}
                    </li>
                  );
                })}
                {fields.length > 60 && <li className="template-more">… {fields.length - 60}개 더 있음</li>}
              </ul>
            </details>
          )}

          {schema.tables.length > 0 && (
            <div className="template-tables">
              <h4>표 {summary.tables}개</h4>
              {schema.tables.slice(0, 6).map((table) => (
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
                        {table.rows.slice(0, 8).map((row, rowIndex) => (
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
                  {table.rowCount > 8 && <p className="template-empty-note">… {table.rowCount - 8}행 더 있음</p>}
                </div>
              ))}
              {schema.tables.length > 6 && <p className="template-empty-note">… 표 {schema.tables.length - 6}개 더 있음</p>}
            </div>
          )}
        </details>
      )}

      {schema && fields.length === 0 && (
        <section className={`doc-empty-form ${isLegalDocumentSchema(schema) ? "is-legal" : ""}`} aria-label="채울 칸이 없는 문서 안내">
          <strong>
            {isLegalDocumentSchema(schema)
              ? "법령·조례 본문으로 보입니다 — 채울 칸이 없는 것이 정상입니다"
              : "이 양식에서 값을 넣을 칸을 찾지 못했습니다"}
          </strong>
          <p>
            {isLegalDocumentSchema(schema)
              ? `‘${schema.title || schema.fileName || "이 문서"}’는 조문만 있는 법령·조례라 신청서처럼 채울 칸이 없습니다. 이 문서는 공고 해석·근거 확인에 쓰고, 실제로 채울 때는 사업계획서·신청서 양식을 올려 주세요.`
              : "읽은 구조에 ‘라벨 | 빈칸’ 표나 ‘라벨: ___’ 자리가 없습니다. 글자만 있는 문서이거나, 칸 이름과 값이 붙어 있는 양식일 수 있습니다. 한글에서 양식의 칸 구조를 확인하거나 다른 양식을 올려 주세요."}
          </p>
        </section>
      )}

      {schema && carryoverDetection && (carryoverDetection.suggested || carryoverEnabled) && (
        <section className={`carryover-bar ${carryoverEnabled ? "is-on" : ""}`} aria-label="전년도 양식 이양">
          <label className="carryover-toggle">
            <input
              type="checkbox"
              checked={carryoverEnabled}
              onChange={(event) => onCarryoverToggle?.(event.target.checked)}
            />
            <span>
              <strong>전년도 양식 이양</strong>
              <small>{CARRYOVER_MODE_HINT}</small>
            </span>
          </label>
          <p className="carryover-reason">{carryoverDetection.reason}</p>
          {carryoverEnabled && Boolean(carryoverPlanCounts?.total) && (
            <p className="carryover-counts" role="status">
              이양 대상 칸 <strong>{carryoverPlanCounts?.total ?? 0}개</strong>
              {carryoverLeftover?.counts?.total ? (
                <span className="template-badge is-warn">{CARRYOVER_LEFTOVER_LABEL} {carryoverLeftover.counts.total}개</span>
              ) : (
                <span className="template-badge is-ready">올해 값 준비</span>
              )}
            </p>
          )}
        </section>
      )}

      {schema && (
        <SmartTextPanel
          fields={fields}
          text={smartText}
          onTextChange={onSmartTextChange}
          result={smartResult}
          selected={smartSelected}
          busy={smartBusy}
          note={smartNote}
          error={smartError}
          providerLabel={providerLabel}
          onMap={onSmartMap}
          onApply={onSmartApply}
          onToggle={onSmartToggle}
          onToggleAll={onSmartToggleAll}
          clear={onSmartClear}
          onSendLeftoversToDraft={onSmartLeftoversToDraft}
          onLoadProjectData={onLoadProjectData}
          projectDataNote={projectDataNote}
          projectDataStale={projectDataStale}
        />
      )}

      {schema && (
        <section className="grant-block report-materials" aria-label="결과보고 재료 파일">
          <div className="grant-block-head">
            <div>
              <strong>재료 파일 — 계획서 · 출석·지출 · 활동사진</strong>
              <span>올해 자료를 파일으로 올리면 2단계 글 뒤에 자동으로 이어 붙입니다. 직접 쓴 글은 지우지 않습니다.</span>
            </div>
          </div>
          <div className="material-rows">
            <div className="material-row">
              <div className="material-row-head">
                <strong>올해 추진계획서 (.hwpx)</strong>
                <label className="file-pick">
                  {planSourceBusy ? "읽는 중" : "계획서 파일 선택"}
                  <input
                    type="file"
                    accept={PLAN_SOURCE_ACCEPT}
                    disabled={planSourceBusy}
                    aria-label="올해 추진계획서 올리기"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onPickPlanSource?.(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <small>{PLAN_SOURCE_HINT}</small>
              {planSource && planSource.ok && (
                <p className="material-result" role="status">
                  <span className="template-badge is-ready">항목 {planSource.counts.total}줄</span>
                  라벨 {planSource.counts.labels} · 예산 {planSource.counts.budgetLines} · 일정 {planSource.counts.scheduleLines} · 본문 {planSource.counts.paragraphs}
                  {planSource.counts.truncated ? " · 길어서 앞부분만 넣음" : ""}
                  <small className="material-note">계획서의 숫자는 계획값입니다 — 실적 칸(참석 인원·집행액)은 출석·지출 자료의 값을 쓰세요.</small>
                </p>
              )}
            </div>

            <div className="material-row">
              <div className="material-row-head">
                <strong>출석현황 · 지출내역 (CSV/TSV)</strong>
                <label className="file-pick">
                  자료 파일 선택
                  <input
                    type="file"
                    accept={MATERIALS_ACCEPT}
                    aria-label="출석·지출 자료 올리기"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) onPickMaterialFile?.(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <small>{MATERIALS_HINT}</small>
              {materialResult?.line && (
                <p className="material-result" role="status">
                  <span className="template-badge is-ready">{materialResult.kind === "attendance" ? "출석" : "지출"} {materialResult.rows}행</span>
                  {materialResult.line}
                  {materialFileName ? <small>읽은 파일: {materialFileName}</small> : null}
                </p>
              )}
              {onApplyMaterialText && (
                <details className="setup-details material-paste">
                  <summary>파일 없이 표를 붙여넣기</summary>
                  <MaterialPasteBox onApply={(text) => onApplyMaterialText(text, "붙여넣은 표")} />
                </details>
              )}
            </div>

            <div className="material-row">
              <div className="material-row-head">
                <strong>활동사진 (캡션 만들기)</strong>
                <label className="file-pick">
                  사진 파일 선택
                  <input
                    type="file"
                    accept={PHOTO_ACCEPT}
                    multiple
                    aria-label="활동사진 올리기"
                    onChange={(event) => {
                      onPickPhotoFiles?.(event.target.files);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
              </div>
              <small>{PHOTO_HINT}</small>
              {photoCaptions && photoCaptions.lines.length > 0 && (
                <div className="material-result">
                  <p role="status">
                    <span className="template-badge is-ready">캡션 {photoCaptions.lines.length}줄</span>
                    2단계 글에 넣었습니다. 사진 파일 자체는 내려받은 문서를 한글에서 열어 넣어 주세요.
                  </p>
                  <ul className="photo-caption-list">
                    {photoCaptions.lines.slice(0, 12).map((line) => (
                      <li key={line.fileName}>
                        <span className="photo-caption-date">{line.date || "날짜 미확인"}</span>
                        <span className="photo-caption-title">{line.title || "활동 사진"}</span>
                        <small>{line.fileName}</small>
                      </li>
                    ))}
                    {photoCaptions.lines.length > 12 && <li className="template-more">… {photoCaptions.lines.length - 12}개 더 있음</li>}
                  </ul>
                  {photoCaptions.warnings.length > 0 && (
                    <ul className="template-warnings">
                      {photoCaptions.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {schema && filledCount > 0 && (
        <p className="pc-notice is-success" role="status">
          2단계에서 <strong>{filledCount}칸</strong>을 채웠습니다. 아래 3단계에서 칸별 값을 확인하고, 잘못 들어간 값은 그 자리에서 고쳐 주세요.
        </p>
      )}

      {schema && (
        <KordocFillPanel
          fields={fields}
          values={fillValues}
          fileName={schema.fileName}
          fileBase64={fileBase64}
          markdown={result}
          notify={notify}
          onValueChange={onFillValueChange}
          autoFieldIds={autoFieldIds}
          lowConfidenceIds={lowConfidenceIds}
          leftovers={smartResult?.leftovers || []}
          schema={schema}
          carryoverById={carryoverEnabled ? carryoverById : null}
          carryoverOverwrites={carryoverEnabled ? carryoverOverwrites : null}
          textRewrites={textRewrites}
          carryoverPreflight={carryoverEnabled && carryoverLeftover ? { leftover: carryoverLeftover } : null}
        />
      )}

      {schema && (
        <details className="setup-details template-advanced">
          <summary>고급 설정 — AI 초안·사업 정보·프롬프트·JSON (개발자·반복 작업용)</summary>
          <p className="block-note">
            위 4단계만으로 .hwpx를 만들 수 있습니다. 여기는 AI가 문장까지 써 주는 초안 경로, 사업 정보 직접 입력,
            프롬프트 복사처럼 반복 작업이나 개발자용 기능을 모아 둔 곳입니다.
          </p>

          <section className="grant-block" aria-label="내 사업 정보">
            <div className="grant-block-head">
              <div>
                <strong>사업 정보 직접 입력</strong>
                <span>AI 초안을 만들 때 쓰는 값입니다. 비워 두면 결과에 ‘확인 필요’로 남습니다.</span>
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

          <section className="grant-block" aria-label="양식에 맞춰 채우기">
            <div className="grant-block-head">
              <div>
                <strong>AI로 양식 초안 쓰기</strong>
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
            {piiGuard}
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

          {result && (
            <section className="grant-block" aria-label="양식에 맞춘 결과">
              <div className="grant-block-head">
                <div>
                  <strong>AI 초안 결과 (원본 목차·표 구조 유지)</strong>
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
              <HwpxExportPanel
                markdown={result}
                fileName={(schema?.fileName || "양식-초안").replace(/\.[^.]+$/, "")}
                notify={notify}
              />
            </section>
          )}
        </details>
      )}

      {!schema && (
        <div className="office-empty template-first-visit">
          <strong>아직 읽은 양식이 없습니다.</strong>
          <span>위 ①단계에서 양식 파일을 올리거나 양식 내용을 붙여넣으면 목차·표·작성 항목을 바로 보여 줍니다.</span>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={onLoadPractice} disabled={practiceLoading}>
              {practiceLoading ? "연습 양식 불러오는 중" : "연습 양식 불러와서 4단계 따라 해 보기"}
            </button>
            <span className="template-first-visit-note">실제 양식이 없어도 연습 양식으로 ① 양식 불러오기 → ② 자료 붙여넣기 → ③ 검토·수정 → ④ .hwpx 다운로드까지 그대로 해 볼 수 있습니다.</span>
          </div>
        </div>
      )}
    </div>
  );
}
