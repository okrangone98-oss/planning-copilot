// 3단계 ‘AI로 남은 칸·문구 초안 채우기’.
// 규칙·자료만으로 채우지 못한 칸(작년 값이 남은 칸 + 아직 빈 칸)의 이름표와
// 사용자가 올린 올해 자료의 요약만 골라 AI에 보내고, 돌아온 초안을 ‘검토 목록’으로 보여 준다.
// 원칙: AI는 제안만 한다. 값은 사용자가 체크해야 양식에 들어간다.
// 개인정보 가리기는 호출 전에 앱이 먼저 한다(이 모듈은 이미 가린 글을 받는다).

import { hasMaskedTokens } from "./piiGuard.mjs";
import { previousYearSignals } from "./yearCarryover.mjs";

/** 한 번에 제안받을 칸 수 상한 — 무료 모델의 답이 길어지지 않게. */
export const AI_DRAFT_MAX_TARGETS = 14;
/** 칸 하나에 넣을 값 길이 상한(글자). */
export const AI_DRAFT_MAX_VALUE = 260;
/** 프롬프트에 넣을 자료 길이 상한(글자). */
export const AI_DRAFT_MAX_SOURCE = 4200;

function trim(value, limit) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, limit);
}

function labelKey(field) {
  return String(field?.label ?? "").replace(/\s+/g, " ").trim();
}

/**
 * AI에 보낼 ‘남은 칸’을 고른다.
 * 1순위: 작년 값이 남아 있는 칸(leftover) — 결과보고서에서 가장 위험한 칸.
 * 2순위: 아직 비어 있는 칸.
 * 문서 제목처럼 글자 전체를 갈아끼우는 칸(rewrite)은 이미 규칙이 값을 정하므로 뺀다.
 * @param {{fields?: Array, values?: Record<string,string>, leftover?: {rows?: Array}|null, limit?: number}} input
 */
export function selectLeftoverTargets({ fields = [], values = {}, leftover = null, limit = AI_DRAFT_MAX_TARGETS } = {}) {
  const list = Array.isArray(fields) ? fields : [];
  const byId = new Map(list.map((field) => [field.id, field]));
  const targets = [];
  const seen = new Set();

  for (const row of Array.isArray(leftover?.rows) ? leftover.rows : []) {
    const field = byId.get(row.fieldId);
    if (!field || field.rewrite) continue;
    if (seen.has(field.id)) continue;
    seen.add(field.id);
    targets.push({
      fieldId: field.id,
      label: labelKey(field) || String(row.label ?? ""),
      sectionTitle: String(field.sectionTitle ?? row.sectionTitle ?? ""),
      type: String(field.type ?? "text"),
      where: String(field.hint || "").slice(0, 60),
      previous: String(row.previous ?? field.value ?? "").trim().slice(0, 120),
      reason: String(row.reason ?? ""),
      kind: "leftover"
    });
  }

  for (const field of list) {
    if (targets.length >= limit) break;
    if (!field || field.rewrite || seen.has(field.id)) continue;
    const next = String(values?.[field.id] ?? "").trim();
    const original = String(field.value ?? "").trim();
    // 값이 이미 있으면(작년 값이든 올해 값이든) AI가 손대지 않는다 — 남은 칸만 채운다.
    if (next || original) continue;
    seen.add(field.id);
    targets.push({
      fieldId: field.id,
      label: labelKey(field) || "칸",
      sectionTitle: String(field.sectionTitle ?? ""),
      type: String(field.type ?? "text"),
      where: String(field.hint || "").slice(0, 60),
      previous: "",
      reason: "아직 비어 있는 칸",
      kind: "empty"
    });
  }

  return targets.slice(0, limit);
}

/**
 * 프롬프트를 만든다. 자료에 없는 사실을 만들지 않도록 못을 박고, JSON 하나만 받는다.
 * @param {{targets?: Array, filled?: Record<string,string>, fields?: Array, planLines?: Array, materialLine?: string, smartText?: string, currentYear?: number, sourceYear?: number|null}} input
 */
