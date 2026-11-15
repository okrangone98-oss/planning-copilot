// 다운로드 전 사전 점검 — 값이 비었는지, 형식이 맞는지, 자동 배치가 확실한지,
// 예산 총액과 세부가 맞는지, 출석이 '미입력'인지 '0명'인지 사람이 볼 수 있게 모은다.
//
// 원칙: 여기서 값을 고치거나 덮어쓰지 않는다. 판단이 서지 않는 항목은
// '직접 확인'으로 돌려 사용자에게 넘긴다(자동 판단 불가를 자동 통과로 만들지 않는다).

import { fieldTypeOf, isLegalDocumentSchema, isRequiredLabel, normalizeFormLabel } from "./kordocFormSpec.mjs";

/** 점검 항목의 무게 — block 은 내려받기 전에 한 번 더 확인을 받는다. */
export const PREFLIGHT_LEVEL_LABEL = {
  block: "꼭 확인",
  warn: "확인 권장",
  manual: "직접 확인"
};

/** 3단계 검토 표의 칸 상태 이름 */
export const FIELD_STATUS_LABEL = {
  auto: "자동 채움",
  manual: "값 있음",
  check: "확인 필요",
  required: "빈칸 · 필수",
  blank: "빈칸",
  original: "원본 유지"
};

const DATE_HINT = "2026-03-02 또는 2026. 3. 2. 처럼 연·월·일이 보이게";
const AMOUNT_HINT = "1,200,000원 · 12명 · 3회처럼 숫자와 단위만";

/** 숫자만 남긴 값(금액·인원 비교용). 숫자가 아니면 null. */
export function numberFromValue(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const rest = text.replace(match[0], "").replace(/[()원명건개회부매%시간일박점천만백,\s]/g, "");
  if (rest) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 칸 하나의 값 모양을 본다. 빈 값은 여기서 통과시키고 필수 검사에서 따로 다룬다.
 * @returns {{ok: boolean, level: ""|"block"|"warn", message: string}}
 */
export function checkFieldValue(field, value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: true, level: "", message: "" };
  const type = String(field?.type || fieldTypeOf(field?.label, text));
  const hasDigit = /\d/.test(text);

  // 한 칸에 값이 두 줄 이상이면(자동 배치가 두 값을 붙인 경우) 형식 이전에 값 자체가 틀렸다.
  if (/[\n\r]/.test(text) && ["date", "amount", "phone", "email", "idnum"].includes(type)) {
    return { ok: false, level: "block", message: "한 칸에 값이 두 줄 이상 들어갔습니다 — 이 칸에는 하나만 적어 주세요." };
  }

  if (type === "date") {
    const looksLikeDate = /\d{4}\s*[-./년]/.test(text)
      || /^\d{1,2}\s*월(\s*\d{1,2}\s*일)?/.test(text)
      || /(상반기|하반기|\d\s*분기|\d\s*사분기)/.test(text)
      || /^\d{4}$/.test(text);
    if (looksLikeDate) return { ok: true, level: "", message: "" };
    if (hasDigit) {
      return { ok: false, level: "warn", message: `날짜에 연도가 보이지 않습니다 — ${DATE_HINT} 적어 주세요.` };
    }
    return { ok: false, level: "block", message: `날짜 칸인데 숫자가 없습니다 — ${DATE_HINT} 적어 주세요.` };
  }

  if (type === "amount") {
    // 금액 칸에는 “총 4,800만원 (국비 3,360, 군비 960)”처럼 내역이 함께 적히기도 한다.
    // 막아야 하는 것은 숫자가 아예 없는 경우, 알려야 하는 것은 단위 없이 숫자만 떠 있는 경우다.
    if (!hasDigit) {
      return { ok: false, level: "block", message: `금액·인원 칸인데 숫자가 없습니다 — ${AMOUNT_HINT} 적어 주세요.` };
    }
    const hasUnit = /(백만원|천만원|천원|만원|원|명|건|개|회|부|매|%|시간|일|박|점)/.test(text);
    if (hasUnit || /^[\d,.\s]+$/.test(text)) return { ok: true, level: "", message: "" };
    return {
      ok: false,
      level: "warn",
      message: `숫자에 단위가 없어 금액인지 인원인지 알기 어렵습니다 — ${AMOUNT_HINT} 적어 주세요.`
    };
  }

  if (type === "phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 11) return { ok: true, level: "", message: "" };
    return {
      ok: false,
      level: hasDigit ? "warn" : "block",
      message: `전화번호는 숫자 9~11자리로 적어 주세요(예: 010-1234-5678).`
    };
  }

  if (type === "email") {
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(text)) return { ok: true, level: "", message: "" };
    return { ok: false, level: "block", message: "이메일 주소에 @와 도메인이 들어가야 합니다." };
  }

  if (type === "idnum") {
    const digits = text.replace(/\D/g, "");
    if (digits.length === 13) return { ok: true, level: "", message: "" };
    return {
      ok: false,
      level: "warn",
      message: "주민등록번호는 숫자 13자리입니다. 꼭 필요한 양식이 아니면 비워 두세요."
    };
  }

  if (type === "checkbox") {
    if (/[□☑✓✔]/.test(text)) return { ok: true, level: "", message: "" };
    return { ok: false, level: "warn", message: "체크 칸은 □·☑ 같은 표시를 넣어 주세요." };
  }

  return { ok: true, level: "", message: "" };
}

