// 샘플 문서 양식 구조 파서.
// kordoc(chrisryugj/kordoc, MIT)의 IRBlock 개념을 브라우저에서 그대로 쓸 수 있는 범위로 옮긴 구현이다.
// 문서 → 블록(IR: heading/paragraph/list/table) → 양식 스키마(섹션·표·작성 슬롯) → 미리보기·프롬프트·규칙 기반 채우기.
// kordoc 본체(HWP5 OLE2·OCR·병합 셀 복원)는 Node/로컬 런타임이 필요하므로 1단계(웹 단독)에서는 쓰지 않는다.

export const HWP_BINARY_GUIDANCE =
  "구형 .hwp(바이너리) 파일은 브라우저에서 구조를 직접 읽을 수 없습니다. 한글에서 ‘파일 → 다른 이름으로 저장’으로 HWPX로 저장하거나 DOCX·PDF로 변환해 올려 주세요. 로컬 kordoc 연동은 다음 단계에서 붙일 수 있습니다.";

export const UNSUPPORTED_FORMAT_GUIDANCE =
  "지원하는 양식 파일은 HWPX, DOCX, PDF, MD, TXT, CSV, HTML입니다. 다른 형식은 위 형식으로 저장해 올리거나 문서 내용을 붙여넣어 주세요.";

export const SUPPORTED_SAMPLE_FORMATS = ["hwpx", "docx", "pdf", "markdown", "text", "html", "csv"];

export const SAMPLE_ACCEPT = ".hwpx,.docx,.pdf,.md,.markdown,.txt,.csv,.html,.htm,.hwp";

const MAX_BLOCKS = 4000;
const MAX_SECTIONS = 200;
const MAX_TABLES = 60;
const MAX_TABLE_ROWS = 60;
const MAX_TABLE_COLUMNS = 12;
const MAX_TEXT_SLOTS = 120;
const MAX_CELL_SLOTS = 160;
const MAX_LABEL = 90;
const OUTLINE_MAX_CHARS = 7000;

const PROFILE_LIMIT = 2000;

/** 파일 이름으로 문서 형식을 고른다. `.hwp`와 `.hwpx`를 헷갈리지 않게 확장자 전체로 비교한다. */
export function documentFormatOf(fileName) {
  const name = String(fileName || "").trim().toLowerCase();
  if (!name) return "unknown";
  if (name.endsWith(".hwpx")) return "hwpx";
  if (name.endsWith(".hwp")) return "hwp";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "markdown";
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (name.endsWith(".txt")) return "text";
  return "unknown";
}

/** 업로드한 파일을 양식으로 읽을 수 있는지, 못 읽으면 무엇을 하면 되는지 알려 준다. */
export function describeSampleSupport(fileName) {
  const format = documentFormatOf(fileName);
  if (format === "hwp") return { supported: false, format, message: HWP_BINARY_GUIDANCE };
  if (SUPPORTED_SAMPLE_FORMATS.includes(format)) return { supported: true, format, message: "" };
  return { supported: false, format, message: UNSUPPORTED_FORMAT_GUIDANCE };
}

