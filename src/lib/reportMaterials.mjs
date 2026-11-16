// 결과보고 재료 — 출석·지출 엑셀(CSV/TSV)과 활동사진 파일명을 재료 글로 바꾼다.
//
// 결과보고서에 꼭 들어가는 것은 세 가지다: 참석 인원, 집행액, 활동 사진 증빙.
// 출석부·지출 내역은 시트에서 CSV/TSV로 저장(또는 복사)해 올리면 행을 세어
// "참석 인원: nn명", "집행액: n,nnn원" 꼴의 재료 줄을 만들고,
// 활동사진은 파일 이름만으로 "사진 캡션" 줄을 만들어 2단계 재료에 이어 붙인다.
//
// 원칙:
//  - 읽지 못한 줄은 조용히 버리지 않고 warnings 로 남긴다.
//  - 세어 낸 값이 사실인지는 사람이 확인해야 하므로, 어디까지 읽었는지 note 로 밝힌다.
//  - 사진 파일은 이 앱 안에서 .hwpx 그림으로 넣지 않는다(한컴오피스에서 넣기 안내).

import { detectDelimiter } from "./budgetImport.mjs";
import { formatWon, parseAmount } from "./grantWorkflow.mjs";
import { normalizeSpentAt, readExpenseStatus } from "./expenseImport.mjs";

export const MATERIALS_ACCEPT = ".csv,.tsv,.txt";
export const PHOTO_ACCEPT = "image/*";

export const MATERIALS_HINT =
  "출석현황·지출내역을 CSV/TSV 파일이나 시트에서 복사한 표로 올리면 참석 인원·집행액을 세어 재료로 넣습니다. 첫 줄에 날짜·인원(또는 적요·금액) 같은 머리글이 있으면 정확히 읽힙니다.";

export const PHOTO_HINT =
  "활동사진은 파일 이름·촬영 날짜·활동 내용을 읽어 사진 캡션 줄을 만들어 결과보고서의 사진·증빙 칸에 넣습니다. 사진 파일 자체를 .hwpx 안에 넣지는 못하니, 내려받은 문서를 한컴오피스에서 열어 ‘입력 → 그림’으로 같은 자리에 넣어 주세요.";

const MAX_ROWS = 600;

