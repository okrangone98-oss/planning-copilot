// 전년도 결과보고서 양식 이양 — 작년 값이 적힌 칸을 찾아 올해 값으로 갈아끼우고,
// 갈아끼우지 못한 칸은 ‘전년도 값 잔존 확인 필요’로 눈에 띄게 남긴다.
//
// 배경: 결과보고서는 작년 문서를 열어 숫자만 바꿔 내는 일이 많다. 지금까지의 채우기는
// "빈칸만 채우고 원본 값은 건드리지 않는다"는 안전 규칙 때문에 작년 값이 그대로 남았다.
// 이 모듈은 그 규칙을 문서 단위로만 뒤집는다 — 사용자가 ‘양식 이양’을 켜고,
// 바꿀 값이 확인된 칸만(작년 값이 정확히 일치할 때만) 덮어쓴다.

import { extractFormFields, normalizeFormLabel } from "./kordocFormSpec.mjs";

export const CARRYOVER_LEFTOVER_LABEL = "전년도 값 잔존 확인 필요";
export const CARRYOVER_REPLACED_LABEL = "전년도 값 교체";
export const CARRYOVER_KEPT_LABEL = "전년도 값 그대로";

export const CARRYOVER_MODE_HINT =
  "작년 결과보고서에 이미 적힌 연도·날짜·금액을 올해 자료의 값으로 갈아끼웁니다. 값이 확인된 칸만 바꾸고, 바꾸지 못한 칸은 ‘전년도 값 잔존 확인 필요’로 표시합니다.";

/** 연도로 볼 네 자리 숫자 — 2000~2099 */
const YEAR_RE = /(?<!\d)(20\d{2})(?!\d)/g;
/** 연도가 붙은 날짜 — 2025. 3. 2. / 2025-03-02 / 2025년 3월 */
const DATE_WITH_YEAR_RE = /(20\d{2})\s*[.\-/년]\s*\d{1,2}(?:\s*[.\-/월]\s*\d{1,2})?/g;
const AMOUNT_RE = /(?:\d{1,3}(?:,\d{3})+|\d+)\s*(?:원|만원|천원|백만원)/g;
const COUNT_RE = /(?:\d{1,3}(?:,\d{3})+|\d+)\s*(?:명|인|회|건|개소|가구|팀|%)/g;
const RESULT_TITLE_RE = /결과\s*보고|실적|정산|성과/;

function unique(list) {
  return [...new Set(list)];
}

/** 글 안의 네 자리 연도 */
export function yearsIn(value) {
  const text = String(value ?? "");
  const years = [];
  YEAR_RE.lastIndex = 0;
  let match;
  while ((match = YEAR_RE.exec(text))) years.push(Number(match[1]));
  return unique(years);
}

/**
 * 한 값에서 ‘전년도’ 흔적을 찾는다.
 * - 강한 흔적: 올해보다 앞선 연도, 그 연도가 붙은 날짜 — 이건 작년 문서의 값이라고 말할 수 있다.
 * - 약한 흔적: 금액·인원 — 연도는 없지만 결과보고서에서는 지난 실적인 경우가 많아 사람이 볼 항목으로 남긴다.
 */
export function previousYearSignals(value, { currentYear, sourceYear } = {}) {
  const text = String(value ?? "");
  const thisYear = Number(currentYear) || new Date().getFullYear();
  const baseYear = Number(sourceYear) || thisYear - 1;
  const strong = [];
  const weak = [];

  for (const year of yearsIn(text)) {
    if (year < thisYear) strong.push({ kind: "year", text: String(year), year });
  }
  DATE_WITH_YEAR_RE.lastIndex = 0;
  let match;
  while ((match = DATE_WITH_YEAR_RE.exec(text))) {
    const year = Number(match[1]);
    if (year && year < thisYear) strong.push({ kind: "date", text: match[0].trim(), year });
  }
  // 연도가 없는 “3. 2.” 꼴 날짜는 어느 해인지 알 수 없다 — 흔적으로 세지 않는다.
  AMOUNT_RE.lastIndex = 0;
  while ((match = AMOUNT_RE.exec(text))) weak.push({ kind: "amount", text: match[0].trim() });
  COUNT_RE.lastIndex = 0;
  while ((match = COUNT_RE.exec(text))) weak.push({ kind: "count", text: match[0].trim() });

  return {
    years: yearsIn(text),
    sourceYear: baseYear,
    strong: unique(strong.map((item) => `${item.kind}|${item.text}`)).map((key) => {
      const [kind, text_] = key.split("|");
      return { kind, text: text_ };
    }),
    weak,
    hasPreviousYear: strong.length > 0,
    hasValueSignals: strong.length > 0 || weak.length > 0
  };
}