function clampText(value, limit = MAX_LABEL) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " "
};

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (match) => ENTITIES[match.toLowerCase()] ?? match);
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function stripTags(value) {
  return decodeEntities(String(value ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
}

function normalizeInline(value) {
  return stripTags(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function splitLines(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+$/g, "").replace(/\u200b/g, ""));
}

/* ────────────────────────── 제목 계층 인식 ────────────────────────── */

const ROMAN_NUMERAL = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ";

// ‘작성 요령’·‘※’ 같은 안내문은 제목도 내용도 아니라 채우는 사람에게 주는 지시다.
const GUIDE_PATTERN = /(작성\s*(요령|방법|기준|예시|안내|시 유의)|기재\s*(요령|방법|사항)|※|\(\s*예\s*\)|예시\s*[:：])/;

const HEADING_RULES = [
  { pattern: /^(#{1,6})\s+(.+)$/, level: (m) => m[1].length, title: (m) => m[2] },
  { pattern: /^제\s*(\d{1,2})\s*[장편절관][\s.:：]*(.*)$/, level: () => 1, title: (m) => m[2] },
  { pattern: new RegExp(`^([${ROMAN_NUMERAL}]+)\\s*\\.?\\s*(.+)$`), level: () => 1, title: (m) => m[2] },
  { pattern: /^(\d{1,2})\s*[.)]\s*(.+)$/, level: () => 2, title: (m) => m[2] },
  { pattern: /^([가-하])\.\s*(.+)$/, level: () => 3, title: (m) => m[2] },
  { pattern: /^\((\d{1,2})\)\s*(.+)$/, level: () => 4, title: (m) => m[2] },
  { pattern: /^([①-⑳])\s*(.+)$/, level: () => 5, title: (m) => m[2] },
  { pattern: /^[【\[〈《「『]\s*([^【\[〈《「』」〉》\]]{2,40})\s*[】\]〉》」』]$/, level: () => 2, title: (m) => m[1] }
];

// HWPX는 제목 스타일 정보를 본문 XML에서 바로 얻기 어렵다. 공문서에서 제목으로 쓰는 기호만 좁게 인정한다.
const SYMBOL_HEADING = /^([○□■●◆◇▷▶◈※])\s*(.+)$/;

function cleanHeadingTitle(value) {
  return String(value ?? "")
    .replace(/^\s*[-–—]\s*/, "")
    .replace(/[\s.:：·]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 한 줄이 제목인지 판단한다. 제목이면 { level, title }, 아니면 null. */
export function classifyHeading(rawLine) {
  const line = String(rawLine ?? "").trim();
  if (!line || line.length > 120) return null;
  // 문장 끝이 '다.'이면 제목이 아니라 본문이다.
  if (/다\.\s*$/.test(line)) return null;

  for (const rule of HEADING_RULES) {
    const match = rule.pattern.exec(line);
    if (!match) continue;
    const title = cleanHeadingTitle(rule.title(match));
    if (!title || title.length > 60) continue;
    if (/[.?!]$/.test(title) && title.length > 24) continue;
    return { level: rule.level(match), title };
  }

  const symbol = SYMBOL_HEADING.exec(line);
  if (symbol) {
    const rawTitle = symbol[2].trim();
    const title = cleanHeadingTitle(rawTitle);
    // ○·□로 시작하는 긴 줄, ‘(작성 요령)’ 같은 안내문, 라벨 줄은 제목이 아니다.
    if (!title || title.length > 20) return null;
    if (/^[(\[]/.test(rawTitle)) return null;
    if (/[:：]\s*$/.test(rawTitle)) return null;
    if (GUIDE_PATTERN.test(rawTitle)) return null;
    return { level: 4, title };
  }
  return null;
}

export function isHeadingLine(line) {
  return classifyHeading(line) !== null;
}

/* ────────────────────────── 블록(IR) 만들기 ────────────────────────── */

function pipeCells(line) {
  const trimmed = line.trim();
  if ((trimmed.match(/\|/g) || []).length < 2) return null;
  let body = trimmed;
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|")) body = body.slice(0, -1);
  return body.split("|").map((cell) => cell.trim());
}

function isPipeSeparator(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|") || !trimmed.includes("-")) return false;
  return /^\|?[\s:|-]*-{2,}[\s:|-]*\|?$/.test(trimmed);
}

function tabCells(line) {
  if (!line.includes("\t")) return null;
  const cells = line.split("\t").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function boxCells(line) {
  const trimmed = line.trim();
  if (!/^[│┃]/.test(trimmed)) return null;
  const cells = trimmed.split(/[│┃]/).map((cell) => cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells[cells.length - 1] === "") cells.pop();
  return cells.length >= 2 ? cells : null;
}

function rowCells(line) {
  return pipeCells(line) || tabCells(line) || boxCells(line);
}

function looksLikeHeader(cells) {
  if (!cells.length) return false;
  if (cells.some((cell) => !cell)) return false;
  if (cells.every((cell) => /^[\d.,%()\-~]+$/.test(cell))) return false;
  if (cells.some((cell) => cell.length > 40)) return false;
  const shortCells = cells.filter((cell) => cell.length <= 14).length;
  return shortCells >= Math.ceil(cells.length / 2);
}

function normalizeRows(rows, width) {
  const columns = Math.max(width, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = row.slice(0, MAX_TABLE_COLUMNS);
    while (next.length < columns) next.push("");
    return next.map((cell) => clampText(cell, 300));
  });
}

/** 표 한 덩어리를 { headers, rows }로 만든다. 첫 줄이 머리글처럼 보이지 않으면 열 이름을 만든다. */
export function buildTable(headers, rows) {
  const safeRows = (Array.isArray(rows) ? rows : []).filter((row) => Array.isArray(row));
  const headerCells = (Array.isArray(headers) ? headers : []).map((cell) => clampText(cell, 60));
  const width = Math.max(headerCells.length, ...safeRows.map((row) => row.length), 1);
  const normalizedHeaders = headerCells.slice(0, MAX_TABLE_COLUMNS);
  while (normalizedHeaders.length < width) normalizedHeaders.push("");
  return {
    headers: normalizedHeaders.map((cell, index) => cell || `열 ${index + 1}`),
    rows: normalizeRows(safeRows, width)
  };
}

function readTable(lines, start) {
  const first = rowCells(lines[start]);
  if (!first) return null;
  const sameKind = (line) => {
    if (first.length && pipeCells(lines[start]) && pipeCells(line) && !isPipeSeparator(line)) return true;
    if (tabCells(lines[start]) && tabCells(line)) return true;
    if (boxCells(lines[start]) && boxCells(line)) return true;
    return false;
  };

  const rows = [first];
  let index = start + 1;
  let separated = false;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      // 표 사이 한 줄 공백은 허용하되, 다음 줄이 표가 아니면 표가 끝난 것으로 본다.
      if (index + 1 < lines.length && sameKind(lines[index + 1])) {
        index += 1;
        continue;
      }
      break;
    }
    if (isPipeSeparator(line)) {
      separated = true;
      index += 1;
      continue;
    }
    if (!sameKind(line)) break;
    const cells = rowCells(line);
    if (!cells) break;
    rows.push(cells);
    index += 1;
  }

  if (rows.length === 0) return null;
  const headerLike = separated || looksLikeHeader(rows[0]);
  const headers = headerLike ? rows[0] : rows[0].map((_, column) => `열 ${column + 1}`);
  const body = headerLike ? rows.slice(1) : rows;
  return { block: { type: "table", ...buildTable(headers, body) }, next: index };
}

/** 평문을 블록(IR)으로 나눈다. 표·제목·목록·문단 순서를 유지한다. */
export function parseTextBlocks(text) {
  const lines = splitLines(text);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }
    if (/^-{2,}\s*\d+\s*쪽\s*-{2,}$/.test(trimmed)) {
      blocks.push({ type: "meta", text: trimmed });
      index += 1;
      continue;
    }
    // 표는 제목 판정보다 먼저 본다. '1. 구분 | 내용' 같은 줄을 제목으로 먹지 않게 한다.
    const table = readTable(lines, index);
    if (table && (table.block.rows.length > 0 || table.block.headers.length > 1)) {
      blocks.push(table.block);
      index = table.next;
      continue;
    }

    const heading = classifyHeading(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading.level, title: heading.title });
      index += 1;
      continue;
    }

    const list = /^([-*•·○□▪▫ㅇ])\s*(.+)$/.exec(trimmed);
    if (list) {
      blocks.push({ type: "list", marker: list[1], text: cleanListItem(list[2]) });
      index += 1;
      continue;
    }

    blocks.push({ type: "paragraph", text: cleanParagraph(trimmed) });
    index += 1;
  }

  return blocks.slice(0, MAX_BLOCKS);
}

function cleanListItem(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanParagraph(value) {
  return String(value ?? "").replace(/[ \t]+/g, " ").trim();
}

/** 블록을 평문으로 되돌린다. 기존 텍스트 추출 흐름(공고문 등)과 같은 모양을 유지한다. */
export function blocksToText(blocks) {
  const lines = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "heading") lines.push(`${"#".repeat(Math.min(Math.max(block.level || 1, 1), 6))} ${block.title}`);
    else if (block.type === "list") lines.push(`${block.marker || "-"} ${block.text}`);
    else if (block.type === "paragraph") lines.push(block.text);
    else if (block.type === "table") {
      const headers = Array.isArray(block.headers) ? block.headers : [];
      lines.push(`| ${headers.join(" | ")} |`);
      lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
      for (const row of Array.isArray(block.rows) ? block.rows : []) lines.push(`| ${row.join(" | ")} |`);
    }
  }
  return lines.join("\n").trim();
}

