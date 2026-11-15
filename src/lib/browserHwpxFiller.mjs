// 브라우저 단독 HWPX 패처 — 터미널·로컬 서버 없이 .hwpx 안의 Contents/section*.xml 을 직접 고쳐
// 원본 서식(글꼴·표 테두리·문단 모양)을 그대로 둔 채 값만 넣고, 같은 자리에서 .hwpx 로 다시 묶는다.
//
// kordoc(chrisryugj/kordoc, MIT) src/form/filler-hwpx.ts 의 채우기 전략을 브라우저에서 쓸 수 있는 범위로 옮긴 구현이다.
//   1) 라벨 | 빈칸 — 라벨 칸 오른쪽(또는 열 머리 아래)의 빈 칸에 값을 넣는다
//   2) 열 머리 + 데이터 행 — 머리 이름이 곧 채우기 키 (명부형 표, 배열 값은 행마다 하나씩)
//   3) 본문 인라인 "라벨: 값" · `{{라벨}}`·`[입력]`·`___` 자리 표시
// 값은 칸의 첫 `<hp:t>` 안에만 써 넣어 run 의 charPrIDRef(글꼴·크기)와 문단의 paraPrIDRef 를 유지한다.
// 여러 줄 값은 같은 문단 모양·글자 모양을 복제한 `<hp:p>` 를 이어 붙여 칸 안에서 줄을 나눈다.
// 지난 단계까지는 "어느 칸에 무슨 값"만 정하고 실제 쓰기는 kordoc CLI·브릿지에 맡겼는데, 이 모듈이 그 쓰기를 브라우저로 가져온다.

import { isBlankValueCell, isDatePlaceholderCell, isFormLabelCell, isSubLabelBeside, findMatchingFieldKey, normalizeFormLabel, scanInlineFieldSegments } from "./kordocFormSpec.mjs";

export const HWPX_MIME = "application/hwp+zip";
/** 다시 읽을 때 본문으로 보는 ZIP 엔트리 */
const SECTION_ENTRY_RE = /^Contents\/section\d+\.xml$/i;
/** 칸 글자를 모을 때 넘어가는 요소 — 안쪽 표·글상자의 글자는 그 칸 글자가 아니다. */
const OPAGUE_LOCALS = new Set(["tbl", "drawtext", "equation", "chart", "header", "footer"]);
const FILL_PLACEHOLDER_RE = /^\{\{\s*[^{}]{1,40}?\s*\}\}$|^\[\s*[가-힣A-Za-z0-9 ]{0,20}\s*\]$|^_{2,}$|^[ㅇ○◯]{2,}$|^\.{3,}$/;

/* ────────────────────────── XML 읽기 ────────────────────────── */

const NODE_RE = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![A-Za-z][^>]*>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

/**
 * HWPX 섹션 XML을 요소 트리로 읽는다. 위치(offset)를 그대로 들고 있어,
 * 값을 넣을 때 DOM 재직렬화 없이 필요한 자리만 잘라 바꿀 수 있다(나머지 바이트 보존).
 */
export function parseHwpxXml(xml) {
  const source = String(xml ?? "");
  const root = {
    name: "#root",
    local: "#root",
    attrs: "",
    start: 0,
    openEnd: 0,
    closeStart: source.length,
    end: source.length,
    selfClosing: false,
    children: [],
    parent: null
  };
  const stack = [root];
  let cursor = 0;
  let match;
  NODE_RE.lastIndex = 0;
  while ((match = NODE_RE.exec(source))) {
    const parent = stack[stack.length - 1];
    if (match.index > cursor) parent.children.push({ type: "text", start: cursor, end: match.index });
    cursor = NODE_RE.lastIndex;
    if (match[2] === undefined) continue; // 주석·CDATA·선언은 글자로만 둔다
    const name = match[2];
    const local = name.split(":").pop().toLowerCase();
    if (match[1] === "/") {
      let index = stack.length - 1;
      while (index > 0 && stack[index].name !== name) index -= 1;
      if (index > 0) {
        stack[index].closeStart = match.index;
        stack[index].end = cursor;
        stack.length = index;
      }
      continue;
    }
    const node = {
      name,
      local,
      attrs: match[3] || "",
      start: match.index,
      openEnd: cursor,
      closeStart: -1,
      end: cursor,
      selfClosing: match[4] === "/",
      children: [],
      parent
    };
    parent.children.push(node);
    if (!node.selfClosing) stack.push(node);
  }
  return root;
}

