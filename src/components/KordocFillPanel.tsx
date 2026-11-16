import { useEffect, useMemo, useRef, useState } from "react";
import { downloadTextFile, loadHwpxBridgeEndpoint, safeFileName, saveHwpxBridgeEndpoint } from "../lib/storage";
import { interpretBridgeResponse } from "../lib/hwpxBridge.mjs";
import {
  KORDOC_FILL_CONTRACT,
  buildKordocFillCommand,
  buildKordocFillPayload,
  buildKordocFillValues,
  buildKordocPatchCommand,
  kordocFillJsonText,
  type FormField
} from "../lib/kordocFormSpec.mjs";
import {
  PREFLIGHT_LEVEL_LABEL,
  buildDownloadPreflight,
  classifyFields,
  explainDownloadFailure,
  preflightSummaryLine
} from "../lib/downloadPreflight.mjs";
import type { DownloadPreflight, PreflightItem } from "../lib/downloadPreflight.mjs";
import type { TemplateSchema } from "../lib/sampleTemplateParser.mjs";
import {
  filledFileName,
  patchHwpxBytes,
  summarizeFill,
  type FilledEntry,
  type HwpxPatchResult,
  type SkippedEntry
} from "../lib/browserHwpxFiller.mjs";
import {
  CARRYOVER_LEFTOVER_LABEL,
  CARRYOVER_REPLACED_LABEL,
  type CarryoverLeftover,
  type CarryoverPlan
} from "../lib/yearCarryover.mjs";
import { AutoGrowTextarea } from "./AutoGrowTextarea";

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBlob(bytes: Uint8Array) {
  // Blob 은 ArrayBuffer 를 요구한다 — 넘겨받은 뷰와 무관한 사본을 만들어 넘긴다.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/hwp+zip" });
}