function normalizeBlocks(blocks) {
  const output = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    const type = String(block.type || "");
    if (type === "heading") {
      const title = cleanHeadingTitle(block.title ?? block.text);
      if (title) output.push({ type: "heading", level: Number(block.level) || 1, title: clampText(title, 120) });
    } else if (type === "table") {
      const table = buildTable(block.headers, block.rows);
      if (table.headers.length > 1 || table.rows.length) output.push({ type: "table", ...table });
    } else if (type === "list") {
      const text = cleanListItem(block.text);
      if (text) output.push({ type: "list", marker: String(block.marker || "·"), text: clampText(text, 400) });
    } else if (type === "paragraph") {
      const text = cleanParagraph(block.text);
      if (text) output.push({ type: "paragraph", text: clampText(text, 2000) });
    }
  }
  return output.slice(0, MAX_BLOCKS);
}

/* ────────────────────────── HWPX / DOCX 구조 추출 ────────────────────────── */

const HWPX_TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * HWPX 섹션 XML을 문단·표 블록으로 바꾼다.
 * 문단 안의 표는 표 블록으로 떼어 내고, 표 칸 안의 문단은 칸 글자로 모은다.
 */
export function extractHwpxBlocks(xml) {
  const source = String(xml ?? "");
  const blocks = [];
  const tableStack = [];
  let paragraphDepth = 0;
  let paragraphBuffer = "";
  let textDepth = 0;
  let lastIndex = 0;
  let match;

  const currentFrame = () => (tableStack.length ? tableStack[tableStack.length - 1] : null);

  const appendText = (chunk) => {
    const frame = currentFrame();
    if (!chunk) return;
    if (frame && frame.cell !== null) frame.cell += chunk;
    else if (paragraphDepth > 0) paragraphBuffer += chunk;
  };

  const flushParagraph = () => {
    const text = normalizeInline(paragraphBuffer);
    paragraphBuffer = "";
    if (!text) return;
    const heading = classifyHeading(text);
    if (heading) blocks.push({ type: "heading", level: heading.level, title: heading.title });
    else blocks.push({ type: "paragraph", text: clampText(text, 2000) });
  };

  HWPX_TAG.lastIndex = 0;
  while ((match = HWPX_TAG.exec(source))) {
    if (match.index > lastIndex && textDepth > 0) appendText(decodeEntities(source.slice(lastIndex, match.index)));
    lastIndex = HWPX_TAG.lastIndex;

    const closing = match[1] === "/";
    const local = match[2].split(":").pop().toLowerCase();
    const selfClosing = match[4] === "/";

    if (closing) {
      if (local === "t") {
        textDepth = Math.max(0, textDepth - 1);
      } else if (local === "p") {
        const frame = currentFrame();
        if (frame && frame.cell !== null) {
          frame.cell += " ";
        } else if (paragraphDepth <= 1) {
          flushParagraph();
        }
        paragraphDepth = Math.max(0, paragraphDepth - 1);
      } else if (local === "tc") {
        const frame = currentFrame();
        if (frame && Array.isArray(frame.row)) {
          frame.row.push(clampText(normalizeInline(frame.cell || ""), 300));
          frame.cell = null;
        }
      } else if (local === "tr") {
        const frame = currentFrame();
        if (frame && Array.isArray(frame.row)) {
          frame.rows.push(frame.row);
          frame.row = null;
        }
      } else if (local === "tbl") {
        const frame = tableStack.pop();
        if (frame && frame.rows.length) blocks.push({ type: "table", ...rowsToTable(frame.rows) });
      }
      continue;
    }

    if (selfClosing) continue;

    if (local === "t") {
      textDepth += 1;
    } else if (local === "tbl") {
      tableStack.push({ rows: [], row: null, cell: null });
    } else if (local === "tr") {
      const frame = currentFrame();
      if (frame) frame.row = [];
    } else if (local === "tc") {
      const frame = currentFrame();
      if (frame) frame.cell = "";
    } else if (local === "p") {
      paragraphDepth += 1;
      if (paragraphDepth === 1) paragraphBuffer = "";
    }
  }

  flushParagraph();
  return blocks;
}