function toIdSet(source) {
  if (source instanceof Set) return source;
  if (Array.isArray(source)) return new Set(source.map((item) => String(item)));
  return new Set();
}

/**
 * 칸마다 상태를 붙인다 — 자동 채움 / 값 있음 / 빈칸 / 빈칸·필수 / 원본 유지 / 확인 필요.
 * 값은 고치지 않고 그대로 돌려준다(덮어쓰기 금지).
 */
export function classifyFields({ fields = [], values = {}, autoFieldIds = [], lowConfidenceIds = [] } = {}) {
  const auto = toIdSet(autoFieldIds);
  const low = toIdSet(lowConfidenceIds);
  return (Array.isArray(fields) ? fields : []).map((field) => {
    const value = String(values?.[field.id] ?? "").trim();
    const originalValue = field && field.empty === false ? String(field.value ?? "").trim() : "";
    const check = value ? checkFieldValue(field, value) : { ok: true, level: "", message: "" };
    let status;
    let note = "";
    if (!value) {
      if (originalValue && isRequiredLabel(field?.label)) status = "required";
      else if (originalValue) status = "original";
      else if (isRequiredLabel(field?.label)) status = "required";
      else status = "blank";
      if (status === "original") note = "원본에 적힌 값을 그대로 둡니다";
      if (status === "required") note = "필수 표시(※)가 있는 빈칸입니다";
    } else if (!check.ok) {
      status = "check";
      note = check.message;
    } else if (auto.has(field.id) && low.has(field.id)) {
      status = "check";
      note = "2단계 자동 배치가 확실하지 않습니다 — 값이 맞는지 봐 주세요";
    } else if (auto.has(field.id)) {
      status = "auto";
      note = "2단계에서 붙여넣은 글로 채웠습니다";
    } else {
      status = "manual";
      note = "직접 적은 값입니다";
    }
    return {
      fieldId: field.id,
      field,
      label: String(field?.label ?? ""),
      sectionTitle: String(field?.sectionTitle ?? ""),
      type: String(field?.type ?? "text"),
      value,
      originalValue,
      required: isRequiredLabel(field?.label),
      status,
      statusLabel: FIELD_STATUS_LABEL[status] || status,
      note,
      check
    };
  });
}

export function summarizeFieldStatuses(rows = []) {
  const counts = { total: 0, auto: 0, manual: 0, check: 0, required: 0, blank: 0, original: 0, filled: 0 };
  for (const row of rows) {
    counts.total += 1;
    if (counts[row.status] === undefined) counts[row.status] = 0;
    counts[row.status] += 1;
    if (row.value) counts.filled += 1;
  }
  return counts;
}

function labelList(rows, limit = 5) {
  const names = rows.map((row) => row.label).filter(Boolean);
  const shown = names.slice(0, limit).join(", ");
  return names.length > limit ? `${shown} 외 ${names.length - limit}개` : shown;
}

function won(value) {
  return `${Math.round(Number(value) || 0).toLocaleString("ko-KR")}원`;
}

