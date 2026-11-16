// 사업 하나에 이미 적어 둔 값(사업계획·예산 편성·회차 운영·지출 원장·결과보고)을
// 샘플 양식 채우기 2단계(자료 붙여넣기)의 글로 한 번에 옮기는 순수 함수 모음.
//
// 원칙
//  - 적힌 값만 옮긴다. 미입력(빈칸·null)은 줄을 만들지 않는다. 0이나 추정값으로 채우지 않는다.
//  - 회차 인원은 '적힌 0명'과 '아직 안 적음'을 구분해 적는다(합계에서 뺀 회차 수를 함께 밝힌다).
//  - 숫자는 화면·결과보고 HWPX와 같은 계산 함수(budgetSummary·expenseSummary·attendanceReport)에서만 가져온다.
//    같은 값을 두 곳에서 따로 계산하지 않으므로 예산·회차·결과보고 수치가 어긋나지 않는다.
//
// 결과 글은 "라벨: 값" 꼴이라 smartTextMapper의 규칙 기반 배치가 그대로 읽는다.

import { budgetSummary, formatWon, parseAmount } from "./grantWorkflow.mjs";
import { attendanceReport, expenseSummary, sessionSummary } from "./projectOperations.mjs";
import { cellValueOf, isCustomizedColumn, isNumericColumn, normalizeBudgetColumns } from "./budgetColumns.mjs";

const MAX_VALUE = 700;
const MAX_TEXT = 12000;
const MAX_SESSION_LINES = 12;

function text(value, limit = MAX_VALUE) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

/** 라벨·값 안의 줄바꿈·콜론을 지워 "라벨: 값" 줄이 깨지지 않게 한다. 시각(10:00)의 콜론은 살린다. */
function inline(value, limit = MAX_VALUE) {
  return text(value, limit).replace(/[:：]/g, (match, offset, whole) => {
    const before = whole[offset - 1] || "";
    const after = whole[offset + 1] || "";
    return /[0-9]/.test(before) && /[0-9]/.test(after) ? match : "·";
  });
}

/** 본문 문단·불릿용 — 시각(10:00)·수치 표기의 콜론은 그대로 둔다. */
function plain(value, limit = MAX_VALUE) {
  return text(value, limit);
}