function elementsOf(node) {
  return (node?.children || []).filter((child) => child.type !== "text");
}

function attrOf(attrs, name) {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(String(attrs ?? ""));
  return found ? (found[1] ?? found[2] ?? "") : "";
}

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** XML 글자로 안전하게 바꾼다 — &, <, > 와 제어문자. */
export function escapeXmlText(value) {
  return String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* ────────────────────────── 문단·칸 글자 ────────────────────────── */

/**
 * 요소 안의 `<hp:t>` 글자를 문서 순서로 모은다.
 * 칸 안의 표·글상자(OPAGUE_LOCALS)는 넘어가 그 안 글자를 이 칸 글로 세지 않는다.
 */
function textRuns(node, out = []) {
  for (const child of elementsOf(node)) {
    if (OPAGUE_LOCALS.has(child.local)) continue;
    if (child.local === "t") {
      out.push({
        node: child,
        selfClosing: child.selfClosing,
        contentStart: child.openEnd,
        contentEnd: child.selfClosing ? child.openEnd : child.closeStart
      });
      continue;
    }
    textRuns(child, out);
  }
  return out;
}

function rawTextOf(xml, runs) {
  let text = "";
  for (const run of runs) {
    if (run.selfClosing) continue;
    text += String(xml ?? "").slice(run.contentStart, run.contentEnd);
  }
  return text;
}

function visibleTextOf(xml, runs) {
  return decodeEntities(rawTextOf(xml, runs)).replace(/&lt;\/(?:hp:)?[a-zA-Z]+&gt;/g, " ").replace(/\s+/g, " ").trim();
}

/** 칸 하나의 모델 — 글자·문단·병합 정보를 함께 들고 다닌다. */
function readCell(node, xml, rowIndex) {
  const runs = textRuns(node);
  const paragraphs = [];
  const collectParagraphs = (current) => {
    for (const child of elementsOf(current)) {
      if (OPAGUE_LOCALS.has(child.local)) continue;
      if (child.local === "p") {
        paragraphs.push(child);
        continue;
      }
      collectParagraphs(child);
    }
  };
  collectParagraphs(node);
  let colAddr = -1;
  let rowAddr = -1;
  let colSpan = 1;
  let rowSpan = 1;
  for (const child of elementsOf(node)) {
    if (child.local === "celladdr") {
      colAddr = Number(attrOf(child.attrs, "colAddr"));
      rowAddr = Number(attrOf(child.attrs, "rowAddr"));
    } else if (child.local === "cellspan") {
      colSpan = Math.max(1, Number(attrOf(child.attrs, "colSpan")) || 1);
      rowSpan = Math.max(1, Number(attrOf(child.attrs, "rowSpan")) || 1);
    }
  }
  return {
    node,
    paragraphs,
    raw: rawTextOf(xml, runs),
    text: visibleTextOf(xml, runs),
    colAddr,
    rowAddr: rowAddr >= 0 ? rowAddr : rowIndex,
    colSpan,
    rowSpan
  };
}

/** 표 하나의 행·칸 모델. 안쪽 표는 따로 세도록 여기서 멈춘다. */
function readTable(node, xml, index) {
  const rowNodes = [];
  const collectRows = (current) => {
    for (const child of elementsOf(current)) {
      if (child.local === "tbl") continue;
      if (child.local === "tr") {
        rowNodes.push(child);
        continue;
      }
      collectRows(child);
    }
  };
  collectRows(node);
  const rows = rowNodes.map((rowNode, rowIndex) => {
    const cells = elementsOf(rowNode)
      .filter((child) => child.local === "tc")
      .map((cell) => readCell(cell, xml, rowIndex));
    // 칸 주소가 없으면 나온 순서를 열 번호로 본다.
    const hasAddr = cells.some((cell) => cell.colAddr >= 0);
    cells.forEach((cell, position) => {
      if (!hasAddr || cell.colAddr < 0) cell.colAddr = position;
    });
    cells.sort((a, b) => a.colAddr - b.colAddr);
    return { node: rowNode, index: rowIndex, cells };
  });
  const columnCount = rows.reduce((max, row) => Math.max(max, ...row.cells.map((cell) => cell.colAddr + cell.colSpan), 0), 0);
  return { node, index, rows, columnCount, rowCount: rows.length };
}

function collectTables(root, xml) {
  const tables = [];
  const walk = (node) => {
    for (const child of elementsOf(node)) {
      if (child.local === "tbl") {
        tables.push(readTable(child, xml, tables.length));
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return tables;
}

/** 표 밖 문단 — 본문 인라인 "라벨: 값" 채우기 대상. */
function collectBodyParagraphs(root) {
  const paragraphs = [];
  const inTable = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) if (parent.local === "tbl") return true;
    return false;
  };
  const walk = (node) => {
    for (const child of elementsOf(node)) {
      if (child.local === "p" && !inTable(child) && !paragraphs.includes(child)) {
        paragraphs.push(child);
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return paragraphs;
}

/* ────────────────────────── 채우기 값 ────────────────────────── */

/**
 * 값 맵(라벨 → 값)을 라벨별 커서로 바꾼다. 배열 값은 같은 라벨이 여러 번 나올 때 등장 순서대로 소진된다.
 * 정규화 키가 같으면 한 커서를 함께 쓴다(콜론·공백만 다른 라벨).
 */
export function createFillCursors(values) {
  const cursors = new Map();
  for (const [label, raw] of Object.entries(values && typeof values === "object" ? values : {})) {
    const key = normalizeFormLabel(label);
    if (!key) continue;
    const list = (Array.isArray(raw) ? raw : [raw]).map((item) => String(item ?? "")).filter((item) => item.trim());
    if (!list.length) continue;
    const existing = cursors.get(key);
    if (existing) {
      existing.list.push(...list);
      existing.array = existing.array || Array.isArray(raw) || existing.list.length > 1;
      continue;
    }
    cursors.set(key, { key, label: String(label), list, index: 0, array: Array.isArray(raw) });
  }
  return cursors;
}

function consumeValue(cursor) {
  if (!cursor || cursor.index >= cursor.list.length) return undefined;
  const value = cursor.list[cursor.index];
  cursor.index += 1;
  return value;
}

/**
 * 칸에 지금 값이 있는지 — 빈칸·밑줄·`{{…}}`·`[입력]`·날짜 자리표시만 채울 수 있다.
 * 사용자가 이미 적어 둔 글은 덮어쓰지 않는다.
 */
export function fillableValueState(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { fillable: true, placeholder: "" };
  if (isBlankValueCell(trimmed)) return { fillable: true, placeholder: trimmed };
  if (FILL_PLACEHOLDER_RE.test(trimmed)) {
    const mustache = /^\{\{\s*([^{}]{1,40}?)\s*\}\}$/.exec(trimmed);
    return { fillable: true, placeholder: trimmed, label: mustache ? mustache[1].trim() : "" };
  }
  if (isDatePlaceholderCell(trimmed)) return { fillable: true, placeholder: trimmed };
  return { fillable: false, placeholder: "" };
}

function matchKey(labelText, cursors) {
  if (!cursors.size) return undefined;
  return findMatchingFieldKey(labelText, Array.from(cursors.keys()));
}

/* ────────────────────────── 문단 쓰기 ────────────────────────── */

function lineSplits(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, ""));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.length ? lines : [""];
}

function firstCharPrAttrs(paragraph) {
  for (const node of textRuns(paragraph)) {
    const run = node.node.parent;
    if (run && run.local === "run") {
      const id = attrOf(run.attrs, "charPrIDRef");
      if (id) return ` charPrIDRef="${id}"`;
    }
  }
  return "";
}

function cloneParagraph(attrs, charPrAttrs, line) {
  return `<hp:p${attrs}><hp:run${charPrAttrs}><hp:t>${escapeXmlText(line)}</hp:t></hp:run></hp:p>`;
}

/**
 * 문단 하나에 값(여러 줄)을 쓴다. 첫 `<hp:t>` 안에 첫 줄을 넣고, 남은 줄은 같은 문단 모양을 복제해 뒤에 붙인다.
 * 줄 배치 캐시(hp:linesegarray)는 글이 바뀐 문단에서만 걷어 낸다 — 그대로 두면 한글에서 옛 줄 배치가 남는다.
 */
function planParagraphWrite(paragraph, value, splices) {
  const lines = lineSplits(value);
  const runs = textRuns(paragraph);
  for (const child of elementsOf(paragraph)) {
    if (child.local === "linesegarray") splices.push({ start: child.start, end: child.end, replacement: "" });
  }
  const attrs = paragraph.attrs ? ` ${paragraph.attrs.trim()}` : "";
  const charPrAttrs = firstCharPrAttrs(paragraph);

  if (!runs.length) {
    // 글자 요소가 없는 빈 문단 — run 을 만들어 넣는다.
    if (paragraph.selfClosing) return false;
    const body = lines.map((line) => `<hp:run${charPrAttrs}><hp:t>${escapeXmlText(line)}</hp:t></hp:run>`).join("");
    splices.push({ start: paragraph.closeStart, end: paragraph.closeStart, replacement: body });
    return true;
  }

  const first = runs[0];
  const firstText = escapeXmlText(lines[0]);
  if (first.selfClosing) {
    const tag = `<${first.node.name}`;
    splices.push({ start: first.node.start, end: first.node.end, replacement: `${tag}>${firstText}</${first.node.name}>` });
  } else {
    splices.push({ start: first.contentStart, end: first.contentEnd, replacement: firstText });
  }
  for (let index = 1; index < runs.length; index += 1) {
    const run = runs[index];
    if (run.selfClosing) continue;
    if (run.contentStart < run.contentEnd) splices.push({ start: run.contentStart, end: run.contentEnd, replacement: "" });
  }
  if (lines.length > 1) {
    const extra = lines.slice(1).map((line) => cloneParagraph(attrs, charPrAttrs, line)).join("");
    // 자기닫힘 문단(`<hp:p …/>`)은 그 자리에서 펼친다.
    if (paragraph.selfClosing) {
      splices.push({
        start: paragraph.start,
        end: paragraph.end,
        replacement: `<hp:p${attrs}><hp:run${charPrAttrs}><hp:t>${firstText}</hp:t></hp:run></hp:p>${extra}`
      });
      return true;
    }
    splices.push({ start: paragraph.end, end: paragraph.end, replacement: extra });
  }
  return true;
}

/** 칸 하나에 값을 쓴다. 빈 칸일 때만 손대고, 여러 문단이면 첫 문단을 쓴다. */
function planCellWrite(cell, value, splices) {
  const paragraphs = cell.paragraphs;
  if (!paragraphs.length) return false;
  const target = paragraphs[0];
  return planParagraphWrite(target, value, splices);
}

/* ────────────────────────── 본문 인라인·자리 표시 ────────────────────────── */

function applyTextEdits(paragraph, edits, splices) {
  if (!edits.length) return 0;
  const runs = textRuns(paragraph);
  if (!runs.length) return 0;
  const segments = [];
  let offset = 0;
  for (const run of runs) {
    const length = run.selfClosing ? 0 : run.contentEnd - run.contentStart;
    segments.push({ run, start: offset, end: offset + length });
    offset += length;
  }
  const total = offset;
  const sorted = [...edits]
    .filter((edit) => edit.start >= 0 && edit.end >= edit.start && edit.end <= total)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  let applied = 0;
  let lastEnd = -1;
  for (const edit of sorted) {
    if (edit.start < lastEnd) continue; // 겹치는 편집은 앞의 것만 쓴다
    lastEnd = edit.end;
    let inserted = false;
    for (const segment of segments) {
      if (segment.run.selfClosing) continue;
      const overlaps = edit.start === edit.end
        ? segment.start <= edit.start && edit.start <= segment.end
        : segment.start < edit.end && segment.end > edit.start;
      if (!overlaps && !(edit.start === edit.end && segment.start === edit.start)) continue;
      const localStart = Math.max(0, edit.start - segment.start);
      const localEnd = Math.min(segment.end - segment.start, edit.end - segment.start);
      if (localEnd < localStart) continue;
      const text = inserted ? "" : escapeXmlText(edit.text).replace(/\n+/g, " ");
      splices.push({
        start: segment.run.contentStart + localStart,
        end: segment.run.contentStart + Math.max(localStart, localEnd),
        replacement: text
      });
      inserted = inserted || Boolean(text) || edit.start === edit.end;
    }
    if (inserted) applied += 1;
  }
  return applied;
}

/**
 * 본문 문단 하나의 채우기 편집을 계획한다.
 * "라벨: 값" 인라인 세그먼트가 먼저고, 남은 자리 표시(`{{라벨}}`·`[입력]`·`___`)를 뒤에서 채운다.
 */
function planInlineWrite(xml, paragraph, cursors, filled, where) {
  const runs = textRuns(paragraph);
  if (!runs.length) return [];
  const text = rawTextOf(xml, runs);
  if (!text.trim()) return [];
  const edits = [];
  const consumed = new Set();

  const segments = scanInlineFieldSegments(text);
  for (const segment of segments) {
    const valueText = text.slice(segment.valueStart, segment.valueEnd);
    const state = fillableValueState(valueText);
    if (!state.fillable) continue;
    const label = (state.label || segment.extLabel || segment.label || "").trim();
    if (!label) continue;
    const key = matchKey(label, cursors);
    if (!key) continue;
    const value = consumeValue(cursors.get(key));
    if (value === undefined) continue;
    edits.push({ start: segment.valueStart, end: segment.valueEnd, text: value });
    consumed.add(key);
    filled.push({ key, label, value, where, kind: "inline" });
  }

  // 남은 자리 표시 — 인라인에서 이미 채운 자리는 건너뛴다.
  const patterns = [
    { re: /\{\{\s*([^{}]{1,40}?)\s*\}\}/g, kind: "mustache" },
    { re: /\[\s*([가-힣A-Za-z0-9 ]{0,20}?)\s*\]/g, kind: "bracket" },
    { re: /_{2,}|[ㅇ○◯]{2,}/g, kind: "blank" }
  ];
  for (const { re, kind } of patterns) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text))) {
      const start = match.index;
      const end = start + match[0].length;
      if (edits.some((edit) => start < edit.end && end > edit.start)) continue;
      const rawLabel = (match[1] || "").trim();
      const label = kind === "blank" || !rawLabel || /^(입력|작성|기입)$/.test(rawLabel) ? "" : rawLabel;
      const candidates = label ? [label] : [];
      // 자리 표시에 라벨이 없으면 그 줄 앞쪽 라벨("검토 의견: ___")을 쓴다.
      if (!label) {
        const head = /^\s*([^:：\n]{1,40}?)\s*[:：]\s*$/.exec(text.slice(0, start));
        if (head) candidates.push(head[1].trim());
      }
      let key;
      for (const candidate of candidates) {
        key = matchKey(candidate, cursors);
        if (key) break;
      }
      if (!key) continue;
      const value = consumeValue(cursors.get(key));
      if (value === undefined) continue;
      edits.push({ start, end, text: value });
      consumed.add(key);
      filled.push({ key, label: label || candidates[0] || key, value, where, kind });
    }
  }
  return edits;
}