/**
 * 예산 총액과 비목 세부 합계를 비교한다. 한쪽만 있으면 판단하지 않는다.
 * @returns {{status: "none"|"match"|"mismatch"|"partial", detail: string, total: number|null, sum: number|null}}
 */
export function checkBudgetTotal({ rows = [] } = {}) {
  const filled = rows.filter((row) => row.value);
  const totalRow = filled.find((row) => /(총\s*사업비|총\s*예산|총액|합계|계$)/.test(row.label));
  const detailRows = filled.filter(
    (row) => row !== totalRow
      && /(비|비용|금액|수당|료|예산)$/.test(row.label.replace(/\s+/g, ""))
      && numberFromValue(row.value) !== null
  );
  const emptyDetailRows = rows.filter(
    (row) => !row.value && /(비|비용|금액|수당|료|예산)$/.test(row.label.replace(/\s+/g, ""))
  );
  if (!totalRow) return { status: "none", detail: "", total: null, sum: null };
  const total = numberFromValue(totalRow.value);
  if (total === null) return { status: "none", detail: "", total: null, sum: null };
  if (!detailRows.length) return { status: "none", detail: "", total, sum: null };
  const sum = detailRows.reduce((acc, row) => acc + Number(numberFromValue(row.value) || 0), 0);
  if (emptyDetailRows.length) {
    return {
      status: "partial",
      detail: `‘${totalRow.label}’ ${won(total)} · 비목 ${detailRows.length}개 합 ${won(sum)} · 비어 있는 비목 ${emptyDetailRows.length}개(${labelList(emptyDetailRows, 3)})`,
      total,
      sum
    };
  }
  if (Math.round(sum) === Math.round(total)) {
    return { status: "match", detail: `‘${totalRow.label}’ ${won(total)} = 비목 ${detailRows.length}개 합`, total, sum };
  }
  return {
    status: "mismatch",
    detail: `‘${totalRow.label}’ ${won(total)} 인데 비목 합은 ${won(sum)}입니다(차액 ${won(total - sum)}).`,
    total,
    sum
  };
}

/**
 * 다운로드 전 사전 점검 보고서.
 * items 의 level: block(내려받기 전 한 번 더 확인) / warn(권장) / manual(사람만 판단할 수 있음)
 */