/**
 * 올린 양식이 ‘작년 결과보고서처럼 값이 채워진 문서’인지 본다.
 * @param {{schema?: object|null, fileName?: string, title?: string, text?: string, currentYear?: number, fields?: Array}} input
 */
export function detectPreviousYearDocument({ schema = null, fileName = "", title = "", text = "", currentYear, fields = null } = {}) {
  const thisYear = Number(currentYear) || new Date().getFullYear();
  const list = Array.isArray(fields) ? fields : schema ? extractFormFields(schema) : [];
  const filled = list.filter((field) => field && field.empty === false && String(field.value ?? "").trim());
  const values = filled.map((field) => String(field.value ?? "").trim());
  const header = `${fileName} ${title || schema?.title || ""}`;

  const years = unique([
    ...yearsIn(header),
    ...values.flatMap((value) => yearsIn(value)),
    ...yearsIn(text).slice(0, 20)
  ]).sort((a, b) => a - b);
  const pastYears = years.filter((year) => year < thisYear);
  const sourceYear = pastYears.length ? pastYears[pastYears.length - 1] : null;

  const totalFields = list.length;
  const filledCells = filled.length;
  const filledRatio = totalFields ? filledCells / totalFields : 0;
  const signals = { year: 0, date: 0, amount: 0, count: 0 };
  for (const value of values) {
    const found = previousYearSignals(value, { currentYear: thisYear, sourceYear });
    for (const item of found.strong) signals[item.kind] = (signals[item.kind] || 0) + 1;
    for (const item of found.weak) signals[item.kind] = (signals[item.kind] || 0) + 1;
  }

  const hasResultTitle = RESULT_TITLE_RE.test(header);
  const isFilledDocument = filledCells >= 3 && filledRatio >= 0.5;
  const isPreviousYearDocument = filledCells >= 2 && (signals.year > 0 || signals.date > 0);
  // 빈 양식이 아니라 값이 채워진 문서면 이양 대상으로 제안한다 — 결과보고서 서식은 작년 것을 그대로 쓴다.
  const suggested = isPreviousYearDocument || (isFilledDocument && hasResultTitle);

  let reason = "";
  if (isPreviousYearDocument) {
    reason = `이 양식에 ${sourceYear ? `${sourceYear}년` : "전년도"} 값이 ${signals.year + signals.date}곳 적혀 있습니다 — 양식 이양으로 올해 값과 갈아끼울 수 있습니다.`;
  } else if (suggested) {
    reason = `이미 값이 채워진 ${hasResultTitle ? "결과보고서" : "문서"}입니다(칸 ${filledCells}/${totalFields} 채움). 작년 문서라면 양식 이양으로 값을 갈아끼우세요.`;
  } else if (filledCells > 0) {
    reason = `값이 채워진 칸이 ${filledCells}개 있습니다. 원본 값을 그대로 두고 빈칸만 채웁니다.`;
  }

  return {
    currentYear: thisYear,
    sourceYear,
    years,
    filledCells,
    totalFields,
    filledRatio: Math.round(filledRatio * 100) / 100,
    signals,
    hasResultTitle,
    isFilledDocument,
    isPreviousYearDocument,
    suggested,
    reason
  };
}

/**
 * 이양 대상 칸 목록 — 원본에 값이 있고, 그 값이 전년도 흔적을 가진 칸.
 * @param {{fields?: Array, currentYear?: number, sourceYear?: number}} input
 */
