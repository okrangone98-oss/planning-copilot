// 올해 추진계획서(.hwpx)에서 재료 글을 뽑는 추출기.
//
// 결과보고서 양식은 "사업명 · 기간 · 참석 인원 · 집행액 · 주요 내용"처럼 계획서와 이름이 겹치는 칸이 많다.
// 그래서 계획서 .hwpx를 올리면 ZIP 안 Contents/section*.xml 의 문단·표를 읽어
// "라벨: 값" 줄로 펴서 2단계(자료 붙여넣기) 글에 이어 붙인다. 사용자가 쓴 글은 지우지 않는다.
//
// 원칙:
//  - 읽는 일은 브라우저 안에서만 한다(원본 파일은 고치지 않는다).
//  - 계획서의 숫자는 계획값이다. 실적 칸에 그대로 넣지 않도록 화면에서 그 사실을 밝힌다(notes).
//  - 읽지 못한 형식(.hwp 바이너리 등)은 추측하지 않고 할 일을 알려 준다.

import { readHwpxBlocks } from "./sampleTemplateParser.mjs";
import { isBlankValueCell, isFormLabelCell, normalizeFormLabel } from "./kordocFormSpec.mjs";

/** 2단계 ‘재료 파일’에서 계획서로 받는 확장자 */
export const PLAN_SOURCE_ACCEPT = ".hwpx";
export const PLAN_SOURCE_MAX_CHARS = 12000;
export const PLAN_SOURCE_MAX_LINES = 220;

export const PLAN_SOURCE_HINT =
  "올해 추진계획서(.hwpx)를 올리면 사업명·기간·비목별 예산·추진 일정 같은 라벨과 값을 읽어 2단계 글 뒤에 이어 붙입니다. 이미 쓴 글은 지우지 않습니다.";

export const PLAN_SOURCE_LEGACY_HINT =
  "구형 .hwp(바이너리) 계획서는 브라우저에서 표 구조를 읽을 수 없습니다. 한글에서 ‘다른 이름으로 저장 → HWPX’로 저장해 올리거나, 계획서 내용을 복사해 붙여넣어 주세요.";

export const PLAN_SOURCE_EMPTY_HINT =
  "계획서에서 값이 적힌 칸을 찾지 못했습니다. 빈 계획서 양식이거나 글자만 있는 문서일 수 있습니다. 계획서 내용을 복사해 붙여넣는 쪽이 빠릅니다.";