export function buildDownloadPreflight({
  fields = [],
  values = {},
  autoFieldIds = [],
  lowConfidenceIds = [],
  leftovers = [],
  schema = null,
  title = "",
  hasFile = false
} = {}) {
  const rows = classifyFields({ fields, values, autoFieldIds, lowConfidenceIds });
  const stats = summarizeFieldStatuses(rows);
  const items = [];
  const add = (item) => items.push({ fieldIds: [], detail: "", fix: "", ...item });

  const filledRows = rows.filter((row) => row.value);
  const requiredBlank = rows.filter((row) => row.status === "required");
  const invalidRows = rows.filter((row) => row.status === "check" && row.check && !row.check.ok);
  const lowRows = rows.filter((row) => row.status === "check" && (!row.check || row.check.ok));
  const originalRows = rows.filter((row) => row.status === "original" && row.originalValue);

  if (!rows.length) {
    // 법령·조례 본문은 채울 칸이 없는 것이 정상이다 — 고장처럼 보이지 않게 먼저 구분해 안내한다.
    if (isLegalDocumentSchema(schema)) {
      add({
        id: "no-fields-legal",
        level: "block",
        title: "법령·조례 본문으로 보입니다 — 채울 칸이 없는 것이 정상입니다",
        detail: `‘${schema?.title || title || "이 문서"}’는 조문만 있는 법령·조례라 신청서처럼 채울 칸이 없습니다. 양식이 아니라 근거 문서입니다.`,
        fix: "이 문서는 공고 해석·근거 확인에 쓰고, 실제로 채울 때는 사업계획서·신청서 양식을 ①단계에 올려 주세요."
      });
    } else {
      add({
        id: "no-fields",
        level: "block",
        title: "이 양식에서 값을 넣을 칸을 찾지 못했습니다",
        detail: "읽은 구조에 ‘라벨 | 빈칸’ 표나 ‘라벨: ___’ 자리가 없습니다. 글자만 있는 문서이거나, 칸 이름과 값이 붙어 있는 양식일 수 있습니다.",
        fix: "①단계에서 양식 내용을 붙여넣기로 넣어 보거나, 양식을 한글에서 열어 ‘라벨 | 값’ 표인지 확인해 주세요. 읽은 양식 구조 보기에서 칸 0개를 볼 수 있습니다."
      });
    }
  } else if (!filledRows.length) {
    add({
      id: "no-values",
      level: "block",
      title: "아직 양식에 넣을 값이 없습니다",
      detail: `칸 ${rows.length}개를 읽었지만 값이 하나도 없습니다.`,
      fix: "②단계에서 자료를 붙여넣고 자동 배치를 하거나, ③단계 ‘아직 비어 있는 칸’에 직접 적어 주세요. 적은 값은 이 브라우저에 저장되어 새로고침해도 이어서 할 수 있습니다."
    });
  }

  if (requiredBlank.length) {
    add({
      id: "required-blank",
      level: "block",
      title: `필수 표시(※)가 있는 빈칸 ${requiredBlank.length}개`,
      detail: labelList(requiredBlank),
      fix: "③단계 ‘아직 비어 있는 칸’에서 채워 주세요. 이 양식에서 정말 필요한 칸인지 원본 양식과 함께 보세요.",
      fieldIds: requiredBlank.map((row) => row.fieldId)
    });
  }

  if (invalidRows.length) {
    // 값이 두 줄이거나 숫자가 아예 없으면 막고, 숫자는 있는데 글자가 섮인 정도면 권장에 그친다.
    const worst = invalidRows.some((row) => row.check.level === "block") ? "block" : "warn";
    add({
      id: "invalid-format",
      level: worst,
      title: `날짜·금액 형식이 맞지 않는 칸 ${invalidRows.length}개`,
      detail: invalidRows.slice(0, 4).map((row) => `‘${row.label}’: ${row.value.slice(0, 40)} — ${row.check.message}`).join(" / "),
      fix: "값을 숫자 중심으로 고쳐 주세요. 날짜는 연·월·일이 보이게, 금액·인원은 숫자와 단위만 남깁니다.",
      fieldIds: invalidRows.map((row) => row.fieldId)
    });
  }

  const duplicateGroups = new Map();
  for (const row of filledRows) {
    const key = normalizeFormLabel(row.field.fillKey || row.label);
    if (!key) continue;
    const group = duplicateGroups.get(key) || [];
    group.push(row);
    duplicateGroups.set(key, group);
  }
  const duplicateRows = [...duplicateGroups.values()].filter(
    (group) => group.length > 1 && new Set(group.map((row) => row.value)).size > 1
  );
  if (duplicateRows.length) {
    add({
      id: "duplicate-label",
      level: "warn",
      title: `같은 이름의 칸이 여러 곳 ${duplicateRows.length}종`,
      detail: duplicateRows.slice(0, 3).map((group) => `‘${group[0].label}’ ${group.length}곳 — ${group.map((row) => row.value.slice(0, 20)).join(" / ")}`).join(" · "),
      fix: "이름이 같은 칸에는 값이 나온 순서대로 들어갑니다. 순서가 바뀌면 값이 엉뚱한 칸에 들어가니 다운로드 뒤 한글에서 확인해 주세요.",
      fieldIds: duplicateRows.flat().map((row) => row.fieldId)
    });
  }

  if (Array.isArray(leftovers) && leftovers.length) {
    add({
      id: "leftovers",
      level: "warn",
      title: `붙여넣은 글 중 칸에 넣지 못한 글 ${leftovers.length}개`,
      detail: leftovers.slice(0, 3).map((item) => String(item?.text ?? "").slice(0, 40)).filter(Boolean).join(" / "),
      fix: "②단계 ‘배치하지 못한 글’을 초안 조립으로 보내거나, ③단계 빈칸에 직접 옮겨 적어 주세요. 넣지 않은 글은 양식에 들어가지 않습니다."
    });
  }

  if (lowRows.length) {
    add({
      id: "low-confidence",
      level: "manual",
      title: `자동 배치가 확실하지 않은 칸 ${lowRows.length}개`,
      detail: labelList(lowRows),
      fix: "③단계 표에서 값이 그 칸의 내용과 맞는지 보고, 다르면 고치거나 지워 주세요.",
      fieldIds: lowRows.map((row) => row.fieldId)
    });
  }

  const mergedTables = Array.isArray(schema?.tables)
    ? schema.tables.filter((table) => Array.isArray(table?.spans) && table.spans.length)
    : [];
  if (mergedTables.length) {
    add({
      id: "merged-cells",
      level: "manual",
      title: `병합된 칸이 있는 표 ${mergedTables.length}개`,
      detail: mergedTables.slice(0, 3).map((table) => `${table.caption || "표"}(${table.spans.length}칸 병합)`).join(" · "),
      fix: "병합된 칸은 값이 들어갈 자리를 앱이 확정하지 못할 수 있습니다. 내려받은 .hwpx를 한글에서 열어 값 위치를 확인해 주세요."
    });
  }

  if (originalRows.length) {
    add({
      id: "original-kept",
      level: "manual",
      title: `원본에 이미 값이 있는 칸 ${originalRows.length}개는 그대로 둡니다`,
      detail: originalRows.slice(0, 3).map((row) => `‘${row.label}’: ${row.originalValue.slice(0, 30)}`).join(" · "),
      fix: "자동으로 덮어쓰지 않습니다. 바꿔야 하는 칸이면 한글에서 고치거나, 원본 양식의 그 칸을 비우고 다시 올려 주세요.",
      fieldIds: originalRows.map((row) => row.fieldId)
    });
  }

  const budget = checkBudgetTotal({ rows });
  if (budget.status === "mismatch") {
    add({
      id: "budget-mismatch",
      level: "warn",
      title: "예산 총액과 비목 합계가 다릅니다",
      detail: budget.detail,
      fix: "비목 금액을 다시 확인해 주세요. 총액을 나중에 고쳤다면 세부도 함께 고쳐야 합니다. 심사에서 계산이 어긋나면 감점됩니다."
    });
  } else if (budget.status === "partial") {
    add({
      id: "budget-partial",
      level: "manual",
      title: "비목이 일부 비어 있어 예산 합계를 자동으로 판단할 수 없습니다",
      detail: budget.detail,
      fix: "쓰지 않는 비목이면 0원으로 적고, 남은 비목 금액을 채운 뒤 총사업비와 맞는지 확인해 주세요."
    });
  }

  const attendanceRows = rows.filter((row) => /(출석|참석|수료)/.test(row.label));
  const attendanceBlank = attendanceRows.filter((row) => !row.value);
  const attendanceZero = attendanceRows.filter((row) => row.value && numberFromValue(row.value) === 0);
  if (attendanceBlank.length) {
    add({
      id: "attendance-blank",
      level: "warn",
      title: `출석·참석 칸 ${attendanceBlank.length}개가 비어 있습니다`,
      detail: `‘${labelList(attendanceBlank)}’ — 빈칸은 ‘미입력’으로 들어갑니다.`,
      fix: "실제로 0명이면 0을 적어 주세요. 비워 두면 결과보고에서 ‘집계 안 됨’으로 남습니다. 아직 모르면 다운로드 뒤 손으로 채우세요.",
      fieldIds: attendanceBlank.map((row) => row.fieldId)
    });
  }
  if (attendanceZero.length) {
    add({
      id: "attendance-zero",
      level: "manual",
      title: `출석 0명으로 적힌 칸 ${attendanceZero.length}개`,
      detail: labelList(attendanceZero),
      fix: "진짜 0명인지, 아직 안 적은 것인지 확인해 주세요. 0명은 실적으로 남습니다.",
      fieldIds: attendanceZero.map((row) => row.fieldId)
    });
  }

  const text = String(title || schema?.title || "");
  if (/결과\s*보고/.test(text)) {
    const resultRows = rows.filter((row) => /(실적|성과|출석|참석|만족도|집행|정산|결과)/.test(row.label));
    const resultBlank = resultRows.filter((row) => !row.value);
    if (resultRows.length && resultBlank.length) {
      add({
        id: "report-incomplete",
        level: "manual",
        title: "결과보고서 칸이 아직 비어 있습니다",
        detail: `비어 있는 칸: ${labelList(resultBlank, 4)}`,
        fix: "실적·출석·집행 칸이 비면 결과보고가 불완전해집니다. 미입력인지 0명인지 구분해 적은 뒤 내려받으세요.",
        fieldIds: resultBlank.map((row) => row.fieldId)
      });
    }
  }

  if (!hasFile) {
    add({
      id: "no-file",
      level: "block",
      title: "채울 .hwpx 양식 파일이 없습니다",
      detail: "붙여넣은 내용만으로는 원본 서식에 값을 넣을 수 없습니다.",
      fix: "①단계에서 .hwpx 양식을 올리거나 연습 양식을 불러온 뒤 다시 눌러 주세요. 지금 적은 값은 그대로 남습니다."
    });
  }

  const counts = { block: 0, warn: 0, manual: 0 };
  for (const item of items) counts[item.level] = (counts[item.level] || 0) + 1;
  const firstBlock = items.find((item) => item.level === "block");
  const headline = counts.block
    ? `내려받기 전에 확인할 것 ${counts.block}건 · 권장 ${counts.warn}건 · 직접 확인 ${counts.manual}건`
    : counts.warn || counts.manual
      ? `막는 문제는 없습니다 · 권장 ${counts.warn}건 · 직접 확인 ${counts.manual}건`
      : "다운로드 전 점검에서 걸리는 항목이 없습니다";

  return {
    items,
    counts,
    stats,
    canDownload: counts.block === 0,
    headline,
    gateMessage: firstBlock ? `${firstBlock.title} — 내용을 확인했으면 한 번 더 누르면 그대로 내려받습니다.` : "",
    budget
  };
}

