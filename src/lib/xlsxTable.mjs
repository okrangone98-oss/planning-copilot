// 엑셀(.xlsx) 표를 브라우저 안에서만 읽고 쓰는 최소 구현.
//
// 왜 직접 만드나: 예산 관리표를 엑셀 파일로 올리고 내려받으려면 .xlsx 를 다뤄야 하는데,
// 유료·무거운 표 라이브러리를 더하지 않기 위해 이미 쓰고 있는 jszip 위에 필요한 부분만 얹는다.
//   읽기: xl/workbook.xml(시트 이름) · xl/_rels/workbook.xml.rels(시트 파일 경로)
//         · xl/sharedStrings.xml(공유 문자열) · xl/worksheets/sheetN.xml(칸 값)
//   쓰기: 최소 구성([Content_Types].xml · _rels/.rels · workbook · sheet1 · styles)
//
// 원칙
//  - 파일은 이 브라우저 안에서만 읽는다(서버로 올리지 않는다).
//  - 읽지 못한 시트는 조용히 넘기지 않고 warnings 로 남긴다.
//  - 수식은 엑셀이 저장해 둔 마지막 계산값(<v>)을 쓴다. 값이 없으면 빈칸.
//  - 셀 값은 모두 문자열로 돌려준다(숫자 서식·날짜 변환은 하지 않는다). 표 파서가 숫자로 다시 읽는다.

const MAX_ROWS = 2000;
const MAX_COLUMNS = 80;
const MAX_CELL = 500;

const ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'"
};