export function buildLeftoverDraftPrompt({
  targets = [],
  fields = [],
  values = {},
  planLines = [],
  materialLine = "",
  smartText = "",
  currentYear,
  sourceYear = null
} = {}) {
  const thisYear = Number(currentYear) || new Date().getFullYear();
  const list = Array.isArray(targets) ? targets : [];
  const targetLines = list.map((target) => {
    const parts = [`- ${target.fieldId} · ‘${target.label}’`];
    if (target.sectionTitle) parts.push(`구역 ‘${target.sectionTitle}’`);
    if (target.kind === "leftover" && target.previous) parts.push(`지금 적힌 값: ${target.previous}`);
    if (target.where) parts.push(`형식 힌트: ${target.where}`);
    return parts.join(" · ");
  });

  const planText = (Array.isArray(planLines) ? planLines : [])
    .filter((line) => line && line.kind === "label" && String(line.label ?? "").trim() && String(line.value ?? "").trim())
    .slice(0, 40)
    .map((line) => `- ${String(line.label).trim()}: ${String(line.value).trim().slice(0, 120)}`);

  const byId = new Map((Array.isArray(fields) ? fields : []).map((field) => [field.id, field]));
  const filledLines = Object.entries(values && typeof values === "object" ? values : {})
    .map(([fieldId, value]) => {
      const field = byId.get(fieldId);
      const text = String(value ?? "").trim();
      if (!field || !text || field.rewrite) return "";
      return `- ${labelKey(field)}: ${text.slice(0, 100)}`;
    })
    .filter(Boolean)
    .slice(0, 25);

  return [
    "당신은 한국 농촌활성화 사업 결과보고서를 쓰는 사무국 실무자입니다.",
    `지금은 ${thisYear}년 결과보고서를 쓰는 중이고, 올린 양식에는 ${sourceYear ? `${sourceYear}년` : "전년도"} 값이 남아 있습니다.`,
    "아래 ‘남은 칸’의 값을 채울 초안을 제안하세요. 한 칸에 한 값만 냅니다.",
    "",
    "지켜야 할 것:",
    "1. 아래 ‘올해 자료’에 있는 사실만 쓰세요. 자료에 없는 숫자·금액·인원·기관명·사업명을 만들지 마세요.",
    "2. 근거가 없어 쓸 수 없는 칸은 아예 빼세요. 빈 문자열이나 ‘확인 필요’ 같은 자리표시자를 넣지 마세요.",
    "3. [성명_1], [연락처_1] 같은 가림 표시는 자료에 나온 그대로 두세요. 새로 만들거나 풀지 마세요.",
    "4. 지금 적힌 값(전년도 값)을 그대로 베끼지 마세요. 올해 자료로 바꿀 수 없으면 그 칸은 빼세요.",
    "5. 칸 성격에 맞는 짧은 문구로 쓰세요. 금액·인원 칸은 숫자와 단위만, 글 칸은 한두 문장(300자 이내)으로 씁니다.",
    "6. 결과는 아래 JSON 하나만 출력하세요. 설명·인사말·코드블록 표시를 붙이지 마세요.",
    "",
    "출력 형식:",
    '{"drafts":[{"fieldId":"f1","value":"칸에 넣을 값","reason":"어느 자료에서 왔는지 한 줄"}]}',
    "",
    "## 남은 칸",
    ...(targetLines.length ? targetLines : ["- (남은 칸이 없습니다)"]),
    "",
    "## 올해 자료 — 추진계획서에서 읽은 값",
    ...(planText.length ? planText : ["- (없음)"]),
    "",
    "## 올해 자료 — 정산·출석 집계",
    `- ${trim(materialLine, 200) || "(없음)"}`,
    "",
    "## 올해 자료 — 사업 담당자가 붙여넣은 글",
    trim(smartText, AI_DRAFT_MAX_SOURCE) || "(없음)",
    "",
    "## 이미 채워진 칸(말투·단위를 맞추는 참고용, 바꾸지 않음)",
    ...(filledLines.length ? filledLines : ["- (없음)"])
  ].join("\n");
}

/** ```json … ``` 울타리나 앞뒤 설명이 섞여도 첫 JSON 객체를 꺼낸다. */
function extractJson(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const attempts = [body];
  const objectStart = body.indexOf("{");
  const objectEnd = body.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) attempts.push(body.slice(objectStart, objectEnd + 1));
  const arrayStart = body.indexOf("[");
  const arrayEnd = body.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) attempts.push(body.slice(arrayStart, arrayEnd + 1));
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* 다음 후보로 넘어간다 */
    }
  }
  return null;
}

/**
 * AI 응답을 검토 목록으로 바꾼다.
 * - 남은 칸 목록에 없는 fieldId·빈 값은 버린다.
 * - 가림 표시가 섞인 값은 문서에 넣을 수 없으므로 버리고 따로 센다.
 * - 올해보다 앞선 연도가 든 값은 ‘연도 확인 필요’로 표시한다(버리지는 않는다).
 * @param {string} raw
 * @param {{targets?: Array, currentYear?: number, sourceYear?: number|null}} options
 */
export function parseLeftoverDraftResponse(raw, { targets = [], currentYear, sourceYear = null } = {}) {
  const parsed = extractJson(raw);
  const list = Array.isArray(targets) ? targets : [];
  const byId = new Map(list.map((target) => [target.fieldId, target]));
  const items = Array.isArray(parsed?.drafts) ? parsed.drafts : Array.isArray(parsed?.rows) ? parsed.rows : Array.isArray(parsed) ? parsed : [];
  const thisYear = Number(currentYear) || new Date().getFullYear();

  const rows = [];
  let rejected = 0;
  let masked = 0;
  const seen = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") {
      rejected += 1;
      continue;
    }
    const target = byId.get(String(item.fieldId ?? item.id ?? ""));
    const value = trim(item.value ?? item.text ?? "", AI_DRAFT_MAX_VALUE);
    if (!target || !value || seen.has(target.fieldId)) {
      rejected += 1;
      continue;
    }
    seen.add(target.fieldId);
    if (hasMaskedTokens(value)) {
      masked += 1;
      continue;
    }
    const signals = previousYearSignals(value, { currentYear: thisYear, sourceYear: sourceYear ?? undefined });
    rows.push({
      fieldId: target.fieldId,
      label: target.label,
      sectionTitle: target.sectionTitle || "",
      kind: target.kind || "empty",
      previous: target.previous || "",
      value,
      reason: trim(item.reason ?? item.note ?? "", 120),
      yearRisk: signals.hasPreviousYear,
      riskYears: signals.years.filter((year) => year < thisYear)
    });
  }

  return {
    rows,
    counts: { received: items.length, kept: rows.length, rejected, masked }
  };
}

/** 체크한 제안만 양식 값으로 바꾼다. */
export function collectDraftValues(rows, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const values = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!selected.has(row.fieldId)) continue;
    const value = trim(row.value, AI_DRAFT_MAX_VALUE);
    if (!value) continue;
    values[row.fieldId] = value;
  }
  return { values, count: Object.keys(values).length };
}

/** 화면 요약 한 줄 */
export function summarizeDraftResult(result, selectedIds) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(rows.map((row) => row.fieldId));
  return {
    total: rows.length,
    selected: rows.filter((row) => selected.has(row.fieldId)).length,
    risky: rows.filter((row) => row.yearRisk).length,
    masked: result?.counts?.masked || 0,
    rejected: result?.counts?.rejected || 0
  };
}