function cleanCell(value, max = 120) {
  return String(value ?? "").replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function splitRow(line, delimiter) {
  if (delimiter === "\t") return line.split("\t");
  if (delimiter === "|") {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
    return trimmed.split("|");
  }
  return parseCsvLine(line);
}

/** 따옴표로 감싼 칸을 지키는 CSV 한 줄 파서 */
function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === "\"") {
        if (line[index + 1] === "\"") {
          current += "\"";
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" && current.trim() === "") {
      quoted = true;
      current = "";
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function isSeparatorRow(cells) {
  const filled = cells.filter((cell) => cell.trim());
  return filled.length > 0 && filled.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function normalizeHeader(value) {
  return cleanCell(value).replace(/[\s()（）[{}:：·]/g, "").toLowerCase();
}

const COUNT_WORDS = ["인원", "참석", "참석인원", "참가", "참가인원", "출석", "출석인원", "참여", "참여인원", "인원수", "참석자", "참석자수", "count", "attendance"];
const DATE_WORDS = ["일자", "날짜", "date", "일시", "사용일자"];
const SPEND_WORDS = ["금액", "지출액", "집행액", "사용금액", "결제금액", "amount", "비용", "집행금액"];
const DESC_WORDS = ["적요", "내역", "사용내역", "지출내역", "내용", "품명", "description", "활동", "활동내용", "프로그램", "memo"];
const CATEGORY_WORDS = ["비목", "예산비목", "구분", "항목", "분류", "category"];

function findColumn(headers, words) {
  for (const word of words) {
    const index = headers.findIndex((header) => header === word);
    if (index >= 0) return index;
  }
  for (const word of words) {
    if (word.length < 2) continue;
    const index = headers.findIndex((header) => header.includes(word));
    if (index >= 0) return index;
  }
  return -1;
}

function numberIn(value) {
  const text = String(value ?? "").replace(/[, \u00a0]/g, "").trim();
  if (!text) return null;
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 출석현황 표(CSV/TSV/붙여넣기)를 읽어 인원을 센다.
 * 머리글에 ‘일자’와 ‘인원’ 계열이 있으면 인원 합계를, 회차별 줄도 남긴다.
 * @returns {{kind:"attendance", total:number|null, rows:number, line:string, perSession:string[], warnings:string[], hadHeader:boolean}}
 */
export function parseAttendanceMaterial(text, options = {}) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const delimiter = options.delimiter || detectDelimiter(raw);
  const warnings = [];
  const lines = raw.split("\n").filter((line) => line.trim());
  if (!lines.length) {
    return { kind: "attendance", total: null, rows: 0, line: "", perSession: [], warnings: ["내용이 비어 있습니다."], hadHeader: false, delimiter };
  }

  let mapping = null;
  let hadHeader = false;
  const perSession = [];
  let total = null;
  let rows = 0;

  lines.forEach((rawLine, lineIndex) => {
    const cells = splitRow(rawLine, delimiter).map((cell) => cleanCell(cell));
    if (isSeparatorRow(cells) || cells.every((cell) => !cell)) return;

    if (!mapping && lineIndex <= 1) {
      const headers = cells.map((cell) => normalizeHeader(cell));
      const dateIndex = findColumn(headers, DATE_WORDS);
      const countIndex = findColumn(headers, COUNT_WORDS);
      if (dateIndex >= 0 && countIndex >= 0) {
        mapping = { dateIndex, countIndex, descIndex: findColumn(headers, DESC_WORDS) };
        hadHeader = true;
        return;
      }
    }

    const dateIndex = mapping ? mapping.dateIndex : 0;
    const countIndex = mapping ? mapping.countIndex : Math.min(1, cells.length - 1);
    const date = cleanCell(cells[dateIndex]);
    const countValue = numberIn(cells[countIndex]);
    if (countValue === null) {
      warnings.push(`${lineIndex + 1}번째 줄의 인원을 숫자로 읽지 못했습니다.`);
      return;
    }
    rows += 1;
    total = (total === null ? 0 : total) + countValue;
    const desc = mapping && mapping.descIndex >= 0 ? cleanCell(cells[mapping.descIndex]) : "";
    const label = date || desc || `${rows}회차`;
    perSession.push(`${label} ${countValue}명`);
  });

  if (!hadHeader && rows) {
    warnings.push("머리글을 찾지 못해 첫 열을 날짜(또는 회차), 다음 열을 인원으로 읽었습니다.");
  }
  if (!rows) {
    warnings.push("인원으로 읽을 숫자가 없습니다. 첫 줄에 ‘일자 | 인원’ 머리글을 넣어 주세요.");
    return { kind: "attendance", total: null, rows: 0, line: "", perSession: [], warnings, hadHeader, delimiter };
  }

  const summary = perSession.slice(0, 8).join(" · ");
  const more = perSession.length > 8 ? ` 외 ${perSession.length - 8}회` : "";
  const line = `참석 인원: 총 ${total}명 (회차 ${rows}회${summary ? ` · ${summary}${more}` : ""})`;
  return { kind: "attendance", total, rows, line, perSession, warnings, hadHeader, delimiter };
}

/**
 * 지출내역 표(CSV/TSV/붙여넣기)를 읽어 집행액을 센다.
 * @returns {{kind:"expense", total:number, rows:number, line:string, byCategory:Array<{category:string,total:number}>, dates:{min:string,max:string}, warnings:string[], hadHeader:boolean}}
 */
export function parseExpenseMaterial(text, options = {}) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const delimiter = options.delimiter || detectDelimiter(raw);
  const warnings = [];
  const lines = raw.split("\n").filter((line) => line.trim());
  if (!lines.length) {
    return { kind: "expense", total: null, rows: 0, line: "", byCategory: [], dates: { min: "", max: "" }, warnings: ["내용이 비어 있습니다."], hadHeader: false, delimiter };
  }

  let mapping = null;
  let hadHeader = false;
  let total = 0;
  let rows = 0;
  const byCategory = new Map();
  const dates = [];

  lines.forEach((rawLine, lineIndex) => {
    const cells = splitRow(rawLine, delimiter).map((cell) => cleanCell(cell));
    if (isSeparatorRow(cells) || cells.every((cell) => !cell)) return;

    if (!mapping && lineIndex <= 1) {
      const headers = cells.map((cell) => normalizeHeader(cell));
      const descIndex = findColumn(headers, DESC_WORDS);
      const amountIndex = findColumn(headers, SPEND_WORDS);
      if (descIndex >= 0 && amountIndex >= 0) {
        mapping = {
          descIndex,
          amountIndex,
          dateIndex: findColumn(headers, DATE_WORDS),
          categoryIndex: findColumn(headers, CATEGORY_WORDS)
        };
        hadHeader = true;
        return;
      }
    }

    const descIndex = mapping ? mapping.descIndex : 0;
    const amountIndex = mapping ? mapping.amountIndex : Math.min(cells.length - 1, 3);
    const amount = parseAmount(cells[amountIndex]);
    if (!amount) {
      if (cells[descIndex] || cells.length > 1) {
        warnings.push(`${lineIndex + 1}번째 줄의 금액을 숫자로 읽지 못해 건너뛰었습니다.`);
      }
      return;
    }
    rows += 1;
    total += amount;
    const category = mapping && mapping.categoryIndex >= 0 ? cleanCell(cells[mapping.categoryIndex]) : "";
    if (category) byCategory.set(category, (byCategory.get(category) || 0) + amount);
    if (mapping && mapping.dateIndex >= 0) {
      const spentAt = normalizeSpentAt(cells[mapping.dateIndex]);
      if (spentAt) dates.push(spentAt);
    }
  });

  if (!rows) {
    warnings.push("지출로 읽을 행이 없습니다. 첫 줄에 ‘적요 | 금액’ 같은 머리글을 넣어 주세요.");
    return { kind: "expense", total: null, rows: 0, line: "", byCategory: [], dates: { min: "", max: "" }, warnings, hadHeader, delimiter };
  }
  if (!hadHeader) warnings.push("머리글이 없어 첫 열을 적요, 마지막 열을 금액으로 읽었습니다.");

  dates.sort();
  const parts = [`집행액: 총 ${formatWon(total)}`];
  if (dates.length) parts.push(`지출 기간 ${dates[0]} ~ ${dates[dates.length - 1]}`);
  if (byCategory.size) {
    const categories = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([category, amount]) => `${category} ${formatWon(amount)}`);
    parts.push(`비목별 ${categories.join(" · ")}${byCategory.size > 6 ? " 외" : ""}`);
  }
  const line = parts.join(" · ");
  return {
    kind: "expense",
    total,
    rows,
    line,
    byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount })),
    dates: { min: dates[0] || "", max: dates[dates.length - 1] || "" },
    warnings,
    hadHeader,
    delimiter
  };
}