function rowsToTable(rows) {
  const cleaned = rows.map((row) => row.map((cell) => String(cell ?? "").trim()));
  const headerLike = looksLikeHeader(cleaned[0] || []);
  const headers = headerLike ? cleaned[0] : (cleaned[0] || []).map((_, index) => `열 ${index + 1}`);
  const body = headerLike ? cleaned.slice(1) : cleaned;
  return buildTable(headers, body);
}

/**
 * JSZip으로 연 HWPX에서 섹션 XML을 모아 블록을 만든다.
 * zip은 { files, ... }를 가진 JSZip 인스턴스면 되고, 테스트에서는 실제 JSZip을 그대로 넘긴다.
 */
export async function readHwpxBlocks(zip) {
  const files = Object.values(zip?.files || {});
  const sectionEntries = files
    .filter((entry) => entry && !entry.dir && /Contents\/section\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const fallbackEntries = files.filter(
    (entry) => entry && !entry.dir && entry.name.toLowerCase().endsWith(".xml") && !/META-INF|version\.xml|settings\.xml/i.test(entry.name)
  );
  const chosen = sectionEntries.length ? sectionEntries : fallbackEntries;

  const blocks = [];
  for (const entry of chosen) {
    const xml = await entry.async("text");
    blocks.push(...extractHwpxBlocks(xml));
  }
  return blocks.slice(0, MAX_BLOCKS);
}

/** mammoth가 만든 HTML을 블록으로 바꾼다. 표 안의 문단은 표 칸으로만 들어간다. */
export function extractDocxHtmlBlocks(html) {
  const source = String(html ?? "");
  const blocks = [];
  const token = /<table\b[^>]*>([\s\S]*?)<\/table>|<(h[1-6])\b[^>]*>([\s\S]*?)<\/\2>|<li\b[^>]*>([\s\S]*?)<\/li>|<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = token.exec(source))) {
    if (match[1] !== undefined) {
      const rows = [];
      const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowPattern.exec(match[1]))) {
        const cells = [];
        const cellPattern = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
        let cellMatch;
        while ((cellMatch = cellPattern.exec(rowMatch[1]))) cells.push(normalizeInline(cellMatch[2]));
        if (cells.length) rows.push(cells);
      }
      if (rows.length) blocks.push({ type: "table", ...rowsToTable(rows) });
      continue;
    }
    if (match[2]) {
      const title = cleanHeadingTitle(normalizeInline(match[3]));
      if (title) blocks.push({ type: "heading", level: Number(match[2].slice(1)) || 1, title: clampText(title, 120) });
      continue;
    }
    if (match[4] !== undefined) {
      const text = normalizeInline(match[4]);
      if (text) blocks.push({ type: "list", marker: "·", text: clampText(text, 400) });
      continue;
    }
    if (match[5] !== undefined) {
      const text = normalizeInline(match[5]);
      if (!text) continue;
      const heading = classifyHeading(text);
      if (heading) blocks.push({ type: "heading", level: heading.level, title: heading.title });
      else blocks.push({ type: "paragraph", text: clampText(text, 2000) });
    }
  }
  return blocks.slice(0, MAX_BLOCKS);
}

/* ────────────────────────── 양식 스키마 ────────────────────────── */

const BLANK_PATTERNS = [  /_{3,}/,
  /ㅇ{2,}/,
  /[○◯]{2,}/,
  /\(\s{2,}\)/,
  /\(\s*\)/,
  /\[\s{2,}\]/,
  /[(\[]\s*0{2,}\s*[)\]]/,
  /\.{4,}/
];
const LABEL_PATTERN = /^([^:：]{1,40})\s*[:：]\s*$/;

function hasBlank(text) {
  return BLANK_PATTERNS.some((pattern) => pattern.test(text));
}