export function buildCarryoverPlan({ fields = [], currentYear, sourceYear } = {}) {
  const thisYear = Number(currentYear) || new Date().getFullYear();
  const rows = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field || field.empty !== false) continue;
    const value = String(field.value ?? "").trim();
    if (!value) continue;
    const signals = previousYearSignals(value, { currentYear: thisYear, sourceYear });
    if (!signals.hasValueSignals) continue;
    rows.push({
      fieldId: field.id,
      label: String(field.label ?? ""),
      sectionTitle: String(field.sectionTitle ?? ""),
      fillKey: String(field.fillKey || field.label || ""),
      type: String(field.type ?? "text"),
      value,
      kinds: unique([...signals.strong, ...signals.weak].map((item) => item.kind)),
      strength: signals.hasPreviousYear ? "strong" : "weak",
      years: signals.years,
      note: signals.hasPreviousYear
        ? `전년도(${signals.years.filter((year) => year < thisYear).join("·") || "지난해"}) 값이 적혀 있습니다`
        : "금액·인원이 적혀 있어 올해 실적과 대조가 필요합니다"
    });
  }
  const strong = rows.filter((row) => row.strength === "strong").length;
  return {
    rows,
    counts: { total: rows.length, strong, weak: rows.length - strong }
  };
}

/**
 * 2단계 자동 배치 결과에서, 이양 대상 칸은 ‘바꿀 값이 있으면’ 미리 체크해 둔다.
 * 사용자가 체크를 풀면 그 칸은 그대로 남는다.
 */
export function markCarryoverRows(result, planRows) {
  if (!result || !Array.isArray(result.rows)) return result;
  const byId = new Map((Array.isArray(planRows) ? planRows : []).map((row) => [row.fieldId, row]));
  const rows = result.rows.map((row) => {
    const carry = byId.get(row.fieldId);
    if (!carry) return row;
    const proposed = String(row.proposed ?? "").trim();
    const replaceable = Boolean(proposed) && proposed !== String(row.current ?? "").trim();
    return {
      ...row,
      checked: replaceable,
      carryover: true,
      carryoverStrength: carry.strength,
      mode: "replace",
      conflict: true,
      reasons: unique([...(row.reasons || []), "전년도 값이 적힌 칸 — 올해 자료의 값으로 바꿉니다"])
    };
  });
  return { ...result, rows };
}

/**
 * 아직 전년도 값이 남아 있는 칸 — 3단계 검토 표의 배지와 사전 점검이 쓴다.
 *  - 바꿀 값이 없는 이양 대상 칸: 원본의 전년도 값이 그대로 남는다.
 *  - 바꾼 값에도 전년도 연도가 들어 있는 칸: 갈아끼웠지만 숫자가 지난해다.
 */
export function findLeftoverYearValues({ fields = [], values = {}, planRows = [], currentYear, sourceYear } = {}) {
  const thisYear = Number(currentYear) || new Date().getFullYear();
  const planById = new Map((Array.isArray(planRows) ? planRows : []).map((row) => [row.fieldId, row]));
  const rows = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field) continue;
    const next = String(values?.[field.id] ?? "").trim();
    const original = field.empty === false ? String(field.value ?? "").trim() : "";
    const plan = planById.get(field.id);
    if (next) {
      const signals = previousYearSignals(next, { currentYear: thisYear, sourceYear });
      if (signals.hasPreviousYear) {
        rows.push({
          fieldId: field.id,
          label: String(field.label ?? ""),
          sectionTitle: String(field.sectionTitle ?? ""),
          previous: original,
          next,
          kinds: unique(signals.strong.map((item) => item.kind)),
          strength: "strong",
          reason: "바꾼 값에 아직 전년도 연도가 들어 있습니다"
        });
      }
      continue;
    }
    if (!original) continue;
    const signals = previousYearSignals(original, { currentYear: thisYear, sourceYear });
    if (signals.hasPreviousYear) {
      rows.push({
        fieldId: field.id,
        label: String(field.label ?? ""),
        sectionTitle: String(field.sectionTitle ?? ""),
        previous: original,
        next: "",
        kinds: unique(signals.strong.map((item) => item.kind)),
        strength: "strong",
        reason: plan ? "이양 대상이지만 바꿀 값이 없어 전년도 값이 그대로 남았습니다" : "전년도 값이 그대로 남아 있습니다"
      });
      continue;
    }
    if (plan && signals.hasValueSignals) {
      rows.push({
        fieldId: field.id,
        label: String(field.label ?? ""),
        sectionTitle: String(field.sectionTitle ?? ""),
        previous: original,
        next: "",
        kinds: unique(signals.weak.map((item) => item.kind)),
        strength: "weak",
        reason: "금액·인원이 그대로 있어 올해 실적인지 확인이 필요합니다"
      });
    }
  }
  const strong = rows.filter((row) => row.strength === "strong").length;
  return { rows, counts: { total: rows.length, strong, weak: rows.length - strong } };
}