/* ────────────────────────── 섹션 하나 채우기 ────────────────────────── */

/**
 * 섹션 XML 하나를 값으로 채운다.
 * @returns {{ xml: string, filled: Array, skipped: Array, changed: boolean }}
 */
export function patchSectionXml(xml, values, options = {}) {
  const source = String(xml ?? "");
  const cursors = options.cursors instanceof Map ? options.cursors : createFillCursors(values);
  const root = parseHwpxXml(source);
  const tables = collectTables(root, source);
  const splices = [];
  const filled = [];
  const skipped = [];

  /* 전략 1·2 — 표 */
  for (const table of tables) {
    const rows = table.rows;
    if (!rows.length) continue;
    const headerRow = rows[0];
    const firstRowAllLabels = rows.length >= 2 && headerRow.cells.length > 0
      && headerRow.cells.every((cell) => {
        const trimmed = cell.text.trim();
        return trimmed.length > 0 && trimmed.length <= 20 && isFormLabelCell(trimmed);
      });
    const headerDataTable = firstRowAllLabels && rows[1] && rows[1].cells.length > 0
      && !isFormLabelCell(rows[1].cells[0].text.trim());

    // 전략 2 — 열 머리 아래 데이터 행 (명부형). 배열 값은 행마다 하나씩, 홑값은 첫 데이터 행만.
    if (headerDataTable) {
      for (const headerCell of headerRow.cells) {
        const labelText = headerCell.text.trim();
        const key = matchKey(labelText, cursors);
        if (!key) continue;
        const cursor = cursors.get(key);
        for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
          const cell = rows[rowIndex].cells.find((item) => item.colAddr === headerCell.colAddr);
          if (!cell) continue;
          if (!fillableValueState(cell.text).fillable) continue;
          if (!cursor.array && cursor.index > 0) break;
          const value = consumeValue(cursor);
          if (value === undefined) break;
          if (!planCellWrite(cell, value, splices)) continue;
          filled.push({
            key,
            label: labelText,
            value,
            where: `${table.index + 1}번 표 · ${rowIndex + 1}행 ${cell.colAddr + 1}열`,
            kind: "column"
          });
        }
      }
    }

    // 전략 1 — 라벨 칸 오른쪽의 빈 칸
    for (const row of rows) {
      if (headerDataTable && row.index === 0) continue;
      const cells = row.cells;
      for (let position = 0; position < cells.length; position += 1) {
        const labelCell = cells[position];
        const labelText = labelCell.text.trim();
        if (!labelText || !isFormLabelCell(labelText)) continue;
        const key = matchKey(labelText, cursors);
        if (!key) continue;
        const valueCell = cells.find((cell) => cell !== labelCell && cell.colAddr === labelCell.colAddr + labelCell.colSpan);
        const nextCell = cells.find((cell) => cell !== labelCell && cell.colAddr === labelCell.colAddr + labelCell.colSpan + (valueCell ? valueCell.colSpan : 1));
        const valueText = valueCell ? valueCell.text : "";
        // 하위 라벨("성명" → "한자") 옆 칸은 값 자리가 아니다.
        if (valueCell && isSubLabelBeside(labelCell.rowSpan, valueText, nextCell ? nextCell.text : undefined)) continue;
        if (!valueCell) continue;
        const state = fillableValueState(valueText);
        const where = `${table.index + 1}번 표 · ${row.index + 1}행 ${valueCell.colAddr + 1}열`;
        if (!state.fillable) {
          skipped.push({ label: labelText, key, reason: "칸에 이미 값이 있어 그대로 두었습니다", current: valueText, where });
          continue;
        }
        const cursor = cursors.get(key);
        if (!cursor.array && cursor.index > 0) {
          skipped.push({ label: labelText, key, reason: "같은 라벨의 앞 칸을 이미 채워 그대로 두었습니다", current: valueText, where });
          continue;
        }
        const value = consumeValue(cursor);
        if (value === undefined) continue;
        if (!planCellWrite(valueCell, value, splices)) continue;
        filled.push({ key, label: labelText.replace(/[:：]\s*$/, ""), value, where, kind: "cell" });
      }
    }
  }

  /* 전략 3 — 표 밖 본문 문단 + 한 칸짜리 상자 */
  const inlineTargets = collectBodyParagraphs(root);
  for (const table of tables) {
    if (table.rows.length !== 1 || table.rows[0].cells.length !== 1) continue;
    for (const paragraph of table.rows[0].cells[0].paragraphs) inlineTargets.push(paragraph);
  }
  let paragraphIndex = 0;
  const seen = new Set();
  for (const paragraph of inlineTargets) {
    if (seen.has(paragraph)) continue;
    seen.add(paragraph);
    const where = `본문 ${paragraphIndex + 1}번째 문단`;
    paragraphIndex += 1;
    const edits = planInlineWrite(source, paragraph, cursors, filled, where);
    if (edits.length) applyTextEdits(paragraph, edits, splices);
  }

  const changed = splices.length > 0;
  return { xml: changed ? applySplices(source, splices) : source, filled, skipped, changed };
}