function slotLabelOf(text) {
  const cleaned = String(text ?? "")
    .replace(/_{2,}/g, " ")
    .replace(/[ㅇ○◯]{2,}/g, " ")
    .replace(/[·.]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const colon = /^([^:：]{1,40})\s*[:：]/.exec(cleaned);
  if (colon) return clampText(colon[1]);
  return clampText(cleaned.replace(/[:：]\s*$/, "")) || "(이름 없는 항목)";
}

/** 한 줄에서 작성 슬롯을 찾는다. 슬롯이면 kind, 아니면 null. */
export function detectSlotKind(text, blockType) {
  const line = String(text ?? "").trim();
  if (!line || line.length > 240) return null;
  if (GUIDE_PATTERN.test(line)) return "guide";
  if (hasBlank(line)) return "blank";
  // '다음과 같습니다:' 같은 안내 문장은 라벨이 아니라 문단으로 둔다.
  if (LABEL_PATTERN.test(line) && !/(습니다|입니다|합니다)\s*[:：]?$/.test(line)) return "label";
  if (blockType === "list" && line.length <= 120) return "item";
  return null;
}

function compactLevels(sections) {
  const rawLevels = Array.from(new Set(sections.map((section) => section.rawLevel))).sort((a, b) => a - b);
  const levelMap = new Map(rawLevels.map((level, index) => [level, index + 1]));
  for (const section of sections) section.level = levelMap.get(section.rawLevel) || 1;

  const stack = [];
  for (const section of sections) {
    while (stack.length && stack[stack.length - 1].level >= section.level) stack.pop();
    section.parentId = stack.length ? stack[stack.length - 1].id : null;
    stack.push(section);
  }
  return sections;
}

function emptyCounts() {
  return { sections: 0, tables: 0, slots: 0, emptyCells: 0, blanks: 0, guides: 0 };
}

export function emptyTemplateSchema(fileName = "") {
  return {
    version: 1,
    fileName: String(fileName || ""),
    format: documentFormatOf(fileName),
    charCount: 0,
    title: "",
    sections: [],
    tables: [],
    slots: [],
    counts: emptyCounts(),
    warnings: []
  };
}

/**
 * 블록(IR) 또는 평문에서 양식 스키마를 만든다.
 * 결과: 섹션 목차 + 표(머리글·행·빈칸) + 작성 슬롯(빈칸·라벨·작성 요령·목록 항목).
 */
export function parseSampleTemplate({ text = "", blocks, fileName = "", format } = {}) {
  const resolvedFormat = format || documentFormatOf(fileName);
  const sourceBlocks = Array.isArray(blocks) && blocks.length ? normalizeBlocks(blocks) : parseTextBlocks(text);
  const schema = emptyTemplateSchema(fileName);
  schema.format = resolvedFormat;
  schema.charCount = String(text || "").length || blocksToText(sourceBlocks).length;

  const sections = [];
  const tables = [];
  const textSlots = [];
  const cellSlots = [];
  const warnings = [];
  let currentSection = null;
  let emptyCells = 0;
  let blankCount = 0;
  let guideCount = 0;
  let lineNumber = 0;

  for (const block of sourceBlocks) {
    lineNumber += 1;
    if (block.type === "heading") {
      if (sections.length >= MAX_SECTIONS) continue;
      const section = {
        id: `s${sections.length + 1}`,
        rawLevel: Math.max(1, Math.min(Number(block.level) || 1, 6)),
        level: 1,
        parentId: null,
        title: block.title,
        order: sections.length + 1,
        line: lineNumber
      };
      sections.push(section);
      currentSection = section;
      continue;
    }

    if (block.type === "table") {
      if (tables.length >= MAX_TABLES) continue;
      const tableRows = block.rows.slice(0, MAX_TABLE_ROWS);
      const table = {
        id: `t${tables.length + 1}`,
        order: tables.length + 1,
        sectionId: currentSection ? currentSection.id : null,
        caption: currentSection ? currentSection.title : `표 ${tables.length + 1}`,
        headers: block.headers.slice(0, MAX_TABLE_COLUMNS),
        rows: tableRows,
        columnCount: block.headers.length,
        rowCount: block.rows.length,
        emptyCells: 0
      };
      for (const row of tableRows) {
        for (let column = 0; column < table.headers.length; column += 1) {
          if (!String(row[column] ?? "").trim()) table.emptyCells += 1;
        }
      }
      emptyCells += table.emptyCells;
      tables.push(table);
      continue;
    }

    const blockType = block.type === "list" ? "list" : "paragraph";
    const kind = detectSlotKind(block.text, blockType);
    if (!kind) continue;
    if (kind === "guide") guideCount += 1;
    if (kind === "blank") blankCount += 1;
    if (textSlots.length >= MAX_TEXT_SLOTS) continue;
    textSlots.push({
      id: `w${textSlots.length + 1}`,
      kind,
      label: slotLabelOf(block.text),
      sectionId: currentSection ? currentSection.id : null,
      sectionTitle: currentSection ? currentSection.title : "",
      preview: clampText(block.text, 140),
      source: "text"
    });
  }

  compactLevels(sections);

  for (const table of tables) {
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
      for (let column = 0; column < table.headers.length; column += 1) {
        if (String(table.rows[rowIndex][column] ?? "").trim()) continue;
        if (cellSlots.length >= MAX_CELL_SLOTS) break;
        cellSlots.push({
          id: `c${cellSlots.length + 1}`,
          kind: "table-cell",
          label: `${table.caption} · ${table.headers[column]} (${rowIndex + 1}행)`,
          sectionId: table.sectionId,
          sectionTitle: table.caption,
          tableId: table.id,
          rowIndex,
          columnIndex: column,
          source: "table"
        });
      }
    }
  }

  const slots = [...textSlots, ...cellSlots];
  const counts = {
    sections: sections.length,
    tables: tables.length,
    slots: slots.length,
    emptyCells,
    blanks: blankCount,
    guides: guideCount
  };

  if (!sections.length) {
    warnings.push("제목 계층을 찾지 못했습니다. ‘1.’, ‘가.’, ‘①’ 같은 번호나 제목 서식을 쓰면 목차를 더 잘 인식합니다.");
  }
  if (!tables.length) {
    warnings.push("표를 찾지 못했습니다. 표는 Markdown 표(| … |)나 탭으로 구분된 줄에서 인식합니다.");
  }
  if (!slots.length) {
    warnings.push("작성할 빈칸·항목을 찾지 못했습니다. 빈칸(___, ( ))이나 ‘작성 요령’ 표시가 있는 양식에서 잘 동작합니다.");
  }
  if (counts.slots >= MAX_TEXT_SLOTS + MAX_CELL_SLOTS) {
    warnings.push(`작성 항목이 많아 ${MAX_TEXT_SLOTS + MAX_CELL_SLOTS}개까지만 미리보기에 담았습니다.`);
  }

  schema.title =
    (sections.find((section) => section.level === 1) || sections[0])?.title ||
    String(fileName || "").replace(/\.[^.]+$/, "") ||
    "샘플 양식";
  schema.sections = sections;
  schema.tables = tables;
  schema.slots = slots;
  schema.counts = counts;
  schema.warnings = warnings;
  return schema;
}