function decodeEntities(value) {
  return String(value ?? "").replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (match) => ENTITIES[match] ?? match);
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** A1 · AB12 같은 셀 주소 → 0부터 세는 열 번호. */
export function columnIndexFromRef(ref) {
  const letters = String(ref ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** 0부터 세는 열 번호 → A · AB 같은 열 문자. */
export function columnLetter(index) {
  let value = Math.max(0, Math.floor(Number(index) || 0)) + 1;
  let letters = "";
  while (value > 0) {
    const rest = (value - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function attribute(attrs, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(String(attrs ?? ""));
  if (!match) return "";
  return decodeEntities(match[2] ?? match[3] ?? "");
}

/** <si> · <is> 안의 <t> 글자를 모두 이어 붙인다(서식이 나뉜 문자열 대응). */
function richText(xml) {
  return Array.from(String(xml ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))
    .map((match) => decodeEntities(match[1]))
    .join("");
}

function parseSharedStrings(xml) {
  const values = [];
  for (const match of String(xml ?? "").matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    values.push(richText(match[1]));
  }
  return values;
}

/** xl/_rels/workbook.xml.rels → {rId: "xl/worksheets/sheet1.xml"} */
function parseRelationships(xml) {
  const map = new Map();
  for (const match of String(xml ?? "").matchAll(/<Relationship\s([^>]*)\/?>/g)) {
    const attrs = match[1];
    const id = attribute(attrs, "Id");
    const target = attribute(attrs, "Target");
    if (!id || !target) continue;
    map.set(id, resolvePartPath(target));
  }
  return map;
}

/** Target 이 "/xl/worksheets/sheet1.xml", "worksheets/sheet1.xml", "../xl/..." 어느 꼴이어도 xl/ 기준 경로로 맞춘다. */
function resolvePartPath(target) {
  const raw = String(target ?? "").replace(/\\/g, "/").trim();
  if (!raw) return "";
  if (raw.startsWith("/")) return raw.slice(1);
  const segments = ["xl", ...raw.split("/")];
  const resolved = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

/** 워크북의 시트 목록 — [{name, path}] (경로를 못 찾은 시트는 path 가 빈칸). */
export function parseWorkbookSheets(workbookXml, relsXml) {
  const rels = parseRelationships(relsXml);
  const sheets = [];
  for (const match of String(workbookXml ?? "").matchAll(/<sheet\s([^>]*)\/?>/g)) {
    const attrs = match[1];
    const name = attribute(attrs, "name");
    const relId = attribute(attrs, "r:id") || attribute(attrs, "id");
    sheets.push({ name: name || `시트 ${sheets.length + 1}`, path: rels.get(relId) || "" });
  }
  return sheets;
}

/** 워크시트 XML → 행×열 문자열. 빈 칸은 ""로 채운다. */
export function parseSheetRows(sheetXml) {
  const rows = [];
  const source = String(sheetXml ?? "");
  for (const rowMatch of source.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const attrs = rowMatch[1];
    const body = rowMatch[2] || "";
    const declared = Number(attribute(attrs, "r")) || rows.length + 1;
    const rowIndex = Math.min(Math.max(declared - 1, 0), MAX_ROWS - 1);
    const cells = [];
    for (const cellMatch of body.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = cellMatch[1];
      const cellBody = cellMatch[2] || "";
      const ref = attribute(cellAttrs, "r");
      const type = attribute(cellAttrs, "t");
      const columnIndex = ref ? columnIndexFromRef(ref) : cells.length;
      if (columnIndex < 0 || columnIndex >= MAX_COLUMNS) continue;
      cells[columnIndex] = cellText(type, cellBody);
    }
    rows[rowIndex] = trimTrailingEmptyCells(cells);
  }
  return trimTrailingEmptyRows(rows);
}

function cellText(type, body) {
  if (!body) return "";
  if (type === "inlineStr") {
    const inline = /<is(?:\s[^>]*)?>([\s\S]*?)<\/is>/.exec(body);
    return richText(inline ? inline[1] : body).slice(0, MAX_CELL);
  }
  const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body);
  if (!value) {
    // 값 없이 수식만 있는 칸 — 엑셀이 계산값을 저장하지 않은 경우.
    return "";
  }
  const raw = decodeEntities(value[1]);
  if (type === "s") {
    const index = Number(raw);
    return Number.isFinite(index) ? String(index) : raw;
  }
  if (type === "e") return "";
  return raw.slice(0, MAX_CELL);
}

function trimTrailingEmptyCells(cells) {
  // 중간에 빠진 칸(예: A1, C1만 있는 행)은 빈 글자로 채워 열 자리를 지킨다.
  const dense = [];
  for (let index = 0; index < cells.length; index += 1) dense.push(cells[index] === undefined ? "" : cells[index]);
  while (dense.length && !dense[dense.length - 1]) dense.pop();
  return dense;
}

function trimTrailingEmptyRows(rows) {
  // 엑셀이 빈 행을 아예 저장하지 않으므로 중간 번호가 비어 있다 — []로 자리를 지킨다.
  const dense = [];
  for (let index = 0; index < rows.length; index += 1) dense.push(Array.isArray(rows[index]) ? rows[index] : []);
  while (dense.length && !dense[dense.length - 1].some((cell) => cell)) dense.pop();
  return dense;
}

async function loadZip(input) {
  const JSZip = (await import("jszip")).default;
  return JSZip.loadAsync(input);
}

async function readPart(zip, path) {
  const file = path ? zip.file(path) : null;
  return file ? file.async("string") : "";
}

/**
 * .xlsx 파일을 읽어 고른 시트의 행×열과 시트 이름 목록을 돌려준다.
 * @param {ArrayBuffer|Uint8Array|{arrayBuffer:Function}} input 파일 바이트 또는 File
 * @param {{sheetIndex?:number, maxRows?:number}} [options]
 * @returns {Promise<{names:string[], index:number, name:string, rows:string[][], warnings:string[]}>}
 */
export async function readXlsxWorkbook(input, options = {}) {
  const warnings = [];
  const bytes = input && typeof input.arrayBuffer === "function" ? await input.arrayBuffer() : input;
  let zip;
  try {
    zip = await loadZip(bytes);
  } catch {
    return { names: [], index: 0, name: "", rows: [], warnings: ["엑셀 파일(.xlsx)을 열지 못했습니다. 파일이 손상되지 않았는지 확인해 주세요."] };
  }

  let workbookXml = await readPart(zip, "xl/workbook.xml");
  let relsXml = await readPart(zip, "xl/_rels/workbook.xml.rels");
  let sheets = parseWorkbookSheets(workbookXml, relsXml);

  // 워크북 설명을 못 읽어도 시트 파일은 zip 안에 있다 — 이름 없이 읽어 준다.
  if (!sheets.length) {
    const fallback = Object.keys(zip.files)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path))
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    sheets = fallback.map((path, index) => ({ name: `시트 ${index + 1}`, path }));
    if (fallback.length) warnings.push("시트 이름표(xl/workbook.xml)를 읽지 못해 시트를 순서대로 읽었습니다.");
  }
  if (!sheets.length) {
    return { names: [], index: 0, name: "", rows: [], warnings: [...warnings, "엑셀 파일 안에서 시트를 찾지 못했습니다."] };
  }

  const requested = Number(options.sheetIndex);
  const index = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 0), sheets.length - 1) : 0;
  const target = sheets[index];

  let path = target.path;
  if (!path || !zip.file(path)) {
    // 관계 파일이 어긋나면 같은 순서의 sheet 파일로 되돌아간다.
    const ordered = sheets.map((sheet) => sheet.path).filter((candidate) => candidate && zip.file(candidate));
    path = ordered[index] || `xl/worksheets/sheet${index + 1}.xml`;
    if (!zip.file(path)) {
      return { names: sheets.map((sheet) => sheet.name), index, name: target.name, rows: [], warnings: [...warnings, `‘${target.name}’ 시트 파일을 찾지 못했습니다.`] };
    }
    warnings.push(`‘${target.name}’ 시트 경로를 이름표에서 찾지 못해 같은 순서의 시트 파일을 읽었습니다.`);
  }

  const sheetXml = await readPart(zip, path);
  const sharedXml = await readPart(zip, "xl/sharedStrings.xml");
  const shared = parseSharedStrings(sharedXml);

  // 공유 문자열(t="s")은 <v>에 번호가 들어 있다 — 번호를 실제 글자로 바꾼다.
  let rows = resolveSharedStrings(sheetXml, parseSheetRows(sheetXml), shared);

  const maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : MAX_ROWS;
  if (rows.length > maxRows) {
    warnings.push(`행이 ${rows.length}개라 앞 ${maxRows}개만 읽었습니다.`);
    rows = rows.slice(0, maxRows);
  }
  if (!rows.length) warnings.push(`‘${target.name}’ 시트가 비어 있습니다.`);

  return { names: sheets.map((sheet) => sheet.name), index, name: target.name, rows, warnings };
}

/**
 * 공유 문자열 번호를 실제 글자로 바꾼다.
 * 칸 태그(t="s")를 다시 훑어 번호가 확실한 칸만 바꾼다(숫자 칸을 글자로 오해하지 않게).
 */
function resolveSharedStrings(sheetXml, rows, shared) {
  if (!shared.length) return rows;
  const next = rows.map((row) => row.slice());
  const source = String(sheetXml ?? "");
  for (const rowMatch of source.matchAll(/<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowIndex = (Number(attribute(rowMatch[1], "r")) || 0) - 1;
    if (rowIndex < 0 || !next[rowIndex]) continue;
    for (const cellMatch of (rowMatch[2] || "").matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (attribute(cellMatch[1], "t") !== "s") continue;
      const ref = attribute(cellMatch[1], "r");
      const columnIndex = ref ? columnIndexFromRef(ref) : -1;
      if (columnIndex < 0) continue;
      const value = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cellMatch[2] || "");
      if (!value) continue;
      const index = Number(decodeEntities(value[1]));
      if (Number.isFinite(index) && index >= 0 && index < shared.length) next[rowIndex][columnIndex] = shared[index];
    }
  }
  return next;
}

/** 시트 행만 필요한 경우의 짧은 이름. */
export async function readXlsxSheetRows(input, options = {}) {
  const result = await readXlsxWorkbook(input, options);
  return { rows: result.rows, name: result.name, names: result.names, warnings: result.warnings };
}

/* ────────────────────────── 쓰기 ────────────────────────── */

/** 값이 숫자로 보이면 숫자 칸으로 쓴다(앞자리 0·쉼표·단위 붙은 글자는 글자 칸). */
function isNumericText(value) {
  const text = String(value ?? "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return false;
  if (/^-?0\d/.test(text)) return false;
  return true;
}

function columnWidths(rows) {
  const columns = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  const widths = [];
  for (let index = 0; index < columns; index += 1) {
    const longest = rows.reduce((max, row) => Math.max(max, String(row?.[index] ?? "").length), 4);
    widths.push(Math.min(Math.max(longest * 1.6 + 4, 8), 40));
  }
  return widths;
}

function buildSheetXml(rows) {
  const safeRows = (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS).map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLUMNS) : []));
  const columns = safeRows.reduce((max, row) => Math.max(max, row.length), 0);
  const widths = columnWidths(safeRows);
  const columnXml = widths.length
    ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width.toFixed(1)}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rowXml = safeRows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const text = String(value ?? "");
      if (!text) return "";
      const ref = `${columnLetter(columnIndex)}${rowIndex + 1}`;
      if (isNumericText(text)) return `<c r="${ref}"><v>${text}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const dimension = columns && safeRows.length ? `<dimension ref="A1:${columnLetter(columns - 1)}${safeRows.length}"/>` : "";
  const pane = safeRows.length ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${dimension}${pane}${columnXml}<sheetData>${rowXml}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="맑은 고딕"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

/**
 * 행×열 → .xlsx 바이트. 첫 줄은 그대로 머리글로 쓴다.
 * @param {{sheetName?:string, rows:string[][]}} params
 * @returns {Promise<Uint8Array>}
 */
export async function buildXlsxBytes({ sheetName = "예산관리", rows = [] } = {}) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const safeName = escapeXml(String(sheetName || "예산관리").replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "예산관리");
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", STYLES_XML);
  zip.file("xl/worksheets/sheet1.xml", buildSheetXml(rows));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/* ────────────────────────── 텍스트로 바꾸기 ────────────────────────── */

/** CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. */
function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 행×열 → CSV 글(엑셀에서 바로 열리도록 BOM 포함). */
export function rowsToCsvText(rows, { bom = true } = {}) {
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row : []).map(csvCell).join(","))
    .join("\r\n");
  return `${bom ? "\uFEFF" : ""}${body}`;
}

/** 행×열 → 탭 구분 글(시트에서 복사한 것과 같은 꼴). 붙여넣기·기존 표 파서에 그대로 넘긴다. */
export function rowsToTsvText(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}