/** 계획서 안의 안내문 — 재료로 옮기면 칸 배치에 방해가 되므로 뺀다. */
const GUIDE_LINE_RE = /^(?:※|＊|\*\s*\(?\s*작성|\(\s*작성\s*(?:요령|방법|기준|예시|안내)|작성\s*(?:요령|방법|기준|예시)\s*[:：]|◦\s*유의)/;

const BUDGET_HEADERS = /^(비목|예산비목|항목|구분|세목|재원)$/;
const BASIS_HEADERS = /(산출|내역|세부|금액|단가|수량|비율|구성)/;
const SCHEDULE_HEADERS = /(일정|기간|월|시기|날짜|일자|추진일정)/;
const DATE_IN_TEXT_RE = /20\d{2}\s*[.\-/년]\s*\d{1,2}|\d{1,2}\s*월\s*(?:~\s*)?\d{1,2}?\s*월?|\d{1,2}\s*분기/;

function clean(value, max = 400) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function cleanBlock(value, max = 2000) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 머리글 이름이 ‘라벨 | 값’ 표인지 — 첫 열이 라벨 낱말이면 라벨·값 표로 본다. */
function isLabelValueTable(headers) {
  if (!Array.isArray(headers) || headers.length !== 2) return false;
  const first = String(headers[0] ?? "").trim();
  const second = String(headers[1] ?? "").trim();
  if (!first || !second) return false;
  return isFormLabelCell(first) || /내용|값|비고|세부/.test(second);
}

function joinCells(cells, from = 0) {
  return (Array.isArray(cells) ? cells : [])
    .slice(from)
    .map((cell) => clean(cell, 300))
    .filter(Boolean)
    .join(" · ");
}

/**
 * 블록(문단·표)을 재료 줄로 편다.
 * @returns {{lines: Array<{kind: string, label: string, value: string, section: string}>, counts: object}}
 */
export function planSourceLines(blocks) {
  const lines = [];
  const seen = new Set();
  const counts = { paragraphs: 0, tables: 0, labels: 0, budgetLines: 0, scheduleLines: 0, skipped: 0 };
  let section = "";

  const push = (line) => {
    const value = String(line.value ?? "").trim();
    if (!value) return false;
    const key = `${line.kind}|${normalizeFormLabel(line.label || "")}|${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    lines.push({ kind: line.kind, label: String(line.label ?? "").trim(), value: cleanBlock(value), section });
    return true;
  };

  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "heading") {
      const title = clean(block.title ?? block.text, 120);
      if (!title) continue;
      section = title;
      push({ kind: "heading", label: "", value: title });
      continue;
    }

    if (block.type === "paragraph" || block.type === "list") {
      const raw = cleanBlock(block.text ?? "", 2000);
      if (!raw) continue;
      if (GUIDE_LINE_RE.test(raw)) {
        counts.skipped += 1;
        continue;
      }
      // “사업명 : ○○” 처럼 한 줄에 라벨이 있으면 라벨·값으로 나눠 둔다.
      const labelled = [...raw.matchAll(/((?:[가-힣]{1,6}\s)?[가-힣A-Za-z][가-힣A-Za-z0-9·]{1,11})\s*[:：]/g)]
        .filter((match) => isFormLabelCell(match[1].trim()));
      if (labelled.length === 1) {
        const match = labelled[0];
        const label = match[1].trim();
        const value = raw.slice(match.index + match[0].length).trim();
        if (value) {
          counts.paragraphs += 1;
          if (push({ kind: "label", label, value })) counts.labels += 1;
          continue;
        }
      }
      counts.paragraphs += 1;
      push({ kind: "body", label: "", value: raw });
      continue;
    }

    if (block.type !== "table") continue;
    counts.tables += 1;
    const headers = (block.headers || []).map((header) => clean(header, 60));
    const rows = (block.rows || []).filter((row) => Array.isArray(row));

    // ① 머리글이 ‘라벨 | 값’인 표 — 행마다 라벨: 값
    const labelValueTable = isLabelValueTable(headers);
    const budgetTable = headers.length >= 2 && BUDGET_HEADERS.test(headers[0] || "") && BASIS_HEADERS.test(headers[1] || "");
    const scheduleTable = headers.some((header) => SCHEDULE_HEADERS.test(header));

    for (const row of rows) {
      const cells = row.map((cell) => clean(cell, 300));
      const filled = cells.filter(Boolean);
      if (!filled.length) continue;

      if (labelValueTable) {
        const label = cells[0];
        const value = joinCells(cells, 1);
        // 값이 비어 있는 칸(빈 양식)은 재료가 아니다.
        if (!label || !value || isBlankValueCell(value)) continue;
        if (GUIDE_LINE_RE.test(value)) {
          counts.skipped += 1;
          continue;
        }
        if (push({ kind: "label", label, value })) counts.labels += 1;
        continue;
      }

      if (budgetTable) {
        const category = cells[0];
        const value = joinCells(cells, 1);
        if (!category || !value) continue;
        if (push({ kind: "budget", label: category, value })) counts.budgetLines += 1;
        continue;
      }

      if (scheduleTable && filled.some((cell) => DATE_IN_TEXT_RE.test(cell))) {
        const label = cells.find((cell) => cell && !DATE_IN_TEXT_RE.test(cell)) || cells[0];
        const value = cells.filter((cell) => cell && cell !== label).join(" · ");
        if (!value) continue;
        if (push({ kind: "schedule", label: label || "일정", value })) counts.scheduleLines += 1;
        continue;
      }

      // ③ 그 밖의 표 — 첫 칸이 라벨 같으면 라벨: 값, 아니면 한 줄로 적는다.
      const label = cells[0];
      const rest = joinCells(cells, 1);
      if (label && rest && isFormLabelCell(label) && !isBlankValueCell(rest)) {
        if (push({ kind: "label", label, value: rest })) counts.labels += 1;
        continue;
      }
      if (filled.length >= 2) {
        if (push({ kind: "body", label: headers[0] === "구분" ? "" : headers[0] || "", value: filled.join(" · ") })) counts.paragraphs += 1;
      }
    }
  }

  const limited = lines.slice(0, PLAN_SOURCE_MAX_LINES);
  return {
    lines: limited,
    counts: { ...counts, total: limited.length, truncated: lines.length > limited.length }
  };
}

/** 재료 줄을 2단계에 붙일 글자로 만든다. 구역 제목은 ■ 로 표시해 자유 텍스트 나누기가 제목으로 읽게 한다. */
export function planSourceMaterialText({ lines, fileName = "", truncated = false } = {}) {
  const source = Array.isArray(lines) ? lines : [];
  if (!source.length) return "";
  const out = [`■ 올해 추진계획서${fileName ? ` (${fileName})` : ""}`];
  let current = "";
  for (const line of source) {
    if (line.kind === "heading") {
      current = line.value;
      out.push(`## ${line.value}`);
      continue;
    }
    if (line.section && line.section !== current && line.kind === "label") {
      // 표·문단 라벨은 구역 제목 아래에 모아 둔다 — 칸 배치가 구역을 참고한다.
      out.push(`## ${line.section}`);
      current = line.section;
    }
    if (line.kind === "label" || line.kind === "budget" || line.kind === "schedule") {
      out.push(line.label ? `${line.label}: ${line.value}` : line.value);
      continue;
    }
    out.push(line.value);
  }
  let text = out.join("\n").trim();
  if (text.length > PLAN_SOURCE_MAX_CHARS) text = `${text.slice(0, PLAN_SOURCE_MAX_CHARS).trim()}\n…(길이 제한으로 뒤쪽 생략)`;
  else if (truncated) text = `${text}\n…(줄 수 제한으로 뒤쪽 생략)`;
  return text;
}

/**
 * 올해 추진계획서 .hwpx bytes → 재료.
 * @param {{bytes?: Uint8Array|ArrayBuffer, fileName?: string, jszip?: unknown}} input
 */
export async function extractPlanSource({ bytes, fileName = "", jszip } = {}) {
  const name = String(fileName || "").trim();
  const lower = name.toLowerCase();
  const empty = {
    ok: false,
    fileName: name,
    text: "",
    lines: [],
    counts: { paragraphs: 0, tables: 0, labels: 0, budgetLines: 0, scheduleLines: 0, skipped: 0, total: 0, truncated: false },
    notes: [],
    warning: ""
  };

  if (lower.endsWith(".hwp") && !lower.endsWith(".hwpx")) {
    return { ...empty, warning: PLAN_SOURCE_LEGACY_HINT };
  }
  if (name && !lower.endsWith(".hwpx")) {
    return { ...empty, warning: "올해 추진계획서는 .hwpx 파일로 올려 주세요. CSV·엑셀은 아래 출석·지출 자료에 넣으면 됩니다." };
  }

  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!input.length) return { ...empty, warning: "계획서 파일을 읽지 못했습니다. 파일을 다시 골라 주세요." };

  let zip;
  try {
    const JSZip = jszip || (await import("jszip")).default;
    zip = await JSZip.loadAsync(input);
  } catch {
    return {
      ...empty,
      warning: "올린 파일이 .hwpx 형식으로 열리지 않았습니다. 한글에서 ‘다른 이름으로 저장 → HWPX’로 저장해 다시 올려 주세요."
    };
  }

  let blocks = [];
  try {
    blocks = await readHwpxBlocks(zip);
  } catch {
    return { ...empty, warning: "계획서 본문(Contents/section*.xml)을 읽지 못했습니다. 파일이 손상되었는지 확인해 주세요." };
  }

  const { lines, counts } = planSourceLines(blocks);
  const text = planSourceMaterialText({ lines, fileName: name, truncated: counts.truncated });
  if (!text) return { ...empty, counts, warning: PLAN_SOURCE_EMPTY_HINT };

  const notes = [
    "계획서에서 읽은 숫자는 계획값입니다. 실적 칸(참석 인원·집행액)은 출석·지출 자료의 값을 쓰세요."
  ];
  if (counts.truncated) notes.push("계획서가 길어 앞부분만 넣었습니다. 뒤쪽 내용은 직접 붙여넣어 주세요.");

  return {
    ok: true,
    fileName: name,
    text,
    lines,
    counts,
    notes,
    warning: ""
  };
}