/** 내려받기 직후 안내에 붙일 한 줄 요약. */
export function preflightSummaryLine(preflight) {
  if (!preflight) return "";
  const { counts, stats } = preflight;
  const parts = [`채운 칸 ${stats.filled}/${stats.total}`];
  if (counts.block) parts.push(`꼭 확인 ${counts.block}건`);
  if (counts.warn) parts.push(`확인 권장 ${counts.warn}건`);
  if (counts.manual) parts.push(`직접 확인 ${counts.manual}건`);
  return parts.join(" · ");
}

/** .hwpx 생성이 실패했을 때 — 쉬운 한국어 이유와 다음 할 일. */
export function explainDownloadFailure(error) {
  const reason = error instanceof Error ? error.message : String(error ?? "");
  const lower = reason.toLowerCase();
  if (!reason) {
    return { title: "파일을 만들지 못했습니다", detail: "", fix: "입력한 값은 그대로 남아 있습니다. 잠시 뒤 다시 눌러 주세요." };
  }
  if (lower.includes("zip") || lower.includes("central directory") || lower.includes("signature")) {
    return {
      title: "올린 파일이 .hwpx 형식이 아닙니다",
      detail: "양식이 압축(zip) 구조로 열리지 않았습니다. 구형 .hwp 파일이거나 확장자만 바꾼 파일일 수 있습니다.",
      fix: "한글에서 그 파일을 열어 ‘다른 이름으로 저장 → HWPX’로 저장한 뒤 다시 올려 주세요. 지금 적은 값은 그대로 남습니다."
    };
  }
  if (lower.includes("section") || lower.includes("content.hpf")) {
    return {
      title: "양식 본문을 찾지 못했습니다",
      detail: "HWPX 안에서 본문(section)이나 목록(content.hpf)이 빠져 있습니다.",
      fix: "한글에서 양식을 다시 열어 ‘다른 이름으로 저장 → HWPX’로 새로 저장한 파일로 시도해 주세요."
    };
  }
  if (lower.includes("memory") || lower.includes("allocation") || lower.includes("array buffer")) {
    return {
      title: "양식이 커서 브라우저가 처리하지 못했습니다",
      detail: "그림이 많은 양식은 한 번에 메모리에 올리기 어려울 수 있습니다.",
      fix: "다른 탭을 닫고 다시 시도하거나, 양식에서 그림을 줄여 다시 올려 주세요. 입력한 값은 그대로 남아 있습니다."
    };
  }
  return {
    title: "파일을 만들지 못했습니다",
    detail: reason.slice(0, 200),
    fix: "입력한 값은 그대로 남아 있습니다. 양식을 다시 올리거나, 고급 설정의 kordoc 경로로 같은 값을 내려받아 보세요."
  };
}