/** 검토 표에서 칸마다 붙일 배지 — 바뀐 칸은 교체, 남은 칸은 잔존. */
export function classifyCarryover({ planRows = [], leftover = { rows: [] }, values = {} } = {}) {
  const byId = {};
  for (const row of Array.isArray(planRows) ? planRows : []) {
    const next = String(values?.[row.fieldId] ?? "").trim();
    if (!next) continue;
    if (next === String(row.value ?? "").trim()) continue;
    byId[row.fieldId] = {
      status: "replaced",
      label: CARRYOVER_REPLACED_LABEL,
      previous: String(row.value ?? ""),
      next,
      strength: row.strength || "strong",
      reason: row.note || ""
    };
  }
  for (const row of Array.isArray(leftover.rows) ? leftover.rows : []) {
    // 이미 교체된 칸은 남은 값 목록에서 빼 둔다 — 배지가 두 개 붙지 않게.
    if (byId[row.fieldId]) {
      byId[row.fieldId] = {
        ...byId[row.fieldId],
        status: "leftover",
        label: CARRYOVER_LEFTOVER_LABEL,
        reason: row.reason
      };
      continue;
    }
    byId[row.fieldId] = {
      status: "leftover",
      label: CARRYOVER_LEFTOVER_LABEL,
      previous: row.previous || "",
      next: row.next || "",
      strength: row.strength || "strong",
      reason: row.reason || ""
    };
  }
  const entries = Object.entries(byId);
  return {
    byId,
    counts: {
      replaced: entries.filter(([, item]) => item.status === "replaced").length,
      leftover: entries.filter(([, item]) => item.status === "leftover").length
    }
  };
}

/**
 * .hwpx를 채울 때 ‘이 칸만은 덮어써도 된다’고 알려 줄 목록.
 * 라벨 정규화 키 → 덮어써도 되는 원본 글자들. 값이 정확히 같을 때만 바꾸므로 다른 내용은 건드리지 않는다.
 */
export function carryoverOverwriteMap({ planRows = [], values = {} } = {}) {
  const map = {};
  for (const row of Array.isArray(planRows) ? planRows : []) {
    const next = String(values?.[row.fieldId] ?? "").trim();
    const previous = String(row.value ?? "").trim();
    if (!next || !previous || next === previous) continue;
    const key = normalizeFormLabel(row.fillKey || row.label);
    if (!key) continue;
    const list = map[key] || (map[key] = []);
    if (!list.includes(previous)) list.push(previous);
  }
  return map;
}

/** 화면 요약 문장 */
export function carryoverSummary({ detection = null, plan = null, leftover = null, replaced = 0 } = {}) {
  const year = detection?.sourceYear ? `${detection.sourceYear}년` : "전년도";
  const planned = plan?.counts?.total || 0;
  const remaining = leftover?.counts?.strong || 0;
  const weak = leftover?.counts?.weak || 0;
  if (!planned && !remaining) return "";
  const parts = [];
  if (planned) parts.push(`${year} 값이 적힌 칸 ${planned}개를 이양 대상으로 잡았습니다`);
  if (replaced) parts.push(`${replaced}개를 올해 값으로 바꿨습니다`);
  if (remaining) parts.push(`${remaining}개는 아직 ${year} 값이 남아 있습니다`);
  if (weak) parts.push(`${weak}개는 금액·인원이 그대로라 확인이 필요합니다`);
  return `${parts.join(" · ")}.`;
}

/** 이양 모드에서 3단계 표에 보여 줄 안내 한 줄 */
export function carryoverStatusLine({ detection = null, plan = null, leftover = null } = {}) {
  if (!detection) return "";
  const year = detection.sourceYear ? `${detection.sourceYear}년` : "전년도";
  const planned = plan?.counts?.total || 0;
  if (!planned) {
    return `이 양식에서 ${year} 값이 적힌 칸을 찾지 못했습니다. 빈칸만 채웁니다.`;
  }
  const remaining = leftover?.counts?.total || 0;
  return remaining
    ? `${year} 값이 적힌 칸 ${planned}개 중 ${remaining}개가 아직 그대로입니다. 아래 표에서 칸별로 확인해 주세요.`
    : `${year} 값이 적힌 칸 ${planned}개를 모두 올해 값으로 바꿀 준비가 되었습니다.`;
}