/** 재료 글을 붙일 때 이미 있는 글과 같은 구역이면 중복을 만들지 않는다. */
export function appendMaterialText({ existing = "", block = "", heading = "" } = {}) {
  const current = String(existing ?? "").trim();
  const addition = String(block ?? "").trim();
  if (!addition) return { text: current, mode: "empty", added: false };
  if (!current) return { text: addition, mode: "empty", added: true };
  // 같은 머리글(■ …)이 이미 있으면 그 구역만 새 내용으로 바꾼다 — 계획서를 다시 올렸을 때 중복이 쌓이지 않게.
  const marker = String(heading || "").trim() || addition.split("\n")[0].trim();
  if (marker && current.includes(marker)) {
    const start = current.indexOf(marker);
    const before = current.slice(0, start).trimEnd();
    const afterIndex = findNextBlockStart(current, start + marker.length);
    const after = afterIndex >= 0 ? current.slice(afterIndex).trim() : "";
    const merged = [before, addition, after].filter(Boolean).join("\n\n");
    return { text: merged, mode: "refresh", added: true };
  }
  return { text: `${current}\n\n${addition}`, mode: "append", added: true };
}

/** 다음 ‘■’ 블록이 시작하는 위치 — 앞서 넣은 블록만 새 값으로 바꾸기 위해서. */
function findNextBlockStart(text, from) {
  const index = text.indexOf("\n■", from);
  return index >= 0 ? index + 1 : -1;
}
