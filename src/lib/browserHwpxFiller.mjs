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

import { isBlankValueCell, isDatePlaceholderCell, isFormLabelCell, isInlineSignatureBlock, isSignaturePlaceholderCell, isSubLabelBeside, findMatchingFieldKey, normalizeFormLabel, scanInlineFieldSegments } from "./kordocFormSpec.mjs";
import { isPackageListEntry, isPreviewTextEntry, planPreviewPatch, stripPreviewImageReferences, writePreviewText } from "./hwpxPreview.mjs";

export const HWPX_MIME = "application/hwp+zip";
/** 다시 읽을 때 본문으로 보는 ZIP 엔트리 */
const SECTION_ENTRY_RE = /^Contents\/section\d+\.xml$/i;
/** 칸 글자를 모을 때 넘어가는 요소 — 안쪽 표·글상자의 글자는 그 칸 글자가 아니다. */
const OPAGUE_LOCALS = new Set(["tbl", "drawtext", "equation", "chart", "header", "footer"]);
const FILL_PLACEHOLDER_RE = /^\{\{\s*[^{}]{1,40}?\s*\}\}$|^\[\s*[가-힣A-Za-z0-9 ]{0,20}\s*\]$|^_{2,}$|^[ㅇ○◯]{2,}$|^\.{3,}$/;
/**
 * `<hp:t>` 안에 섞여 들어오는 인라인 요소 — 한글에서 줄바꿈(Shift+Enter)·탭·고정폭 빈칸을 쓴 자리.
 * 이런 요소를 글자로 세면 라벨·값 비교가 어긋나므로 같은 길이의 빈칸으로 바꾼다(위치 offset 유지).
 */
const INLINE_MARKUP_RE = /<(?:[\w.-]+:)?(?:lineBreak|tab|fwSpace|nbspace|nonBreakSpace)\b[^>]*\/?>/gi;

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

/** 요소 안에 특정 이름의 요소가 들어 있는가 — 칸 안의 표를 찾을 때 쓴다. */
function containsLocal(node, local) {
  for (const child of elementsOf(node)) {
    if (child.local === local) return true;
    if (containsLocal(child, local)) return true;
  }
  return false;
}