/** 미리보기 상단 숫자 요약. */
export function summarizeSchema(schema) {
  const counts = schema?.counts || emptyCounts();
  return {
    sections: counts.sections || 0,
    tables: counts.tables || 0,
    slots: counts.slots || 0,
    emptyCells: counts.emptyCells || 0,
    blanks: counts.blanks || 0,
    guides: counts.guides || 0,
    title: schema?.title || "",
    formats: schema?.format || ""
  };
}

/** 양식 구조를 Markdown 목차로 보여 준다. 미리보기와 AI 프롬프트가 같은 함수를 쓴다. */
export function renderSchemaOutline(schema, { maxChars = OUTLINE_MAX_CHARS } = {}) {
  if (!schema || (!schema.sections?.length && !schema.tables?.length && !schema.slots?.length)) {
    return "양식 구조를 아직 읽지 못했습니다. 파일을 올리거나 문서 내용을 붙여넣고 ‘구조 분석’을 눌러 주세요.";
  }

  const lines = [];
  lines.push(`## 목차 (${schema.sections.length}개)`);
  if (schema.sections.length) {
    for (const section of schema.sections) {
      lines.push(`${"  ".repeat(Math.max(0, section.level - 1))}- ${section.title}`);
    }
  } else {
    lines.push("- (제목을 찾지 못했습니다)");
  }

  lines.push("", `## 표 (${schema.tables.length}개)`);
  if (schema.tables.length) {
    for (const table of schema.tables) {
      lines.push(`### ${table.id.toUpperCase()} · ${table.caption} · ${table.headers.length}열 × ${table.rowCount}행 · 빈칸 ${table.emptyCells}`);
      lines.push(`| ${table.headers.join(" | ")} |`);
      lines.push(`| ${table.headers.map(() => "---").join(" | ")} |`);
      table.rows.slice(0, 5).forEach((row) => lines.push(`| ${row.map((cell) => (cell ? cell : " ")).join(" | ")} |`));
      if (table.rowCount > 5) lines.push(`| … ${table.rowCount - 5}행 더 있음 |`);
    }
  } else {
    lines.push("- (표를 찾지 못했습니다)");
  }

  lines.push("", `## 작성 항목 (${schema.slots.length}개)`);
  if (schema.slots.length) {
    const kinds = { blank: "빈칸", label: "라벨", item: "항목", guide: "작성 요령", "table-cell": "표 빈칸" };
    for (const slot of schema.slots.slice(0, 80)) {
      const where = slot.sectionTitle ? ` · ‘${slot.sectionTitle}’` : "";
      lines.push(`- [${kinds[slot.kind] || slot.kind}] ${slot.label}${where}`);
    }
    if (schema.slots.length > 80) lines.push(`- … ${schema.slots.length - 80}개 더 있음`);
  } else {
    lines.push("- (작성 항목을 찾지 못했습니다)");
  }

  const outline = lines.join("\n");
  if (outline.length <= maxChars) return outline;
  return `${outline.slice(0, maxChars).trimEnd()}\n\n… (양식 구조가 길어 여기서 생략했습니다)`;
}