/**
 * 올린 재료가 출석 표인지 지출 표인지 자동으로 골라 읽는다.
 * 머리글에 인원 계열이 있으면 출석, 금액 계열이 있으면 지출.
 */
export function parseSpreadsheetMaterial(text, options = {}) {
  const raw = String(text ?? "").replace(/\r\n/g, "\n");
  const firstLines = raw.split("\n").filter((line) => line.trim()).slice(0, 2);
  const headers = firstLines.length
    ? splitRow(firstLines[0], options.delimiter || detectDelimiter(raw)).map((cell) => normalizeHeader(cell))
    : [];
  const hasCount = findColumn(headers, COUNT_WORDS) >= 0;
  const hasSpend = findColumn(headers, SPEND_WORDS) >= 0;
  const hasDesc = findColumn(headers, DESC_WORDS) >= 0;
  if (hasSpend && (hasDesc || !hasCount)) {
    const parsed = parseExpenseMaterial(raw, options);
    if (parsed.rows) return parsed;
  }
  if (hasCount) {
    const parsed = parseAttendanceMaterial(raw, options);
    if (parsed.rows) return parsed;
  }
  const attendance = parseAttendanceMaterial(raw, options);
  if (attendance.rows) return attendance;
  return parseExpenseMaterial(raw, options);
}