/** 2026-03-01 → 2026. 3. 1. (양식에 자주 쓰는 표기) */
function dateText(value) {
  const raw = text(value, 20);
  if (!raw) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.` : raw;
}

/** 2026-03-05T10:00 → 2026. 3. 5. 10:00 (회차 일시) */
function dateTimeText(value) {
  const raw = text(value, 30);
  if (!raw) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(raw);
  if (!match) return raw;
  const day = `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.`;
  return match[4] ? `${day} ${match[4]}:${match[5]}` : day;
}

function periodText(start, end) {
  const from = dateText(start);
  const to = dateText(end);
  if (from && to) return `${from} ~ ${to}`;
  return from || to || "";
}

/** 적힌 숫자만 더한다. 하나도 안 적혔으면 null(0명과 구분). */
function sumKnown(values) {
  const numbers = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
}

function joinParts(parts, separator = " · ") {
  return parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(separator);
}

/**
 * 사용자가 이름을 바꿨거나 새로 더한 열 중, 행마다 값을 적을 열.
 * 집행액·잔액은 합계 풀의 라벨과 같아지므로 행마다 따로 적지 않는다(합계 칸이 엉뚱한 값을 받는다).
 */
function rowColumnLines(columns) {
  return (Array.isArray(columns) ? columns : []).filter((column) => isCustomizedColumn(column)
    && column.role !== "spent" && column.role !== "balance");
}

/** 열의 값을 글 한 줄에 넣을 꼴로 — 숫자 열은 원/숫자로, 글자 열은 그대로. */
function columnValueText(column, raw) {
  if (raw === null || raw === undefined) return "";
  const grouped = (number) => Math.round(number).toLocaleString("ko-KR");
  if (typeof raw === "number") return column.kind === "number" ? grouped(raw) : formatWon(raw);
  const value = String(raw).trim();
  if (!value) return "";
  if (column.role === "unitPrice") return parseAmount(value) ? formatWon(parseAmount(value)) : value;
  if (isNumericColumn(column) && /^[\d,.\s원]+$/.test(value)) {
    const number = Number(value.replace(/[^\d.-]/g, ""));
    if (Number.isFinite(number)) return column.kind === "number" ? grouped(number) : formatWon(Math.round(number));
  }
  return value;
}

/* ────────────────────────── 글 만들기 ────────────────────────── */

/**
 * 사업 데이터 → 2단계 붙여넣기 글.
 * @returns {{text:string, lines:Array<{section:string,label:string,value:string}>, missing:string[], counts:object, truncated:boolean}}
 */
export function buildProjectDataText({ meta, plan, work, project } = {}) {
  const lines = [];
  const missing = [];
  const push = (section, label, value) => {
    const safeLabel = inline(label, 20);
    const safeValue = inline(value);
    if (!safeLabel || !safeValue) return false;
    lines.push({ section, label: safeLabel, value: safeValue });
    return true;
  };
  const note = (section, value) => {
    const safe = plain(value);
    if (safe) lines.push({ section, label: "", value: safe });
  };

  const budget = budgetSummary(plan);
  const sessions = Array.isArray(work?.sessions) ? work.sessions : [];
  const sessionStats = sessionSummary(work);
  const attendance = attendanceReport(work);
  const ledger = expenseSummary(work, plan);
  const schedule = plan?.schedule || {};

  /* ① 사업 개요 */
  const section1 = "사업 개요";
  if (!push(section1, "사업명", plan?.programName || meta?.name || project?.projectName)) missing.push("사업명");
  if (!push(section1, "수행기관", plan?.agency)) missing.push("수행기관");
  if (!push(section1, "담당자", meta?.ownerName)) missing.push("담당자");
  if (!push(section1, "회계연도", plan?.fundingYear || meta?.year)) missing.push("회계연도");
  if (!push(section1, "사업기간", periodText(schedule.projectStart, schedule.projectEnd) || periodText(meta?.startDate, meta?.endDate))) {
    missing.push("사업기간");
  }
  if (!push(section1, "결과보고 마감", dateText(schedule.reportDeadline))) missing.push("결과보고 마감");
  // 재원은 총사업비와 같은 칸(양식에서 ‘재원’은 사업비 항목)으로 읽히므로 한 줄에 함께 적는다.
  const fundingSource = text(plan?.fundingSource, 80);
  const funding = budget.funding;
  const split = joinParts([
    funding.subsidy ? `국비 ${formatWon(funding.subsidy)}` : "",
    funding.local ? `지방비 ${formatWon(funding.local)}` : "",
    funding.self ? `자부담 ${formatWon(funding.self)}` : ""
  ], " · ");
  if (budget.total > 0) {
    push(section1, "총사업비", joinParts([
      `${formatWon(budget.total)}${split ? ` (${split})` : ""}`,
      fundingSource ? `재원 ${fundingSource}` : ""
    ], " · "));
  } else if (fundingSource) {
    push(section1, "총사업비", `재원 ${fundingSource}`);
  } else {
    missing.push("총사업비");
  }
  if (!fundingSource) missing.push("재원");
  if (!push(section1, "목표", (Array.isArray(meta?.goals) ? meta.goals : []).join(" / "))) missing.push("목표");

  /* ② 추진 배경 */
  const section2 = "추진 배경";
  push(section2, "지역현황", project?.fieldEvidence);
  push(section2, "문제점", joinParts([project?.problemSituation, project?.rootCauses], " "));
  push(section2, "추진근거", project?.requirements);
  push(section2, "필요성", project?.whyNow);
  push(section2, "기존 한계", project?.existingLimits);

  /* ③ 사업 내용 */
  const section3 = "사업 내용";
  push(section3, "대상", project?.targetUsers);
  push(section3, "추진내용", joinParts([project?.activities, project?.outputs], " "));
  push(section3, "운영방법", project?.teamSystem);
  push(section3, "기대효과", joinParts([project?.shortOutcomes, project?.longOutcomes], " "));

  /* ④ 소요 예산 — 예산 편성 + 지출 원장(집행·잔액)을 비목마다 한 줄로 */
  const section4 = "소요 예산";
  const basisById = new Map((Array.isArray(plan?.budgetLines) ? plan.budgetLines : []).map((line) => [String(line?.id ?? ""), line]));
  const customColumns = rowColumnLines(normalizeBudgetColumns(plan?.budgetColumns));
  const hasExpense = ledger.expenseCount > 0;
  for (const row of ledger.rows || []) {
    const category = text(row.category, 40) || "비목 미지정";
    const parts = [];
    const extras = [];
    for (const line of row.lines || []) {
      const source = basisById.get(String(line.id ?? ""));
      const basis = text(source?.basis, 60) || joinParts([source?.unitCost ? `${formatWon(Number(source.unitCost) || 0)}` : "", source?.quantity ? `× ${text(source.quantity, 20)}` : ""], " ");
      const amount = line.plan ? formatWon(line.plan) : "";
      parts.push(joinParts([text(line.item, 60) || category, basis ? `(${basis})` : "", amount], " "));
      // 사용자가 바꾼 머리글·새로 더한 열(국비·지방비·자부담 등)을 열 이름 그대로 함께 적는다.
      if (source && customColumns.length) {
        const view = { ...source, amount: line.plan, spent: line.spent, balance: line.balance, custom: source.custom || {} };
        for (const column of customColumns) {
          const value = columnValueText(column, cellValueOf(view, column));
          if (value) extras.push(`${column.label} ${value}`);
        }
      }
    }
    if (!parts.length && row.count > 0) parts.push(`비목을 지정하지 않은 지출 ${row.count}건`);
    if (!parts.length && row.plan > 0) parts.push("세목 없이 편성한 예산");
    const trail = joinParts([
      hasExpense && row.spent ? `집행 ${formatWon(row.spent)}` : "",
      row.plan ? `잔액 ${formatWon(row.balance)}` : ""
    ]);
    const value = joinParts([parts.join(" / "), extras.join(" · "), trail]);
    if (value) push(section4, category, value);
  }
  if (!(ledger.rows || []).length) missing.push("소요 예산");
  if (hasExpense) {
    push(section4, "집행 현황", `편성 ${formatWon(ledger.total.plan)} / 집행 ${formatWon(ledger.total.spent)} / 잔액 ${formatWon(ledger.total.balance)}${ledger.total.plan ? ` (집행률 ${ledger.total.rate}%)` : ""}`);
  }

  /* ⑤ 회차 운영 — 회차·인원(적힌 값만) */
  const section5 = "회차 운영";
  if (sessions.length) {
    push(section5, "회차", joinParts([
      `전체 ${sessionStats.total}회`,
      sessionStats.done ? `완료 ${sessionStats.done}회` : "",
      sessionStats.planned ? `예정 ${sessionStats.planned}회` : "",
      sessionStats.cancelled ? `취소 ${sessionStats.cancelled}회` : ""
    ]));
  }
  if (attendance.tracked) {
    const capacity = sumKnown(sessions.filter((s) => s.status !== "cancelled" && s.trackAttendance === true).map((s) => s.capacity));
    const registered = sumKnown(sessions.filter((s) => s.status !== "cancelled" && s.trackAttendance === true).map((s) => s.registered));
    const attended = sumKnown(sessions.filter((s) => s.status !== "cancelled" && s.trackAttendance === true).map((s) => s.attended));
    const gaps = joinParts([
      sessionStats.missing.capacity ? `정원 미입력 ${sessionStats.missing.capacity}회` : "",
      sessionStats.missing.registered ? `신청 미입력 ${sessionStats.missing.registered}회` : "",
      sessionStats.missing.attended ? `참석 미입력 ${sessionStats.missing.attended}회` : ""
    ], ", ");
    const people = joinParts([
      capacity === null ? "" : `정원 ${capacity}명`,
      registered === null ? "" : `신청 ${registered}명`,
      attended === null ? "" : `참석 ${attended}명`
    ]);
    if (people) push(section5, "참여인원", `${people}${gaps ? ` (${gaps}는 합계에서 뺌)` : ""}`);
    if (attendance.untracked) note(section5, `인원 기록을 끈 ${attendance.untracked}회차는 집계 대상이 아님`);
  }
  const listedSessions = sessions.slice(0, MAX_SESSION_LINES);
  if (listedSessions.length) {
    const items = listedSessions.map((session) => joinParts([
      `${session.sequence}회차 ${dateTimeText(session.startAt)} ${inline(session.title, 40)}`.trim(),
      joinParts([
        session.venue ? `(${inline(session.venue, 30)})` : "",
        session.instructorName ? `강사 ${inline(session.instructorName, 30)}` : "",
        session.status === "cancelled" ? "취소" : session.status === "done" ? "완료" : "예정"
      ], " ")
    ], " "));
    const more = sessions.length > listedSessions.length ? ` 외 ${sessions.length - listedSessions.length}회차는 3단계 회차 화면에서 확인` : "";
    push(section5, "추진일정", items.join(" / ") + more);
  }

  /* ⑥ 사업 실적 — 결과보고·정산에 넣는 최신 수치 */
  const section6 = "사업 실적";
  if (attendance.tracked) {
    const base = `${attendance.attended}명 (완료 회차 ${attendance.attendedDone}명)`;
    const notes = joinParts([
      attendance.missingCount ? `참석을 적지 않은 ${attendance.missingCount}회차는 합계에서 뺌(0명으로 세지 않음)` : "",
      attendance.untracked ? `인원 기록을 끈 ${attendance.untracked}회차는 집계 제외` : ""
    ]);
    push(section6, "참석 연인원", notes ? `${base} · ${notes}` : base);
  } else if (sessions.length) {
    note(section6, "인원을 기록한 회차가 없습니다(0명이 아니라 집계 제외)");
  }
  if (ledger.evidence.total) {
    push(section6, "증빙", joinParts([
      `대상 ${ledger.evidence.total}건 중 ${ledger.evidence.checked}건 확인`,
      ledger.evidence.missing ? `미확인 ${ledger.evidence.missing}건(${formatWon(ledger.evidence.missingAmount)})` : ""
    ]));
  }
  const overRows = (ledger.rows || []).filter((row) => row.over).map((row) => text(row.category, 30));
  if (overRows.length) note(section6, `예산을 넘은 비목: ${overRows.join(", ")} — 집행 내역을 확인해 주세요.`);

  /* ⑦ 결과보고 — 써 둔 섹션 본문 */
  const reportSections = (Array.isArray(plan?.reportSections) ? plan.reportSections : [])
    .filter((section) => text(section?.content));
  for (const section of reportSections) {
    const title = inline(section.title, 60) || "제목 없음";
    for (const raw of String(section.content).replace(/\r\n?/g, "\n").split("\n")) {
      const line = raw.trim();
      if (line) lines.push({ section: `결과보고 · ${title}`, label: "", value: plain(line) });
    }
  }

  /* 글 조립 — 같은 section 이 바뀔 때만 구역 제목을 넣는다. */
  const chunks = [];
  let currentSection = "";
  for (const line of lines) {
    if (line.section !== currentSection) {
      currentSection = line.section;
      chunks.push(`■ ${currentSection}`);
    }
    chunks.push(line.label ? `${line.label}: ${line.value}` : line.value);
  }
  let output = chunks.join("\n").trim();
  let truncated = false;
  if (output.length > MAX_TEXT) {
    output = `${output.slice(0, MAX_TEXT).trim()}\n`;
    truncated = true;
  }

  return {
    text: output,
    lines,
    missing: output ? missing : [],
    counts: {
      lines: lines.length,
      budgetRows: (ledger.rows || []).length,
      budgetLines: budget.lineCount,
      expenses: ledger.expenseCount,
      sessions: sessions.length,
      reportSections: reportSections.length
    },
    truncated
  };
}

/* ────────────────────────── 예산 관리표 숫자만 ────────────────────────── */

/** 예산 숫자 블록의 첫 줄 — 다시 불러올 때 예전 블록을 찾는 표식이다. */
export const BUDGET_DIGEST_TITLE = "■ 예산 관리표";

/**
 * 예산 관리표(격자)의 숫자만 "라벨: 값" 줄로 만든다.
 * - 계획서·결과보고·정산 양식의 총사업비·집행액·잔액·비목 칸에 그대로 들어가게 하는 것이 목적이다.
 * - 숫자는 화면과 같은 계산 함수(budgetSummary·expenseSummary)에서만 가져온다.
 * @returns {{text:string, lines:Array<{label:string,value:string}>, counts:{lines:number,budgetLines:number,expenseCount:number}, missing:string[]}}
 */
export function buildBudgetDigestText({ plan, work } = {}) {
  const budget = budgetSummary(plan);
  const ledger = expenseSummary(work, plan);
  const lines = [];
  const push = (label, value) => {
    const safeLabel = inline(label, 24);
    const safeValue = inline(value);
    if (safeLabel && safeValue) lines.push({ label: safeLabel, value: safeValue });
  };
  const missing = [];

  const funding = budget.funding;
  const split = joinParts([
    funding.subsidy ? `국비 ${formatWon(funding.subsidy)}` : "",
    funding.local ? `지방비 ${formatWon(funding.local)}` : "",
    funding.self ? `자부담 ${formatWon(funding.self)}` : ""
  ], " · ");
  const planTotal = ledger.total.plan || budget.total;
  if (planTotal > 0) push("총사업비", `${formatWon(planTotal)}${split ? ` (${split})` : ""}`);
  else missing.push("총사업비");

  if (planTotal > 0) {
    push("편성 총액", formatWon(planTotal));
    push("집행액", formatWon(ledger.total.spent));
    push("잔액", formatWon(ledger.total.balance));
    push("집행률", `${ledger.total.rate}%`);
  } else {
    missing.push("집행액", "잔액", "집행률");
  }

  // 비목·세목 줄 — 양식의 비목별 금액 칸이 라벨로 찾을 수 있게 적는다.
  const basisById = new Map((Array.isArray(plan?.budgetLines) ? plan.budgetLines : []).map((line) => [String(line?.id ?? ""), line]));
  const columns = normalizeBudgetColumns(plan?.budgetColumns);
  const customColumns = rowColumnLines(columns);
  for (const row of ledger.rows || []) {
    const category = text(row.category, 40) || "비목 미지정";
    const parts = [];
    for (const line of row.lines || []) {
      const source = basisById.get(String(line.id ?? ""));
      const basis = text(source?.basis, 50) || joinParts([parseAmount(source?.unitCost) ? formatWon(parseAmount(source?.unitCost)) : "", source?.quantity ? `× ${text(source.quantity, 20)}` : ""], " ");
      parts.push(joinParts([text(line.item, 50) || category, basis ? `(${basis})` : "", line.plan ? formatWon(line.plan) : ""], " "));
      if (line.item) push(line.item, joinParts([line.plan ? formatWon(line.plan) : "", basis ? `(${basis})` : ""], " "));
      // 사용자가 바꾼 머리글·새로 더한 열은 그 이름 그대로 한 줄씩 적는다 —
      // 양식의 같은 이름 칸(예: 국비·지방비, 세부내용)이 행 순서대로 값을 받는다.
      if (source && customColumns.length) {
        const view = { ...source, amount: line.plan, spent: line.spent, balance: line.balance, custom: source.custom || {} };
        for (const column of customColumns) {
          const value = columnValueText(column, cellValueOf(view, column));
          if (value) push(column.label, value);
        }
      }
    }
    if (!parts.length && row.plan > 0) parts.push("세목 없이 편성한 예산 " + formatWon(row.plan));
    const trail = joinParts([
      ledger.expenseCount && row.spent ? `집행 ${formatWon(row.spent)}` : "",
      row.plan ? `잔액 ${formatWon(row.balance)}` : ""
    ]);
    if (parts.length) push(category, joinParts([parts.join(" / "), trail]));
  }
  if (!(ledger.rows || []).length && planTotal > 0) missing.push("비목별 금액");

  const chunks = [BUDGET_DIGEST_TITLE, ...lines.map((line) => `${line.label}: ${line.value}`)];
  return {
    text: chunks.join("\n"),
    lines,
    counts: { lines: lines.length, budgetLines: budget.lineCount, expenseCount: ledger.expenseCount },
    missing
  };
}

/**
 * 붙여넣기 글에서 예전 예산 관리표 블록을 걷어내고 새 블록을 넣는다.
 *  - 사용자가 쓴 다른 글은 그대로 둔다.
 *  - "■ 예산 관리표" 로 시작하는 구역만 지운다(여러 번 눌러도 쌓이지 않게).
 *  - position:"start" 면 예산 블록을 글 맨 앞에 둔다 — 양식 칸 배치에서 격자 숫자가 먼저 잡히게(합계 칸).
 * @returns {{text:string, removed:number, changed:boolean}}
 */
export function replaceDigestSection(existing, block, { position = "end" } = {}) {
  const current = String(existing ?? "");
  const next = String(block ?? "").trim();
  if (!next) return { text: current, removed: 0, changed: false };

  const kept = [];
  let removed = 0;
  let dropping = false;
  for (const line of current.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^■\s*/.test(line)) {
      dropping = line.trim().startsWith(BUDGET_DIGEST_TITLE);
      if (dropping) {
        removed += 1;
        continue;
      }
    }
    if (!dropping) kept.push(line);
  }
  const head = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const text = head ? (position === "start" ? `${next}\n\n${head}` : `${head}\n\n${next}`) : next;
  return { text, removed, changed: text !== current };
}

/* ────────────────────────── 지문(중복·최신 여부) ────────────────────────── */

/** 글 자체의 지문 — 값이 하나라도 바뀌면 달라진다. 불러온 뒤 사업 데이터가 바뀌었는지 비교한다. */
export function textSignature(value) {
  const source = String(value ?? "");
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 33) ^ source.charCodeAt(index)) >>> 0;
  }
  return `${hash.toString(36)}-${source.length}`;
}

export function projectDataSignature({ meta, plan, work, project } = {}) {
  return textSignature(buildProjectDataText({ meta, plan, work, project }).text);
}

/* ────────────────────────── 붙여넣기 글에 합치기 ────────────────────────── */

/**
 * 이미 붙여넣은 글을 지키면서 사업 데이터 글을 넣는다.
 *  - 글이 비어 있으면 그대로 넣는다(확인 필요 없음).
 *  - 앞서 불러온 블록이 글 끝에 그대로 남아 있으면 그 블록만 새 값으로 바꾼다(중복 없이 최신화).
 *  - 사용자가 쓴 다른 글이 있으면 뒤에 이어 붙이되, 덮어쓰기가 아니라는 확인을 받도록 needsConfirm을 세운다.
 * @returns {{text:string, mode:"empty"|"refresh"|"append", needsConfirm:boolean, changed:boolean}}
 */
export function mergeDigestIntoText({ existing, block, previousBlock } = {}) {
  const current = String(existing ?? "");
  const next = String(block ?? "").trim();
  if (!next) return { text: current, mode: "empty", needsConfirm: false, changed: false };
  if (!current.trim()) return { text: next, mode: "empty", needsConfirm: false, changed: true };

  const previous = String(previousBlock ?? "").trim();
  if (previous && current.trimEnd().endsWith(previous)) {
    const head = current.trimEnd().slice(0, current.trimEnd().length - previous.length).trimEnd();
    const merged = head ? `${head}\n\n${next}` : next;
    return { text: merged, mode: "refresh", needsConfirm: false, changed: merged !== current };
  }

  return { text: `${current.trimEnd()}\n\n${next}`, mode: "append", needsConfirm: true, changed: true };
}

/** ISO 시각 → "11월 16일 01:54" (읽을 수 없으면 빈칸). */
function stampText(value) {
  const stamp = new Date(String(value ?? ""));
  if (Number.isNaN(stamp.getTime())) return "";
  const month = stamp.getMonth() + 1;
  const day = stamp.getDate();
  const hour = String(stamp.getHours()).padStart(2, "0");
  const minute = String(stamp.getMinutes()).padStart(2, "0");
  return `${month}월 ${day}일 ${hour}:${minute}`;
}

/** 사업 전환 시 다른 사업의 양식 채우기 상태를 들고 가지 않는지 확인할 때 쓰는 키. */
export function digestLoadedNote({ loadedAt, counts, missing, truncated } = {}) {
  const when = stampText(loadedAt);
  const parts = [];
  if (counts && typeof counts === "object") {
    if (counts.lines) parts.push(`${counts.lines}줄`);
    if (counts.budgetRows) parts.push(`비목 ${counts.budgetRows}개`);
    if (counts.sessions) parts.push(`회차 ${counts.sessions}개`);
    if (counts.expenses) parts.push(`지출 ${counts.expenses}건`);
    if (counts.reportSections) parts.push(`결과보고 ${counts.reportSections}개 섹션`);
  }
  const head = when ? `${when}에 이 사업에서 불러옴` : "이 사업에서 불러옴";
  const gaps = Array.isArray(missing) && missing.length ? ` · 비어 있어 넣지 않은 항목: ${missing.join(", ")}` : "";
  const cut = truncated ? " · 길이 제한으로 뒤쪽 일부를 줄였습니다" : "";
  return `${head}${parts.length ? ` (${parts.join(" · ")})` : ""}${gaps}${cut}`;
}