/** 잘라 바꾸기 — 뒤에서부터 적용해 앞쪽 위치가 밀리지 않게 한다. */
function applySplices(source, splices) {
  const sorted = [...splices].sort((a, b) => b.start - a.start || b.end - a.end);
  let output = source;
  let limit = source.length;
  for (const splice of sorted) {
    if (splice.start < 0 || splice.end > output.length || splice.start > splice.end) continue;
    // 뒤에서부터 적용하므로, 앞서 적용한 편집과 겹치는 편집은 건너뛴다.
    if (splice.end > limit) continue;
    output = `${output.slice(0, splice.start)}${splice.replacement}${output.slice(splice.end)}`;
    limit = splice.start;
  }
  return output;
}

/* ────────────────────────── 파일 전체 ────────────────────────── */

/**
 * .hwpx 바이트 전체를 값으로 채워 새 .hwpx 바이트를 만든다.
 * ZIP 안의 섹션 XML만 바뀌고 나머지 엔트리는 그대로다. mimetype 은 압축하지 않고 맨 앞에 둔다(HWPX 규칙).
 */
export async function patchHwpxBytes({ bytes, values, jszip } = {}) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!input.length) throw new Error("채울 .hwpx 파일이 없습니다. 양식 파일을 올리거나 연습 양식을 불러와 주세요.");
  const JSZip = jszip || (await import("jszip")).default;
  const zip = await JSZip.loadAsync(input);
  const names = Object.keys(zip.files);
  const sectionNames = names.filter((name) => SECTION_ENTRY_RE.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const targets = sectionNames.length ? sectionNames : names.filter((name) => /\.xml$/i.test(name) && !/META-INF|version\.xml|settings\.xml/i.test(name));
  if (!targets.length) throw new Error("HWPX에서 본문(Contents/section*.xml)을 찾지 못했습니다.");

  const cursors = createFillCursors(values);
  const filled = [];
  const skipped = [];
  const edited = new Map();
  for (const name of targets) {
    const xml = await zip.file(name).async("text");
    const result = patchSectionXml(xml, values, { cursors });
    filled.push(...result.filled.map((item) => ({ ...item, section: name })));
    skipped.push(...result.skipped.map((item) => ({ ...item, section: name })));
    if (result.changed) edited.set(name, result.xml);
  }

  const output = new JSZip();
  // mimetype 은 압축하지 않고 ZIP 의 첫 엔트리로 둔다(HWPX 규칙 — 뷰어가 앞에서 형식을 먼저 읽는다).
  const mimeEntry = zip.file("mimetype");
  if (mimeEntry) output.file("mimetype", await mimeEntry.async("uint8array"), { compression: "STORE" });
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) {
      output.folder(name.replace(/\/$/, ""));
      continue;
    }
    if (name === "mimetype") continue;
    const data = edited.has(name) ? edited.get(name) : await entry.async("uint8array");
    // 문자열은 JSZip 이 UTF-8 로 쓰고, 바이트는 그대로 넣는다(binary:true 를 주면 한글이 깨진다).
    if (typeof data === "string") output.file(name, data);
    else output.file(name, data, { binary: true });
  }
  const outBytes = await output.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });

  const unmatched = Object.keys(values && typeof values === "object" ? values : {}).filter((label) => {
    const cursor = cursors.get(normalizeFormLabel(label));
    return !cursor || cursor.index === 0;
  });

  return {
    bytes: outBytes,
    filled,
    skipped,
    unmatched,
    sectionCount: targets.length,
    changed: edited.size > 0
  };
}

/** 채운 파일 이름 — "양식.hwpx" → "양식-채움.hwpx" */
export function filledFileName(fileName, fallback = "양식") {
  const base = String(fileName || "").replace(/\.(hwpx|hwp)$/i, "").trim() || fallback;
  return `${base}-채움.hwpx`;
}

/** 채우기 결과를 화면 문장으로바꾼다. */
export function summarizeFill(result) {
  const filledCount = (result?.filled || []).length; // 채운 칸 수
  const skippedCount = (result?.skipped || []).length;
  const unmatchedCount = (result?.unmatched || []).length;
  const parts = [`${filledCount}칸을 채웠습니다`];
  if (skippedCount) parts.push(`${skippedCount}칸은 원본 값을 그대로 두었습니다`);
  if (unmatchedCount) parts.push(`${unmatchedCount}개 값은 들어갈 칸을 찾지 못했습니다`);
  return `${parts.join(" · ")}.`;
}