/** 재료 결과를 2단계에 붙일 글로 모은다. */
export function materialsToText(results, { title = "출석·지출 자료" } = {}) {
  const list = (Array.isArray(results) ? results : []).filter((item) => item && item.line);
  if (!list.length) return "";
  const out = [`■ ${title}`];
  for (const item of list) out.push(item.line);
  return out.join("\n");
}

/* ────────────────────────── 활동사진 캡션 ────────────────────────── */

/** 사진 파일 이름에서 날짜를 읽는다 — IMG_20260302_1412.jpg · 2026-03-02 회의.jpg · 20260302.jpg */
export function dateFromPhotoName(name) {
  const text = String(name ?? "");
  const compact = /20(\d{2})(\d{2})(\d{2})/.exec(text.replace(/\D/g, " ").trim());
  const stamp = /(?:^|[^0-9])((?:20\d{2})[._\-]?(0[1-9]|1[0-2])[._\-]?(0[1-9]|[12]\d|3[01]))[^0-9]/.exec(text);
  if (stamp) {
    const iso = normalizeSpentAt(`${stamp[1].replace(/[._-]/g, "-")}`);
    if (iso) return iso;
  }
  if (compact) {
    const iso = normalizeSpentAt(`20${compact[1]}-${compact[2]}-${compact[3]}`);
    if (iso) return iso;
  }
  return "";
}

/** 사진 파일 이름에서 확장자·번호·IMG_ 같은 접두를 떼고 활동 이름으로 쓸 글자를 만든다. */
export function titleFromPhotoName(name) {
  const base = String(name ?? "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return "";
  const cleaned = base
    .replace(/\b(?:img|image|photo|dsc|dscn|pxl|mvimg)\b/gi, " ")
    .replace(/\b\d{2,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || base;
}

/**
 * 활동사진 파일 목록 → 사진 캡션 줄.
 * @param {Array<{name: string, lastModified?: number}>} photos
 * @returns {{lines: Array<{fileName:string, date:string, title:string, caption:string}>, text: string, warnings: string[]}}
 */
export function photoCaptions(photos) {
  const list = (Array.isArray(photos) ? photos : [])
    .map((photo) => (typeof photo === "string" ? { name: photo } : photo))
    .filter((photo) => photo && photo.name);
  const lines = [];
  const warnings = [];
  for (const photo of list.slice(0, 60)) {
    const fileName = String(photo.name).trim();
    if (!fileName) continue;
    let date = dateFromPhotoName(fileName);
    if (!date && photo.lastModified) {
      try {
        date = new Date(photo.lastModified).toISOString().slice(0, 10);
      } catch {
        date = "";
      }
    }
    const title = titleFromPhotoName(fileName);
    // 카메라 기본 이름(IMG_1234 · DSC04231)은 활동 내용이 담긴 이름이 아니다 — 캡션은 만들되 사람이 고칠 자리로 남긴다.
    const generic = /^\d*$/.test(title.replace(/\s/g, "")) || /^(?:img|image|photo|dsc|dscn|pxl|mvimg)\s*\d*$/i.test(title);
    if (!date || generic) {
      warnings.push(`‘${fileName}’의 ${!date ? "날짜를 ": "활동 내용을 "}파일 이름에서 읽지 못했습니다. 캡션에서 직접 고쳐 주세요.`);
    }
    lines.push({
      fileName,
      date,
      title,
      caption: `${date || "날짜 미확인"} — ${title || "활동 사진"} (${fileName})`
    });
  }
  const text = lines.length
    ? ["■ 활동사진 증빙", ...lines.map((line) => `사진: ${line.caption}`)].join("\n")
    : "";
  return { lines, text, warnings };
}

/** 재료 개수 요약 — 화면 배지에 쓴다. */
export function summarizeMaterials({ plan = null, spreadsheet = null, photos = null } = {}) {
  const counts = { plan: plan?.counts?.total || 0, attendance: spreadsheet?.kind === "attendance" ? spreadsheet.rows : 0, expense: spreadsheet?.kind === "expense" ? spreadsheet.rows : 0, photos: photos?.lines?.length || 0 };
  return { counts, total: counts.plan + counts.attendance + counts.expense + counts.photos };
}