function base64ToBlob(base64: string) {
  return bytesToBlob(base64ToBytes(base64));
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(bytesToBlob(bytes));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** 빈칸 목록에 붙는 형식 힌트 — 칸 성격을 모르면 붙이지 않는다. */
const TYPE_HINT: Record<string, string> = {
  date: "날짜 — 예: 2026-03-02",
  amount: "숫자 — 예: 1,200,000원 / 12명",
  phone: "전화 — 예: 010-1234-5678",
  email: "메일 — 예: name@example.com",
  idnum: "숫자 13자리",
  checkbox: "표시 — 예: ☑"
};

export function KordocFillPanel({
  fields,
  values,
  fileName,
  fileBase64,
  markdown,
  notify,
  onValueChange,
  autoFieldIds,
  lowConfidenceIds,
  leftovers = [],
  schema = null,
  carryoverById = null,
  carryoverOverwrites = null,
  carryoverPreflight = null,
  textRewrites = null,
  compact = false
}: {
  fields: FormField[];
  values: Record<string, string>;
  fileName: string;
  fileBase64: string;
  markdown: string;
  notify: (message: string) => void;
  /** 3단계 검토 표에서 값을 직접 고칠 때 — 칸 id 로 값을 바꾼다. */
  onValueChange?: (fieldId: string, value: string) => void;
  /** 2단계 자동 배치로 들어온 칸 — 검토 표에서 ‘자동 채움’으로 표시한다. */
  autoFieldIds?: Set<string>;
  /** 자동 배치 점수가 낮아 사람이 봐야 하는 칸 — ‘확인 필요’로 표시한다. */
  lowConfidenceIds?: Set<string>;
  /** 2단계에서 칸에 넣지 못한 글 — 사전 점검에 올린다. */
  leftovers?: Array<{ id?: string; text?: string }>;
  /** 병합 칸·양식 제목처럼 양식 자체를 봐야 하는 점검에 쓴다. */
  schema?: TemplateSchema | null;
  /** 양식 이양 — 칸마다 붙일 전년도 값 배지(교체·잔존) */
  carryoverById?: Record<string, { status: string; label: string; previous: string; next: string; strength: string; reason: string }> | null;
  /** 양식 이양 — 이 칸의 작년 값은 같은 글자면 갈아끼워도 된다(라벨 키 → 이전 글자들) */
  carryoverOverwrites?: Record<string, string[]> | null;
  /** 문서 제목처럼 라벨 없이 글자 전체를 갈아끼우는 칸 */
  textRewrites?: Array<{ from: string; to: string; label?: string; fieldId?: string }> | null;
  /** 사전 점검에 넘길 이양 정보(잔존 점검) */
  carryoverPreflight?: { plan?: CarryoverPlan | null; leftover?: CarryoverLeftover | null } | null;
  /** 3단계 간단 화면 — 값 표와 내려받기만 남기고 개발자용 설정을 접어 둔다 */
  compact?: boolean;
}) {
  const [endpoint, setEndpoint] = useState(() => loadHwpxBridgeEndpoint());
  const [busy, setBusy] = useState<"" | "fill" | "patch" | "browser">("");
  const [bridgeNote, setBridgeNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [browserNote, setBrowserNote] = useState<{ tone: "ok" | "error" | "info" | "warn"; text: string } | null>(null);
  const [browserResult, setBrowserResult] = useState<HwpxPatchResult | null>(null);
  /** 사전 점검에서 막는 항목이 있을 때, 한 번 더 눌러 확인했는지. */
  const [gateArmed, setGateArmed] = useState(false);
  const preflightRef = useRef<HTMLElement | null>(null);

  const fill = useMemo(() => buildKordocFillValues({ fields, values }), [fields, values]);
  const jsonText = useMemo(() => kordocFillJsonText(fill.values), [fill.values]);
  const baseName = useMemo(() => String(fileName || "양식").replace(/\.(hwpx|hwp)$/i, ""), [fileName]);
  const command = useMemo(() => buildKordocFillCommand({ templateFile: fileName, valuesFile: `${baseName}-채움값.json` }), [fileName, baseName]);
  const editedFile = useMemo(() => `${baseName}-채운문서.md`, [baseName]);
  const patchCommand = useMemo(() => buildKordocPatchCommand({ templateFile: fileName, editedFile }), [fileName, editedFile]);
  const count = fill.entries.length;
  const uniqueKeys = Object.keys(fill.values).length;
  const hasFile = Boolean(fileBase64) && /\.(hwpx|hwp)$/i.test(fileName || "");
  const canPatch = Boolean(markdown.trim()) && hasFile;
  const downloadName = filledFileName(fileName);
  const editable = typeof onValueChange === "function";

  const classified = useMemo(
    () => classifyFields({ fields, values, autoFieldIds, lowConfidenceIds }),
    [fields, values, autoFieldIds, lowConfidenceIds]
  );
  const statusById = useMemo(() => new Map(classified.map((row) => [row.fieldId, row])), [classified]);
  const statusCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = { auto: 0, manual: 0, check: 0, required: 0, blank: 0, original: 0 };
    for (const row of classified) counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, [classified]);

  /** 값이 비어 있는 칸 — 필수 표시가 있는 칸부터 보여 준다. */
  const blankRows = useMemo(() => {
    const blanks = classified.filter((row) => row.status === "blank" || row.status === "required" || row.status === "original");
    return [...blanks].sort((a, b) => {
      const rank = (row: typeof a) => (row.status === "required" ? 0 : row.status === "blank" ? 1 : 2);
      return rank(a) - rank(b);
    });
  }, [classified]);

  const preflight = useMemo<DownloadPreflight>(
    () =>
      buildDownloadPreflight({
        fields,
        values,
        autoFieldIds,
        lowConfidenceIds,
        leftovers,
        schema,
        title: schema?.title || fileName || "",
        hasFile,
        carryover: carryoverPreflight
      }),
    [fields, values, autoFieldIds, lowConfidenceIds, leftovers, schema, fileName, hasFile, carryoverPreflight]
  );
  const blockIds = useMemo(() => preflight.items.filter((item) => item.level === "block").map((item) => item.id).join(","), [preflight]);

  // 값이나 양식이 바뀌면 이전에 누른 ‘확인’은 취소한다 — 바뀐 내용을 확인하지 않은 채 넘어가지 않게.
  useEffect(() => {
    setGateArmed(false);
  }, [blockIds]);

  /** 브라우저 안에서 양식 .hwpx를 채워 바로 내려받는다 — 터미널·브릿지 없이. */
  const downloadInBrowser = async () => {
    if (!hasFile) {
      setBrowserNote({ tone: "error", text: "채울 .hwpx 양식 파일이 없습니다. ①단계에서 양식 파일을 올리거나 연습 양식을 불러와 주세요." });
      return;
    }
    if (!count) {
      setBrowserNote({ tone: "error", text: "아직 넣을 값이 없습니다. ②단계에서 자료를 붙여넣거나 위 표·빈칸 목록에 값을 적어 주세요." });
      return;
    }
    // 막는 항목이 있으면 한 번은 사전 점검을 보여 주고 멈춘다. 두 번째 누르면 그대로 내려받는다.
    if (!preflight.canDownload && !gateArmed) {
      setGateArmed(true);
      const first = preflight.items.find((item) => item.level === "block");
      setBrowserNote({
        tone: "warn",
        text: `${preflight.gateMessage}${first?.detail ? ` (${first.detail})` : ""}`
      });
      preflightRef.current?.scrollIntoView({ block: "nearest" });
      return;
    }
    setBusy("browser");
    setBrowserNote({ tone: "info", text: "브라우저에서 양식 서식을 그대로 두고 값을 넣는 중입니다." });
    try {
      const result = await patchHwpxBytes({
        bytes: base64ToBytes(fileBase64),
        values: fill.values,
        overwrites: carryoverOverwrites || undefined,
        rewrites: textRewrites && textRewrites.length ? textRewrites : undefined
      });
      setBrowserResult(result);
      if (!result.filled.length) {
        setBrowserNote({
          tone: "error",
          text: "값이 들어갈 칸을 양식 안에서 찾지 못했습니다. 아래 표의 ‘들어갈 자리’를 보고 칸 이름을 양식과 같게 맞춰 주세요. 적은 값은 그대로 남아 있습니다."
        });
        return;
      }
      downloadBytes(result.bytes, downloadName);
      const summary = summarizeFill(result);
      const checkLine = preflightSummaryLine(preflight);
      setBrowserNote({ tone: "ok", text: `${summary} ${downloadName} 파일을 내려받았습니다.${checkLine ? ` (${checkLine})` : ""}` });
      notify(`${summary} ${downloadName} 파일을 내려받았습니다. 한글에서 열어 서식을 확인하세요.`);
    } catch (error) {
      const explained = explainDownloadFailure(error);
      setBrowserNote({
        tone: "error",
        text: `${explained.title}${explained.detail ? ` — ${explained.detail}` : ""} ${explained.fix}`
      });
    } finally {
      setBusy("");
    }
  };

  const copyJson = () => {
    if (!count) {
      notify("아직 채울 값이 없습니다. 자료를 붙여넣거나 위 표에 값을 적어 주세요.");
      return;
    }
    navigator.clipboard.writeText(jsonText).then(
      () => notify("kordoc 채움값 JSON을 복사했습니다. 값 파일로 저장해 kordoc fill -j 에 넘기세요."),
      () => notify("복사하지 못했습니다. 아래 JSON을 직접 선택해 복사해 주세요.")
    );
  };

  const copyCommand = (text: string, label: string) => {
    if (!text) {
      notify(`${label} 명령을 만들 수 없습니다. 양식 파일(.hwpx)을 올려 주세요.`);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => notify(`${label} 명령을 복사했습니다. 터미널에 붙여넣으세요.`),
      () => notify("복사하지 못했습니다. 명령을 직접 선택해 복사해 주세요.")
    );
  };

  const downloadJson = () => {
    if (!count) return;
    downloadTextFile(jsonText, safeFileName(`${baseName}-채움값.json`, "채움값.json"), "application/json;charset=utf-8");
    notify("채움값 JSON을 내려받았습니다. 양식 파일 옆에 두고 kordoc fill -j 로 넘겨 주세요.");
  };

  const sendThroughBridge = async (mode: "fill" | "patch") => {
    const target = endpoint.trim();
    if (!target) {
      setBridgeNote({ tone: "error", text: "브릿지 주소를 먼저 넣어 주세요. 예: http://127.0.0.1:8787/kordoc" });
      return;
    }
    const payload = buildKordocFillPayload({
      fileName,
      fileBase64,
      values: fill.values,
      mode,
      markdown,
      outputName: `${baseName}${mode === "patch" ? "-반영" : "-채움"}.hwpx`
    });
    if (!payload) {
      setBridgeNote({
        tone: "error",
        text: mode === "patch"
          ? "patch 로 보낼 채운 문서(.md)가 없습니다. 먼저 고급 설정에서 ‘이 양식에 맞춰 채우기’로 결과를 만들어 주세요."
          : "브릿지로 채우려면 양식 파일(.hwpx)을 올렸거나 연습 양식을 불러온 상태여야 합니다."
      });
      return;
    }
    setBusy(mode);
    setBridgeNote({ tone: "info", text: "브릿지에 채우기를 요청했습니다. 잠시 기다려 주세요." });
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      const result = interpretBridgeResponse(response.status, body);
      if (!result.ok) {
        setBridgeNote({ tone: "error", text: result.message });
        return;
      }
      if (result.base64) {
        const url = URL.createObjectURL(base64ToBlob(result.base64));
        const link = document.createElement("a");
        link.href = url;
        link.download = result.fileName || `${baseName}-채움.hwpx`;
        link.click();
        URL.revokeObjectURL(url);
        setBridgeNote({ tone: "ok", text: `${result.message} 파일을 내려받았습니다.` });
        notify(mode === "patch" ? "채운 문서를 원본 서식에 반영해 .hwpx로 받았습니다." : "값을 채운 .hwpx를 받았습니다.");
        return;
      }
      setBridgeNote({ tone: "info", text: result.message });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setBridgeNote({
        tone: "error",
        text: `브릿지에 연결하지 못했습니다: ${reason}. 아래 명령을 내 컴퓨터에서 실행해 주세요.`
      });
    } finally {
      setBusy("");
    }
  };

  const renderStatus = (status: string, label: string) => (
    <span className={`fill-status is-${status}`}>{label}</span>
  );

  const renderItem = (item: PreflightItem) => (
    <li key={item.id} className={`preflight-item is-${item.level}`}>
      <div className="preflight-item-head">
        <span className={`fill-status is-${item.level}`}>{PREFLIGHT_LEVEL_LABEL[item.level]}</span>
        <strong>{item.title}</strong>
      </div>
      {item.detail && <p className="preflight-item-detail">{item.detail}</p>}
      {item.fix && <p className="preflight-item-fix">{item.fix}</p>}
    </li>
  );

  return (
    <>
      <section className="hwpx-block kordoc-fill" aria-label="입력 결과 검토">
        <div className="hwpx-head">
          <div>
            <h3>{compact ? "3 · 바뀐 항목 확인" : "3 · 입력 결과 검토(수정)"}</h3>
            <p>
              {compact
                ? "올해 자료로 바꿀 값만 모았습니다. 칸 이름 옆에 바뀐 항목·그대로 둔 항목이 표시되고, 값은 그 자리에서 고칠 수 있습니다."
                : "양식의 어느 칸에 무슨 값이 들어가는지 확인하는 표입니다. 칸이 잘못 잡혔으면 넣을 값을 직접 고치거나 지워 주세요. 고친 값은 이 브라우저에 저장되어 4단계 다운로드에 그대로 쓰이고, 원본 양식에서 이미 값이 있는 칸은 덮어쓰지 않습니다."}
            </p>
          </div>
          <span className="badge is-info">저장됨 · 브라우저 안</span>
        </div>

        {!compact && <div className="kordoc-fill-stats">
          <span className="template-badge is-ready">넣을 값 {count}개</span>
          <span>kordoc fill 키 {uniqueKeys}개</span>
          {fill.unmapped.length > 0 && <span className="kordoc-fill-muted">비어 있는 칸 {fill.unmapped.length}개</span>}
          {!hasFile && <span className="kordoc-fill-muted">양식 파일(.hwpx)이 없어 다운로드는 안 됩니다</span>}
        </div>}

        {!compact && <div className="fill-status-legend" aria-label="칸 상태 요약">
          {renderStatus("auto", `자동 채움 ${statusCounts.auto}`)}
          {renderStatus("manual", `직접 적은 값 ${statusCounts.manual}`)}
          {renderStatus("check", `확인 필요 ${statusCounts.check}`)}
          {renderStatus("blank", `빈칸 ${statusCounts.blank}`)}
          {renderStatus("required", `빈칸·필수 ${statusCounts.required}`)}
          {statusCounts.original > 0 && renderStatus("original", `원본 유지 ${statusCounts.original}`)}
        </div>}

        {fill.warnings.length > 0 && (
          <ul className="template-warnings">
            {fill.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {count > 0 ? (
          <div className="table-wrap">
            <table className="template-table stacked-table kordoc-fill-table">
              <thead>
                <tr><th>칸</th><th>넣을 값{editable ? " (고칠 수 있음)" : ""}</th><th>상태</th><th>들어갈 자리</th></tr>
              </thead>
              <tbody>
                {fill.entries.slice(0, 60).map((entry, index) => {
                  const row = entry.fieldId ? statusById.get(entry.fieldId) : undefined;
                  const status = row?.status ?? "manual";
                  const label = row?.statusLabel ?? "값 있음";
                  const note = row?.note && status === "check" ? row.note : "";
                  const carry = entry.fieldId ? carryoverById?.[entry.fieldId] : undefined;
                  return (
                    <tr key={`${entry.key}-${entry.fieldId ?? index}-${index}`} className={status === "check" ? "is-check" : ""}>
                      <td data-label="칸">
                        {entry.label}
                        {carry && (
                          <span className={`fill-status is-${carry.status === "replaced" ? "auto" : "check"} carryover-badge`}>
                            {carry.status === "replaced" ? CARRYOVER_REPLACED_LABEL : CARRYOVER_LEFTOVER_LABEL}
                          </span>
                        )}
                      </td>
                      <td data-label="넣을 값">
                        {editable && entry.fieldId ? (
                          <div className="fill-value-cell">
                            <AutoGrowTextarea
                              className="kordoc-fill-input"
                              value={values[entry.fieldId] ?? String(entry.value ?? "")}
                              ariaLabel={`${entry.label} 칸에 넣을 값`}
                              onChange={(next) => onValueChange(entry.fieldId as string, next)}
                            />
                            {note && <span className="fill-value-note is-warn">{note}</span>}
                            {String(values[entry.fieldId] ?? "").trim() && (
                              <button
                                className="ghost-light-button small fill-clear"
                                type="button"
                                onClick={() => onValueChange(entry.fieldId as string, "")}
                                aria-label={`${entry.label} 칸 값을 비우기`}
                              >
                                비우기
                              </button>
                            )}
                          </div>
                        ) : (
                          Array.isArray(entry.value) ? entry.value.join(" / ") : entry.value
                        )}
                      </td>
                      <td data-label="상태">{renderStatus(status, label)}</td>
                      <td data-label="들어갈 자리">{entry.where}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {fill.entries.length > 60 && <p className="template-empty-note">… {fill.entries.length - 60}개 더 있음</p>}
          </div>
        ) : (
          <p className="block-note">
            아직 넣을 값이 없습니다. 2단계에서 자료를 붙여넣고 <strong>자동으로 칸 나누기</strong>를 누르거나, 아래 빈칸 목록에 직접 적으면 여기에 모입니다.
          </p>
        )}

        {blankRows.length > 0 && (
          <details className="setup-details fill-blank-panel" open={count === 0}>
            <summary>
              {compact ? `빈칸 ${blankRows.length}개 — 필요하면 여기에 직접 적기` : `아직 비어 있는 칸 ${blankRows.length}개 — 여기에 바로 적을 수 있습니다`}
              {statusCounts.required > 0 ? ` (필수 표시 ${statusCounts.required}개 포함)` : ""}
            </summary>
            <p className="block-note">
              빈칸은 양식에 아무것도 넣지 않고 그대로 둡니다. 여기에 적으면 3단계 표와 4단계 다운로드에 함께 들어갑니다.
              원본에 이미 값이 있는 칸은 덮어쓰지 않으니, 바꿔야 하면 한글에서 직접 고쳐 주세요.
            </p>
            <ul className="fill-blank-list">
              {blankRows.slice(0, 40).map((row) => (
                <li key={row.fieldId} className={row.status === "required" ? "is-required" : ""}>
                  <div className="fill-blank-head">
                    <strong>{row.label}</strong>
                    {renderStatus(row.status, row.statusLabel)}
                    <small>{row.sectionTitle}</small>
                    {TYPE_HINT[row.type] && <small className="fill-blank-type">{TYPE_HINT[row.type]}</small>}
                  </div>
                  {row.status === "original" ? (
                    carryoverById?.[row.fieldId] ? (
                      // 양식 이양 — 전년도 값이 적힌 칸은 여기에 바로 올해 값을 적어 갈아끼울 수 있다.
                      <>
                        <p className="fill-blank-original">전년도 값: {carryoverById[row.fieldId].previous || row.originalValue.slice(0, 80)}</p>
                        <AutoGrowTextarea
                          className="kordoc-fill-input"
                          value={values[row.fieldId] ?? ""}
                          ariaLabel={`${row.label} 칸에 넣을 올해 값`}
                          placeholder="올해 값을 적으면 내려받을 때 이 자리를 갈아끼웁니다"
                          onChange={(next) => onValueChange?.(row.fieldId, next)}
                        />
                      </>
                    ) : (
                      <p className="fill-blank-original">지금 적힌 값: {row.originalValue.slice(0, 80)}</p>
                    )
                  ) : editable ? (
                    <AutoGrowTextarea
                      className="kordoc-fill-input"
                      value={values[row.fieldId] ?? ""}
                      ariaLabel={`${row.label} 칸에 넣을 값`}
                      placeholder={TYPE_HINT[row.type] || "이 칸에 들어갈 내용"}
                      onChange={(next) => onValueChange(row.fieldId, next)}
                    />
                  ) : (
                    <p className="fill-blank-original">아직 비어 있습니다.</p>
                  )}
                </li>
              ))}
            </ul>
            {blankRows.length > 40 && <p className="template-empty-note">… {blankRows.length - 40}개 더 있음 (표에서 칸 이름으로 찾아 주세요)</p>}
          </details>
        )}

        <p className="block-note">
          고친 값은 이 브라우저에 자동으로 저장됩니다 — 새로고침하거나 창을 닫아도 이어서 할 수 있습니다.
          값을 모두 지운 칸은 양식에 쓰지 않고, 원본에 이미 적힌 칸은 채우지 않고 그대로 둡니다.
        </p>
      </section>

      <section className="hwpx-block kordoc-fill" aria-label="다운로드 전 사전 점검" ref={preflightRef}>
        <div className="hwpx-head">
          <div>
            <h3>{compact ? "내려받기 전 확인" : "다운로드 전 사전 점검"}</h3>
            <p>
              {compact
                ? "작년 값이 남은 칸과 값 형식만 봅니다. 표시가 있어도 그대로 내려받을 수 있고, 고칠 곳만 위 표에서 고치면 됩니다."
                : "내려받기 전에 필수값 누락·형식 오류·미배치 글·예산 합계·출석을 한 번에 봅니다. 앱이 확정할 수 없는 항목(병합 칸 위치, 원본 값 유지, 자동 배치 신뢰도)은 ‘직접 확인’으로 따로 표시합니다."}
            </p>
          </div>
          <span className={`badge ${preflight.canDownload ? "is-info" : "is-warning"}`}>{preflight.canDownload ? "막는 문제 없음" : `확인 ${preflight.counts.block}건`}</span>
        </div>
        <p className={`preflight-headline ${preflight.canDownload ? "is-clear" : "is-attention"}`} role="status">{preflight.headline}</p>
        {(() => {
          // 간단 화면에서는 이양과 무관한 빈칸·필수값 경고를 접는다 — 작년 문서는 빈칸이 있는 게 정상이다.
          const shown = compact
            ? preflight.items.filter((item) => ["carryover-leftover", "invalid-format", "budget-mismatch", "no-file", "no-values"].includes(item.id))
            : preflight.items;
          if (!shown.length) {
            return <p className="block-note">작년 값이 남은 칸과 값 형식에서 걸리는 항목이 없습니다. 내려받은 문서를 한글에서 한 번 대조해 주세요.</p>;
          }
          return (
            <ul className="preflight-list">
              {shown.slice(0, compact ? 4 : shown.length).map(renderItem)}
            </ul>
          );
        })()}
      </section>

      <section className="hwpx-block kordoc-fill" aria-label="hwpx로 내려받기">
        <div className="hwpx-head">
          <div>
            <h3>{compact ? "3 · .hwpx 내려받기" : "4 · HWPX 다운로드"}</h3>
            <p>
              위에서 확인한 값을 원본 양식의 같은 칸에 넣어 <strong>.hwpx 파일로 내려받습니다</strong>. 글꼴·표 테두리·문단 모양은
              원본 그대로이고, 채우지 않은 칸도 원본 글자 그대로 남습니다. 파일은 이 브라우저 안에서만 만들어집니다.
            </p>
          </div>
          <span className="badge is-info">브라우저 안에서 완결</span>
        </div>

        <div className="browser-hwpx-action">
          <div className="browser-hwpx-copy">
            <strong>브라우저에서 바로 .hwpx 내려받기</strong>
            <span>
              {hasFile
                ? `${fileName} · 채울 칸 ${count}개${preflight.canDownload ? "" : ` · 확인 ${preflight.counts.block}건`}`
                : "먼저 .hwpx 양식 파일을 올리거나 연습 양식을 불러와 주세요."}
            </span>
          </div>
          <button
            className="primary-button browser-hwpx-button"
            type="button"
            onClick={() => { void downloadInBrowser(); }}
            disabled={busy !== "" || !hasFile || !count}
          >
            {busy === "browser"
              ? "만드는 중"
              : !preflight.canDownload && !gateArmed
                ? "점검 확인 후 .hwpx 내려받기"
                : ".hwpx 바로 내려받기"}
          </button>
        </div>
        {browserNote && (
          <p className={`hwpx-note is-${browserNote.tone}`} role={browserNote.tone === "error" ? "alert" : "status"}>{browserNote.text}</p>
        )}

        {browserResult && (browserResult.filled.length > 0 || browserResult.skipped.length > 0 || browserResult.unmatched.length > 0) && (
          <details className="setup-details browser-hwpx-result" open={browserResult.skipped.length > 0 || browserResult.unmatched.length > 0}>
            <summary>
              채운 칸 {browserResult.filled.length}개
              {browserResult.skipped.length ? ` · 그대로 둔 칸 ${browserResult.skipped.length}개` : ""}
              {browserResult.unmatched.length ? ` · 못 찾은 값 ${browserResult.unmatched.length}개` : ""}
            </summary>
            <ul className="browser-hwpx-list">
              {browserResult.filled.slice(0, 40).map((item: FilledEntry, index: number) => (
                <li key={`${item.key}-${index}`}>
                  <strong>{item.label}</strong>
                  <span>{String(item.value).replace(/\n/g, " / ")}</span>
                  <small>{item.where}</small>
                </li>
              ))}
              {browserResult.skipped.slice(0, 20).map((item: SkippedEntry, index: number) => (
                <li key={`skip-${item.label}-${index}`} className="is-skipped">
                  <strong>{item.label}</strong>
                  <span>{item.reason}</span>
                  <small>{item.where}{item.current ? ` · 지금 값: ${item.current.slice(0, 40)}` : ""}</small>
                </li>
              ))}
              {browserResult.unmatched.map((label: string) => (
                <li key={`unmatched-${label}`} className="is-skipped">
                  <strong>{label}</strong>
                  <span>양식에서 이 이름의 칸을 찾지 못했습니다</span>
                  <small>양식의 칸 이름과 같게 맞추면 들어갑니다</small>
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className={compact ? "setup-details local-hwpx-options is-advanced" : "setup-details local-hwpx-options"} hidden={compact}>
          <summary>고급 설정 — kordoc JSON·CLI·로컬 브릿지</summary>
          <p className="block-note">
            내 컴퓨터에서 kordoc을 돌리는 쪽이 편할 때만 쓰세요. 위의 ‘.hwpx 바로 내려받기’와 결과는 같습니다.
            fill 은 원본 양식의 글꼴·표 서식을 그대로 두고 빈 칸만 채웁니다. patch 는 지금 만든 채운 문서(.md)를 원본에 반영합니다
            {markdown.trim() ? ` (지금 결과: ${editedFile})` : " — 먼저 고급 설정의 ‘이 양식에 맞춰 채우기’로 결과를 만들어 주세요"}.
          </p>
          <div className="draft-actions kordoc-fill-actions">
            <button className="secondary-button" type="button" onClick={copyJson} disabled={!count}>채움값 JSON 복사</button>
            <button className="secondary-button" type="button" onClick={downloadJson} disabled={!count}>채움값.json 내려받기</button>
            <button className="secondary-button" type="button" onClick={() => copyCommand(command, "kordoc fill")} disabled={!command}>fill 명령 복사</button>
            <button className="secondary-button" type="button" onClick={() => copyCommand(patchCommand, "kordoc patch")} disabled={!patchCommand}>patch 명령 복사</button>
          </div>

          <div className="hwpx-command">
            <code>{command || "npx -y kordoc fill 양식.hwpx -j 채움값.json -o 양식-채움.hwpx"}</code>
            <button className="secondary-button small" type="button" onClick={() => copyCommand(command, "kordoc fill")} disabled={!command}>복사</button>
          </div>

          <details className="hwpx-bridge">
            <summary>내 컴퓨터 브릿지로 바로 채우기</summary>
            <div className="hwpx-bridge-body">
              <p className="block-note">
                kordoc을 돌리는 작은 서버(브릿지)를 띄워 두었다면 주소만 넣고 .hwpx를 바로 받을 수 있습니다.
                양식 파일은 브릿지(내 컴퓨터)로만 전송되고, 이 앱 서버나 외부로는 나가지 않습니다.
              </p>
              <label className="field wide">
                <span>브릿지 주소</span>
                <input
                  value={endpoint}
                  placeholder="http://127.0.0.1:8787/kordoc"
                  onChange={(event) => {
                    setEndpoint(event.target.value);
                    saveHwpxBridgeEndpoint(event.target.value);
                  }}
                />
              </label>
              <div className="draft-actions">
                <button className="primary-button" type="button" onClick={() => { void sendThroughBridge("fill"); }} disabled={busy !== "" || !count || !hasFile}>
                  {busy === "fill" ? "채우는 중" : "브릿지로 채우기"}
                </button>
                <button className="secondary-button" type="button" onClick={() => { void sendThroughBridge("patch"); }} disabled={busy !== "" || !canPatch}>
                  {busy === "patch" ? "반영 중" : "브릿지로 patch"}
                </button>
              </div>
              {!hasFile && <p className="block-note">붙여넣은 양식은 파일이 없어 fill로 채울 수 없습니다. 양식을 .hwpx로 올리거나 연습 양식을 불러와 주세요.</p>}
              {bridgeNote && (
                <p className={`hwpx-note is-${bridgeNote.tone}`} role={bridgeNote.tone === "error" ? "alert" : "status"}>{bridgeNote.text}</p>
              )}
              <details className="setup-details">
                <summary>브릿지가 받는 요청 형식</summary>
                <ul id="kordoc-fill-contract" className="hwpx-contract">
                  {KORDOC_FILL_CONTRACT.map((line) => <li key={line}>{line}</li>)}
                </ul>
                <p className="block-note">이 저장소의 <code>scripts/kordoc-bridge.mjs</code> 를 실행하면 위 형식을 그대로 받습니다: <code>node scripts/kordoc-bridge.mjs</code></p>
              </details>
            </div>
          </details>

          <details className="setup-details kordoc-fill-json">
            <summary>kordoc으로 넘길 채움값 JSON 보기</summary>
            <textarea className="draft-output" rows={12} readOnly value={jsonText} aria-label="kordoc 채움값 JSON" />
          </details>
        </details>

        <p className="block-note">
          채운 .hwpx에는 이름·연락처·예산 같은 정보가 들어갑니다. 파일은 이 브라우저에 저장되지 않으니 받은 뒤 직접 보관하세요.
        </p>
      </section>
    </>
  );
}
