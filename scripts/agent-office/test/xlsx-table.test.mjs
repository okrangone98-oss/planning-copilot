import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  buildXlsxBytes,
  columnIndexFromRef,
  columnLetter,
  parseSheetRows,
  readXlsxWorkbook,
  rowsToCsvText,
  rowsToTsvText
} from "../../../src/lib/xlsxTable.mjs";

/* ── 손으로 만든 최소 .xlsx (공유 문자열 · 여러 시트 · 빈 칸) ───────────── */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml "/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;

const SHARED = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="6" uniqueCount="6"><si><t>비목</t></si><si><t>세목</t></si><si><t>인건비</t></si><si><t>외래강사비</t></si><si><r><t>두레</t></r><r><t>동아리</t></r></si><si><t xml:space="preserve">  산출 근거  </t></si></sst>`;

async function buildHandMadeWorkbook() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="예산내역" sheetId="1" r:id="rId1"/><sheet name="집행내역" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", WORKBOOK_RELS);
  zip.file("xl/sharedStrings.xml", SHARED);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="E1" t="inlineStr"><is><t>단가</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="D2"><v>8</v></c><c r="E2"><v>250000</v></c></row><row r="4"><c r="C4" t="s"><v>4</v></c><c r="D4" t="str"><f>A2</f><v>인건비</v></c><c r="E4" t="s"><v>5</v></c></row></sheetData></worksheet>`);
  zip.file("xl/worksheets/sheet2.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>지출일</t></is></c><c r="B1" t="inlineStr"><is><t>금액</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>2026-11-03</t></is></c><c r="B2"><v>48000</v></c></row></sheetData></worksheet>`);
  return zip.generateAsync({ type: "uint8array" });
}

/* ── 시트 읽기 ─────────────────────────────────────────────── */

test("엑셀 워크북의 시트 이름과 공유 문자열을 읽는다", async () => {
  const bytes = await buildHandMadeWorkbook();
  const workbook = await readXlsxWorkbook(bytes);

  assert.deepEqual(workbook.names, ["예산내역", "집행내역"]);
  assert.equal(workbook.name, "예산내역");
  assert.deepEqual(workbook.warnings, []);
  assert.deepEqual(workbook.rows[0], ["비목", "", "세목", "", "단가"]);
  assert.deepEqual(workbook.rows[1], ["인건비", "외래강사비", "", "8", "250000"]);
  // 3행은 통째로 비어 있다 — 빈 배열로 자리를 지킨다.
  assert.deepEqual(workbook.rows[2], []);
  assert.deepEqual(workbook.rows[3], ["", "", "두레동아리", "인건비", "  산출 근거  "]);
});

test("시트를 골라 읽는다 (경로에 공백이 섞여도 찾는다)", async () => {
  const bytes = await buildHandMadeWorkbook();
  const second = await readXlsxWorkbook(bytes, { sheetIndex: 1 });
  assert.equal(second.name, "집행내역");
  assert.deepEqual(second.rows, [["지출일", "금액"], ["2026-11-03", "48000"]]);
});

test("우리가 만든 .xlsx를 다시 읽으면 같은 표가 나온다", async () => {
  const rows = [
    ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출근거", "비고"],
    ["인건비", "외래강사비", "250000", "8", "2000000", "500000", "1500000", "250,000원 × 8회", "두레 4회 × 2명"],
    ["홍보비", "현수막", "80000", "3", "240000", "0", "240000", "80,000원 × 3개", "\"따옴표\" & <기호>"],
    ["일반수용비", "코드", "00123", "", "", "", "", "", ""]
  ];
  const bytes = await buildXlsxBytes({ sheetName: "예산관리표", rows });
  assert.ok(bytes instanceof Uint8Array);
  const workbook = await readXlsxWorkbook(bytes);
  assert.equal(workbook.name, "예산관리표");
  // 끝의 빈 칸은 읽을 때 잘라 낸다(칸 순서는 그대로).
  assert.deepEqual(workbook.rows, [rows[0], rows[1], rows[2], ["일반수용비", "코드", "00123"]]);
});

test("깨진 파일은 던지지 않고 안내를 돌려준다", async () => {
  const result = await readXlsxWorkbook(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(result.rows, []);
  assert.equal(result.names.length, 0);
  assert.match(result.warnings[0], /열지 못했습니다/);
});

test("시트 XML의 빈 칸·수식 값·오류 칸을 안전하게 읽는다", () => {
  const rows = parseSheetRows(`<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>가</t></is></c><c r="B1"/><c r="C1" t="e"><v>#N/A</v></c></row>
<row r="2"><c r="A2"><f>SUM(B1:B1)</f></c><c r="B2" t="b"><v>1</v></c></row>
</sheetData></worksheet>`);
  assert.deepEqual(rows, [["가"], ["", "1"]]);
});

/* ── 열 문자 ↔ 번호 ────────────────────────────────────────── */

test("열 문자와 번호를 서로 바꾼다", () => {
  assert.equal(columnIndexFromRef("A1"), 0);
  assert.equal(columnIndexFromRef("B12"), 1);
  assert.equal(columnIndexFromRef("AA3"), 26);
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
});

/* ── 내려받기 글 ───────────────────────────────────────────── */

test("CSV는 BOM을 붙이고 쉼표·따옴표가 든 칸을 감싼다", () => {
  const csv = rowsToCsvText([["비목", "산출근거"], ["인건비", "250,000원 \"1회\""]]);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.equal(csv.includes('"250,000원 ""1회"""'), true);
  const plain = rowsToCsvText([["가"]], { bom: false });
  assert.equal(plain, "가");
});

test("TSV는 탭·줄바꿈을 칸 안에서 지운다", () => {
  const tsv = rowsToTsvText([["가\t나", "줄\n바꿈"], ["다"]]);
  assert.equal(tsv, "가 나\t줄 바꿈\n다");
});