/** AI 결과가 양식 목차 제목을 얼마나 지켰는지 센다. 결과 검토 안내에 쓴다. */
export function checkStructureCoverage(schema, markdown) {
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  const text = String(markdown ?? "");
  if (!sections.length) return { total: 0, matched: 0, ratio: 1 };
  let matched = 0;
  for (const section of sections) {
    if (section.title && text.includes(section.title)) matched += 1;
  }
  return { total: sections.length, matched, ratio: matched / sections.length };
}

/* ────────────────────────── 프로필과 프롬프트 ────────────────────────── */

export const TEMPLATE_PROFILE_FIELDS = [
  { key: "projectName", label: "사업·프로젝트명", placeholder: "예: 양양 생활문화 혁신 지원사업" },
  { key: "organization", label: "수행 기관·단체", placeholder: "예: 양양군농촌활성화지원센터" },
  { key: "region", label: "지역·대상지", placeholder: "예: 강원 양양군 현남면" },
  { key: "audience", label: "대상·참여자", placeholder: "예: 지역 청년 20명, 두레동아리 5팀" },
  { key: "summary", label: "사업 핵심 메모", placeholder: "무엇을, 왜, 어떻게 할지 3~5줄" },
  { key: "budget", label: "예산·재원", placeholder: "예: 총 4,800만원 (국비 3,360 / 지방비 960 / 자부담 480)" },
  { key: "schedule", label: "일정", placeholder: "예: 2027.1.~11. (착수 1월, 중간보고 6월, 결과보고 12월)" },
  { key: "evidence", label: "보유 자료·근거", placeholder: "예: 2025 두레동아리 운영일지, 참여자 32명 설문, 협약서" },
  { key: "notes", label: "기타 메모·주의", placeholder: "평가 포인트, 피하고 싶은 표현, 꼭 들어갈 문장" }
];

function profileText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, PROFILE_LIMIT);
}

export function normalizeProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const output = {};
  for (const field of TEMPLATE_PROFILE_FIELDS) output[field.key] = profileText(source[field.key]);
  return output;
}

/**
 * 저장·불러오기용 프로필 정리. 키 모양과 길이만 확인하고,
 * 사용자가 입력한 띄어쓰기와 줄바꿈은 그대로 남긴다.
 * (문서를 채우거나 프롬프트를 만들 때는 normalizeProfile로 한 줄로 정리한다.)
 */
export function normalizeProfileKeepWhitespace(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const output = {};
  for (const field of TEMPLATE_PROFILE_FIELDS) {
    output[field.key] = String(source[field.key] ?? "").slice(0, PROFILE_LIMIT);
  }
  return output;
}

function profileLines(profile) {
  const normalized = normalizeProfile(profile);
  const lines = [];
  for (const field of TEMPLATE_PROFILE_FIELDS) {
    const value = normalized[field.key];
    lines.push(`- ${field.label}: ${value || "(입력 없음)"}`);
  }
  return lines;
}

/**
 * AI 채우기 프롬프트. 양식 구조를 그대로 넣고, 구조 유지·확인 필요 표시를 못 박는다.
 * AI 호출이 실패해도 이 프롬프트를 복사해 외부 AI에서 그대로 쓸 수 있다.
 */
export function buildTemplateFillPrompt({ schema, profile, maxChars = OUTLINE_MAX_CHARS } = {}) {
  const title = profile?.projectName || schema?.title || "새 사업계획서";
  const outline = renderSchemaOutline(schema, { maxChars });
  return [
    "당신은 한국어 공모사업·사업계획서 작성 실무자입니다.",
    "아래 ‘샘플 양식 구조’에 맞춰 ‘내 사업 정보’로 문서를 채워 주세요.",
    "",
    "지켜야 할 것:",
    "1. 샘플 양식의 목차 순서와 제목을 그대로 유지하세요. 섹션을 새로 만들거나 합치지 마세요.",
    "2. 양식에 있는 표는 Markdown 표로 똑같이 다시 만들고, 열 이름을 바꾸지 마세요. 빈 칸을 내용으로 채우세요.",
    "3. ‘작성 요령’·‘※’ 안내문은 결과물에 옮기지 말고 참고만 하세요.",
    "4. 내 사업 정보에 없는 수치·기관명·인용은 ‘확인 필요’라고 적고 만들어 내지 마세요.",
    "5. 각 항목은 평가자가 읽기 좋게 3~6문장, 필요하면 불릿으로 쓰세요. 같은 말을 반복하지 마세요.",
    "6. 결과는 문서 전체 Markdown만 출력하세요. 인사말·설명·코드블록 표시 없이 바로 쓰세요.",
    "",
    "## 샘플 양식 구조",
    outline,
    "",
    "## 내 사업 정보",
    ...profileLines(profile),
    "",
    "## 출력",
    `첫 줄은 "# ${title}"로 시작하고, 이후 샘플 양식의 목차 순서를 그대로 따르세요.`,
    "마지막에 확인이 필요한 항목을 `## 확인 필요` 목록으로 짧게 정리하세요."
  ].join("\n");
}

/* ────────────────────────── 규칙 기반 채우기 ────────────────────────── */