/** 글자 안 인라인 요소를 같은 길이의 빈칸으로 바꾼다 — offset 을 그대로 두고 글자만 깨끗하게. */
function neutralizeInlineMarkup(text) {
  return String(text ?? "").replace(INLINE_MARKUP_RE, (tag) => " ".repeat(tag.length));
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
  return decodeEntities(neutralizeInlineMarkup(rawTextOf(xml, runs))).replace(/&lt;\/(?:hp:)?[a-zA-Z]+&gt;/g, " ").replace(/\s+/g, " ").trim();
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
        // 표마다 행 수집은 격리하지만(안쪽 표의 행은 바깥 표 행이 아니다),
        // 레이아웃 칸 안에 든 라벨/값 표도 채우기 대상이 되도록 안쪽까지 계속 내려간다.
        tables.push(readTable(child, xml, tables.length));
        walk(child);
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

/** 문서 안 모든 문단 — 표 칸·한 칸짜리 틀 안의 문단까지. 문서 제목 갈아끼우기에 쓴다. */
function collectAllParagraphs(root) {
  const paragraphs = [];
  const walk = (node) => {
    for (const child of elementsOf(node)) {
      if (child.local === "p") {
        if (!paragraphs.includes(child)) paragraphs.push(child);
      }
      // 표를 품은 문단도 안으로 들어간다 — 표 칸 안 문단까지 찾으려면 여기서 멈추면 안 된다.
      walk(child);
    }
  };
  walk(root);
  return paragraphs;
}

/* ────────────────────────── 전년도 값 교체(양식 이양) ────────────────────────── */

/**
 * 이 칸의 지금 값을 덮어써도 되는가 — 양식 이양 모드에서만 쓴다.
 * 이양 계획이 정한 ‘라벨 키 → 바꾸기 전 글자’ 목록에 정확히 일치할 때만 허용한다.
 * 같은 라벨이라도 글자가 다르면(사람이 이미 고친 칸) 건드리지 않는다.
 */
function overwriteAllowed(overwrites, key, text) {
  if (!key || !overwrites) return false;
  const allowed = overwrites instanceof Map ? overwrites.get(key) : overwrites[String(key)];
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return false;
  return Array.isArray(allowed) && allowed.includes(trimmed);
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
  // (서명/인)·(인) 같은 서명 자리 표시는 ‘이미 적힌 값’이 아니라 이름을 넣을 자리다.
  if (isSignaturePlaceholderCell(trimmed)) return { fillable: true, placeholder: trimmed };
  if (FILL_PLACEHOLDER_RE.test(trimmed)) {
    const mustache = /^\{\{\s*([^{}]{1,40}?)\s*\}\}$/.exec(trimmed);
    return { fillable: true, placeholder: trimmed, label: mustache ? mustache[1].trim() : "" };
  }
  if (isDatePlaceholderCell(trimmed)) return { fillable: true, placeholder: trimmed };
  return { fillable: false, placeholder: "" };
}

/**
 * 예산 관리표를 양식에 넣을 때 쓰는 열 이름 별칭 — 사용자가 이름을 바꿔도, 양식이 다른 말을 써도
 * 같은 역할의 열을 찾을 수 있게 한다. 양식 쪽 머리글을 역할로 읽는 데 쓴다.
 */
const ROLE_LABEL_ALIASES = {
  category: ["비목", "비목명", "구분", "항목", "분류", "재원", "예산비목"],
  item: ["세목", "세목명", "내역", "내용", "품목", "품명", "세부내용", "세부사업명", "지출내역", "사업내용"],
  unitPrice: ["단가", "단가액", "단위단가", "단가원"],
  qty: ["수량", "횟수", "회수"],
  budget: ["편성액", "계획액", "예산액", "계상액", "예산편성액", "금액", "합계금액"],
  spent: ["집행액", "집행금액", "집행", "지출액", "실집행액", "실행액"],
  balance: ["잔액", "잔액원", "남은액"],
  basis: ["산출근거", "산출내역", "산출기초", "계산근거", "산출", "산출내용"],
  note: ["비고", "메모", "참고", "적요"]
};

const ROLE_BY_ALIAS = (() => {
  const map = new Map();
  for (const [role, labels] of Object.entries(ROLE_LABEL_ALIASES)) {
    for (const label of labels) map.set(normalizeFormLabel(label), role);
  }
  return map;
})();

/**
 * 양식 표의 머리글 줄과 예산 관리표의 열을 맞춘다.
 * - 먼저 사용자가 붙인 이름 그대로(정규화) 같은 열을 찾고,
 * - 없으면 양식 머리글을 역할(비목·세목·산출내역·국비 같은 열)로 읽어 그 역할의 열을 찾는다.
 * @param {Array<{text:string, colAddr:number}>} cells 머리글 줄의 칸들
 * @param {Array<{id:string, role:string, label:string}>} columns 예산 관리표의 열
 * @returns {Array<{colAddr:number, index:number, column:object}>}
 */
export function matchBudgetHeader(cells, columns) {
  const list = Array.isArray(columns) ? columns.filter((column) => column && column.label) : [];
  const used = new Set();
  const matches = [];
  for (const cell of Array.isArray(cells) ? cells : []) {
    const label = String(cell?.text ?? "").trim();
    if (!label) continue;
    const key = normalizeFormLabel(label);
    if (!key) continue;
    const mark = (column) => (column.role === "custom" ? column.id : column.role);
    let index = list.findIndex((column) => !used.has(mark(column)) && normalizeFormLabel(column.label) === key);
    if (index < 0) {
      const role = ROLE_BY_ALIAS.get(key);
      if (role) index = list.findIndex((column) => !used.has(mark(column)) && column.role === role);
    }
    if (index < 0) continue;
    const column = list[index];
    used.add(mark(column));
    matches.push({ colAddr: cell.colAddr, index, column });
  }
  return matches;
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
function planInlineWrite(xml, paragraph, cursors, filled, where, mayOverwrite) {
  const runs = textRuns(paragraph);
  if (!runs.length) return [];
  // 인라인 요소는 같은 길이의 빈칸으로 바꿔 두어, 편집 위치(offset)가 원문과 계속 맞게 한다.
  const text = neutralizeInlineMarkup(rawTextOf(xml, runs));
  if (!text.trim()) return [];
  const edits = [];
  const consumed = new Set();

  const segments = scanInlineFieldSegments(text);
  for (const segment of segments) {
    const valueText = text.slice(segment.valueStart, segment.valueEnd);
    const state = fillableValueState(valueText);
    // ‘강사 성명’처럼 수식어가 붙은 라벨은 ‘성명’ 키로도 찾는다.
    const label = (state.label || segment.extLabel || segment.label || "").trim();
    if (!state.fillable) {
      // 전년도 값이 적힌 문장도 이양 계획이 같은 글자로 짚으면 갈아끼운다.
      const overwriteKey = matchKey(label, cursors) || (segment.label && segment.label !== label ? matchKey(segment.label, cursors) : undefined);
      if (!overwriteKey || !mayOverwrite(overwriteKey, valueText)) continue;
    }
    if (!label) continue;
    const key = matchKey(label, cursors) || (segment.label && segment.label !== label ? matchKey(segment.label, cursors) : undefined);
    if (!key) continue;
    const value = consumeValue(cursors.get(key));
    if (value === undefined) continue;
    edits.push({ start: segment.valueStart, end: segment.valueEnd, text: value });
    consumed.add(key);
    filled.push({ key, label, value, where, kind: "inline", replaced: state.fillable ? undefined : valueText.trim() });
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
  const overwrites = options.overwrites instanceof Map ? options.overwrites : null;
  const overwriteObject = !overwrites && options.overwrites && typeof options.overwrites === "object" ? options.overwrites : null;
  const mayOverwrite = (key, text) =>
    (overwrites && overwriteAllowed(overwrites, key, text))
    || (overwriteObject && overwriteAllowed(overwriteObject, key, text));
  const root = parseHwpxXml(source);
  const tables = collectTables(root, source);
  const splices = [];
  const filled = [];
  const skipped = [];
  /** 표 전략에서 라벨 칸으로 판정한 칸 — 인라인(서명 블록) 전략이 같은 칸을 다시 쓰지 않게 한다. */
  const labelCellNodes = new Set();
  /** 예산 관리표 열로 이미 채운 칸 — 라벨 전략이 같은 칸을 다른 값으로 덮지 않게 한다. */
  const budgetCellNodes = new Set();
  const budgetSheet = options.budgetSheet && Array.isArray(options.budgetSheet.rows) && Array.isArray(options.budgetSheet.columns)
    ? options.budgetSheet
    : null;

  /**
   * 라벨 옆 칸이 값 자리가 아니라 표 제목 띠·레이아웃 여백인가.
   * - 여러 열을 덮은 제목 칸(“강사카드”, “인적사항”)은 구역 제목이지 라벨이 아니다.
   * - 라벨 옆 빈 칸 뒤에 다른 내용이 이어지면(‘총 괄 | 빈칸 | 빈칸 | 담당부서’) 그 빈 칸은 값 자리가 아니다.
   * - 값 칸 안에 표가 들어 있으면(안내 상자) 값을 덮어쓰면 안 된다.
   */
  const isBandLabelPair = (table, cells, labelCell, valueCell) => {
    if (table.columnCount >= 2 && labelCell.colSpan >= table.columnCount) return true;
    if (labelCell.colSpan >= 3) return true;
    if (labelCell.colSpan >= 2 && valueCell.rowSpan >= 3) return true;
    if (containsLocal(valueCell.node, "tbl")) return true;
    // 행 앞쪽이 전부 빈칸이면 행 머리가 아니라 표 안의 격자 칸이다(책임분담표 같은 다열 표).
    const before = cells.filter((cell) => cell.colAddr < labelCell.colAddr);
    if (before.length && before.every((cell) => !cell.text.trim())) return true;
    if (!fillableValueState(valueCell.text).fillable) return false;
    const after = cells.filter((cell) => cell.colAddr >= valueCell.colAddr + valueCell.colSpan);
    const immediate = after[0];
    if (immediate && isFormLabelCell(immediate.text.trim())) {
      // 같은 행에 ‘라벨 | 빈칸’이 하나 더 있으면 두 칸짜리 양식 줄이다.
      const afterImmediate = after[1];
      if (afterImmediate && fillableValueState(afterImmediate.text).fillable) return false;
      return true;
    }
    const later = after.slice(1).some((cell) => cell.text.trim());
    return Boolean((immediate && immediate.text.trim()) || later);
  };

  /* 전략 1·2 — 표 */
  /** 행 하나를 덮은 칸뿐인 구역 제목 띠인가(‘자격사항’, ‘강사카드’) */
  const isBandRowNode = (table, row) => {
    const filled = row.cells.filter((cell) => cell.text.trim());
    if (!filled.length || filled.length > 1) return false;
    const cell = filled[0];
    return cell.colSpan >= 3 || (table.columnCount >= 2 && cell.colSpan >= table.columnCount);
  };
  for (const table of tables) {
    const rows = table.rows;
    if (!rows.length) continue;
    // 제목 띠 다음 줄부터가 실제 머리 행이다 — 띠를 머리로 보면 ‘경력 → 기간’처럼 머리를 값으로 오인한다.
    let headerIndex = 0;
    while (headerIndex < rows.length - 1 && isBandRowNode(table, rows[headerIndex])) headerIndex += 1;
    const headerRow = rows[headerIndex];
    const firstRowAllLabels = rows.length - headerIndex >= 2 && headerRow.cells.length >= 2
      && headerRow.cells.every((cell) => {
        const trimmed = cell.text.trim();
        return trimmed.length > 0 && trimmed.length <= 20 && isFormLabelCell(trimmed);
      });
    const headerDataTable = firstRowAllLabels && rows[headerIndex + 1] && rows[headerIndex + 1].cells.length > 0
      && !isFormLabelCell(rows[headerIndex + 1].cells[0].text.trim());

    // 전략 2a — 예산 관리표의 열 머리(사용자가 바꾼 이름·더한 열)로 표를 채운다.
    // 양식 표의 머리글이 예산표의 머리글과 맞으면, 그 아래 빈 칸을 예산표의 행 순서대로 채운다.
    if (budgetSheet) {
      const matches = matchBudgetHeader(headerRow.cells, budgetSheet.columns);
      if (matches.length >= 2) {
        let sheetRow = 0;
        for (let rowIndex = headerIndex + 1; rowIndex < rows.length && sheetRow < budgetSheet.rows.length; rowIndex += 1) {
          const row = rows[rowIndex];
          if (isBandRowNode(table, row)) continue;
          const rowValues = budgetSheet.rows[sheetRow] || [];
          // 합계 줄은 값으로 덮지 않는다 — 양식이 이미 가진 합계식을 지우게 된다.
          if (row.cells.some((cell) => /^\s*(합\s*계|총\s*계|소\s*계)\s*$/.test(cell.text))) break;
          for (const match of matches) {
            const cell = row.cells.find((item) => item.colAddr === match.colAddr);
            if (!cell || budgetCellNodes.has(cell.node)) continue;
            const value = String(rowValues[match.index] ?? "").trim();
            if (!value) continue;
            const current = cell.text.trim();
            if (current === value) {
              budgetCellNodes.add(cell.node);
              continue;
            }
            const state = fillableValueState(current);
            const key = normalizeFormLabel(match.column.label);
            const canOverwrite = !state.fillable && mayOverwrite(key, current);
            if (!state.fillable && !canOverwrite) {
              skipped.push({ label: match.column.label, key, reason: "칸에 이미 값이 있어 그대로 두었습니다", current, where: `${table.index + 1}번 표 · ${rowIndex + 1}행 ${match.colAddr + 1}열` });
              continue;
            }
            if (!planCellWrite(cell, value, splices)) continue;
            budgetCellNodes.add(cell.node);
            filled.push({
              key: match.column.label,
              label: match.column.label,
              value,
              replaced: state.fillable ? undefined : current,
              where: `${table.index + 1}번 표 · ${rowIndex + 1}행 ${match.colAddr + 1}열`,
              kind: "budget"
            });
          }
          sheetRow += 1;
        }
      }
    }

    // 전략 2 — 열 머리 아래 데이터 행 (명부형). 배열 값은 행마다 하나씩, 홑값은 첫 데이터 행만.
    if (headerDataTable) {
      for (const headerCell of headerRow.cells) {
        const labelText = headerCell.text.trim();
        const key = matchKey(labelText, cursors);
        if (!key) continue;
        const cursor = cursors.get(key);
        for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
          const cell = rows[rowIndex].cells.find((item) => item.colAddr === headerCell.colAddr);
          if (!cell || budgetCellNodes.has(cell.node)) continue;
          const cellState = fillableValueState(cell.text);
          // 전년도 값이 적힌 칸 — 이양 계획이 같은 글자로 짚은 칸만 갈아끼운다.
          if (!cellState.fillable && !mayOverwrite(key, cell.text)) continue;
          if (!cursor.array && cursor.index > 0) break;
          const value = consumeValue(cursor);
          if (value === undefined) break;
          if (!planCellWrite(cell, value, splices)) continue;
          filled.push({
            key,
            label: labelText,
            value,
            replaced: cellState.fillable ? undefined : cell.text.trim(),
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
        // 인라인 서명 블록 칸은 라벨 칸이 아니다 — 라벨 여러 개의 자리라 인라인 전략이 맡는다.
        if (!labelText || isInlineSignatureBlock(labelText) || !isFormLabelCell(labelText)) continue;
        labelCellNodes.add(labelCell.node);
        const key = matchKey(labelText, cursors);
        if (!key) continue;
        const valueCell = cells.find((cell) => cell !== labelCell && cell.colAddr === labelCell.colAddr + labelCell.colSpan);
        const nextCell = cells.find((cell) => cell !== labelCell && cell.colAddr === labelCell.colAddr + labelCell.colSpan + (valueCell ? valueCell.colSpan : 1));
        if (valueCell && budgetCellNodes.has(valueCell.node)) continue;
        const valueText = valueCell ? valueCell.text : "";
        // 하위 라벨("성명" → "한자") 옆 칸이나 병합 행 머리 오른쪽 열 머리는 값 자리가 아니다.
        if (valueCell && isInlineSignatureBlock(valueCell.text)) continue;
        if (valueCell && isSubLabelBeside(labelCell.rowSpan, valueText, nextCell ? nextCell.text : undefined)) continue;
        if (!valueCell) continue;
        if (isBandLabelPair(table, cells, labelCell, valueCell)) continue;
        const state = fillableValueState(valueText);
        const where = `${table.index + 1}번 표 · ${row.index + 1}행 ${valueCell.colAddr + 1}열`;
        const canOverwrite = !state.fillable && mayOverwrite(key, valueText);
        if (!state.fillable && !canOverwrite) {
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
        filled.push({ key, label: labelText.replace(/[:：]\s*$/, ""), value, replaced: canOverwrite ? valueText.trim() : undefined, where, kind: "cell" });
      }
    }
  }

  /* 전략 3 — 표 밖 본문 문단 + 한 칸짜리 상자 + 칸 안 인라인 서명 블록 */
  const inlineTargets = collectBodyParagraphs(root);
  for (const table of tables) {
    if (table.rows.length === 1 && table.rows[0].cells.length === 1) {
      for (const paragraph of table.rows[0].cells[0].paragraphs) inlineTargets.push(paragraph);
    }
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (labelCellNodes.has(cell.node)) continue;
        if (containsLocal(cell.node, "tbl")) continue;
        if (!isInlineSignatureBlock(cell.text)) continue;
        for (const paragraph of cell.paragraphs) inlineTargets.push(paragraph);
      }
    }
  }
  let paragraphIndex = 0;
  const seen = new Set();
  for (const paragraph of inlineTargets) {
    if (seen.has(paragraph)) continue;
    seen.add(paragraph);
    const where = `본문 ${paragraphIndex + 1}번째 문단`;
    paragraphIndex += 1;
    const edits = planInlineWrite(source, paragraph, cursors, filled, where, mayOverwrite);
    if (edits.length) applyTextEdits(paragraph, edits, splices);
  }

  /* 전략 4 — 글자 전체를 갈아끼우는 문단·칸 (문서 제목)
   * 라벨이 없는 자리라 라벨 키로는 찾을 수 없다. 원본 글자와 정확히 같은 문단만 바꿔
   * 다른 문단이나 사람이 고쳐 둔 글을 건드리지 않는다. */
  const rewrites = Array.isArray(options.rewrites) ? options.rewrites : [];
  if (rewrites.length) {
    const targets = collectAllParagraphs(root);
    const rewritten = new Set();
    for (const rewrite of rewrites) {
      const from = String(rewrite?.from ?? "").trim();
      const to = String(rewrite?.to ?? "").trim();
      if (!from || !to || from === to) continue;
      for (const paragraph of targets) {
        if (rewritten.has(paragraph)) continue;
        const text = visibleTextOf(source, textRuns(paragraph));
        if (text !== from) continue;
        if (!planParagraphWrite(paragraph, to, splices)) continue;
        rewritten.add(paragraph);
        filled.push({
          key: String(rewrite.label ?? "문서 제목"),
          label: String(rewrite.label ?? "문서 제목"),
          value: to,
          replaced: from,
          where: "문서 제목 문단",
          kind: "text"
        });
        break;
      }
    }
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
 * 미리보기(Preview/)는 원본을 그대로 두면 채운 본문과 어긋나므로 새로 맞춘다 — 글자는 채운 본문에서 다시 뽑고,
 * 옛 그림(PrvImage)은 넣지 않는다(hwpxPreview.mjs).
 */
export async function patchHwpxBytes({ bytes, values, jszip, overwrites, rewrites, budgetSheet } = {}) {
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
    const result = patchSectionXml(xml, values, { cursors, overwrites, rewrites, budgetSheet });
    filled.push(...result.filled.map((item) => ({ ...item, section: name })));
    skipped.push(...result.skipped.map((item) => ({ ...item, section: name })));
    if (result.changed) edited.set(name, result.xml);
  }

  // 미리보기는 ‘채운 뒤의 본문’에서 다시 만든다 — 원본 미리보기를 복사하면 옛 연도 문서로 보인다.
  const preview = planPreviewPatch({
    names,
    sectionXmls: await Promise.all(targets.map(async (name) => (edited.has(name) ? edited.get(name) : await zip.file(name).async("text"))))
  });
  const removeEntries = new Set(preview.removeEntries);

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
    // 옛 미리보기 그림·글자는 넣지 않는다(글자는 아래에서 새로 쓴다).
    if (removeEntries.has(name) || isPreviewTextEntry(name)) continue;
    if (edited.has(name)) {
      output.file(name, edited.get(name));
      continue;
    }
    // 패키지 목록에 미리보기 그림 항목이 남아 있으면 함께 지운다(없는 파일을 가리키는 목록은 깨진다).
    if (isPackageListEntry(name)) {
      output.file(name, stripPreviewImageReferences(await entry.async("text")).xml);
      continue;
    }
    // 바이트는 그대로 넣는다(binary:true 를 주면 한글이 깨진다).
    output.file(name, await entry.async("uint8array"), { binary: true });
  }
  const previewWritten = writePreviewText(output, preview.previewText);
  const outBytes = await output.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });

  const skippedKeys = new Set(skipped.map((item) => item.key).filter(Boolean));
  const unmatched = Object.keys(values && typeof values === "object" ? values : {}).filter((label) => {
    const normalized = normalizeFormLabel(label);
    // 원본 칸을 그대로 둔 값은 ‘자리가 없는 값’이 아니다 — 찾았지만 덮어쓰지 않은 경우로 따로 센다.
    if (skippedKeys.has(normalized)) return false;
    const cursor = cursors.get(normalized);
    return !cursor || cursor.index === 0;
  });

  return {
    bytes: outBytes,
    filled,
    skipped,
    unmatched,
    sectionCount: targets.length,
    changed: edited.size > 0,
    // 미리보기 처리 결과 — 글자는 채운 본문에서 새로 썼고, 그림 미리보기는 넣지 않았다.
    preview: {
      text: preview.previewText,
      chars: preview.previewText.length,
      removedImages: preview.removeEntries,
      written: previewWritten
    }
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
  const replacedCount = (result?.filled || []).filter((item) => item && item.replaced).length; // 전년도 값을 바꾼 칸 수
  const parts = [`${filledCount}칸을 채웠습니다`];
  if (replacedCount) parts.push(`전년도 값 ${replacedCount}칸을 올해 값으로 바꿨습니다`);
  if (skippedCount) parts.push(`${skippedCount}칸은 원본 값을 그대로 두었습니다`);
  if (unmatchedCount) parts.push(`${unmatchedCount}개 값은 들어갈 칸을 찾지 못했습니다`);
  return `${parts.join(" · ")}.`;
}