const FIELD_MATCHERS = [
  [/사업\s*명|과업\s*명|프로젝트\s*명|공모\s*사업/, "projectName"],
  [/기관|주관|수행\s*기관|신청\s*기관|단체|법인|담당/, "organization"],
  [/지역|장소|대상\s*지|사업\s*지/, "region"],
  [/대상|수혜|참여자|이용자|수요자/, "audience"],
  [/예산|금액|사업비|소요\s*예산|재원/, "budget"],
  [/기간|일정|추진\s*일정|사업\s*기간|일시/, "schedule"],
  [/근거|자료|증빙|출처|실적/, "evidence"],
  [/내용|개요|설명|요약|목적|추진\s*방향|기대\s*효과/, "summary"]
];

function valueForLabel(label, profile) {
  const normalized = normalizeProfile(profile);
  if (!normalized.projectName && !normalized.summary && !normalized.organization) return "";
  const target = String(label || "");
  for (const [pattern, key] of FIELD_MATCHERS) {
    if (pattern.test(target)) {
      const value = normalized[key];
      if (value) return { key, value };
      break;
    }
  }
  if (normalized.summary) return { key: "summary", value: normalized.summary };
  return { key: "", value: "" };
}

function fillCell(cell, header, profile) {
  const value = String(cell ?? "").trim();
  if (value) return value;
  const match = valueForLabel(header, profile);
  return match.value || "확인 필요";
}

/**
 * AI 없이 양식 구조대로 채우는 초안. 원본 목차·표를 유지하고, 비어 있지 않은 칸은 샘플 원문을 살린다.
 * AI 호출 실패 시 폴백으로도 쓴다.
 */
export function buildRuleBasedFill({ schema, profile } = {}) {
  const normalized = normalizeProfile(profile);
  const schemaTitle = schema?.title || "샘플 양식";
  const title = normalized.projectName || schemaTitle;
  const lines = [];
  const missing = [];

  lines.push(`# ${title}`);
  lines.push("");
  lines.push(
    "> 이 문서는 AI를 호출하지 않고 샘플 양식의 구조에 맞춰 규칙 기반으로 채운 초안입니다. 샘플에 원래 있던 글은 그대로 두고 빈칸만 채웠으며, 채울 값이 없으면 ‘확인 필요’로 표시했습니다."
  );
  lines.push("");
  if (schema?.fileName) lines.push(`- 양식 출처: ${schema.fileName}`);
  if (schema?.counts) {
    lines.push(`- 구조: 섹션 ${schema.counts.sections}개 · 표 ${schema.counts.tables}개 · 작성 항목 ${schema.counts.slots}개`);
  }
  lines.push("");

  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  const tables = Array.isArray(schema?.tables) ? schema.tables : [];
  const slots = Array.isArray(schema?.slots) ? schema.slots.filter((slot) => slot.kind !== "table-cell" && slot.kind !== "guide") : [];

  const renderTable = (table) => {
    lines.push(`| ${table.headers.join(" | ")} |`);
    lines.push(`| ${table.headers.map(() => "---").join(" | ")} |`);
    for (const row of table.rows) {
      const cells = table.headers.map((header, column) => fillCell(row[column], header, normalized));
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");
  };

  if (!sections.length) {
    lines.push(`## ${schemaTitle}`);
    lines.push("");
    if (normalized.summary) lines.push(normalized.summary, "");
    for (const table of tables) renderTable(table);
    for (const slot of slots) {
      const match = valueForLabel(slot.label, normalized);
      if (!match.value) missing.push(slot.label);
      lines.push(`- **${slot.label}**: ${match.value || "확인 필요"}`);
    }
    lines.push("");
  }

  for (const section of sections) {
    const heading = `${"#".repeat(Math.min((section.level || 1) + 1, 6))} ${section.title}`;
    lines.push(heading);
    lines.push("");

    const sectionTables = tables.filter((table) => table.sectionId === section.id);
    const sectionSlots = slots.filter((slot) => slot.sectionId === section.id);

    if (!sectionTables.length && !sectionSlots.length) {
      const match = valueForLabel(section.title, normalized);
      if (match.value) lines.push(match.value);
      else {
        lines.push("확인 필요 — 이 항목에 들어갈 내용을 확인해 주세요.");
        missing.push(section.title);
      }
      lines.push("");
      continue;
    }

    for (const table of sectionTables) renderTable(table);

    for (const slot of sectionSlots) {
      const match = valueForLabel(slot.label, normalized);
      if (!match.value) missing.push(slot.label);
      lines.push(`- **${slot.label}**: ${match.value || "확인 필요"}`);
    }
    if (sectionSlots.length) lines.push("");
  }

  const pending = Array.from(new Set(missing)).slice(0, 20);
  lines.push("## 확인 필요", "");
  if (pending.length) for (const item of pending) lines.push(`- ${item}`);
  else lines.push("- 규칙 기반 초안에서 비어 있는 칸은 없습니다. 문장 다듬기와 수치 확인만 남았습니다.");
  lines.push("");
  lines.push("> 제출 전 확인: 기관명·예산·일정·성과 수치는 원본 자료와 대조하세요. 이 초안은 외부로 전송·제출되지 않았습니다.");

  return lines.join("\n").trim();
}
