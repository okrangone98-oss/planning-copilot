import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  createFillCursors,
  escapeXmlText,
  filledFileName,
  fillableValueState,
  parseHwpxXml,
  patchHwpxBytes,
  patchSectionXml,
  summarizeFill
} from "../../../src/lib/browserHwpxFiller.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PRACTICE = path.join(ROOT, "public/practice/plan-practice-form.hwpx");

/** 라벨 | 값 두 칸짜리 행을 가진 최소 표 문단 XML. */
function tableElement(rows) {
  const cells = rows.map((row, rowIndex) => `<hp:tr>${row.map((cell, colIndex) => {
    const header = rowIndex === 0 ? 0 : 0;
    return `<hp:tc name="" header="${header}" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
      + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${cell}</hp:t></hp:run></hp:p></hp:subList>`
      + `<hp:cellAddr colAddr="${colIndex}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
      + `<hp:cellSz width="1000" height="500"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  }).join("")}</hp:tr>`).join("");
  return `<hp:tbl id="1" rowCnt="${rows.length}" colCnt="${rows[0].length}" cellSpacing="0" borderFillIDRef="1">`
    + `<hp:sz width="1000" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>${cells}</hp:tbl>`;
}

function tableXml(rows) {
  return `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17">${tableElement(rows)}</hp:run></hp:p>`;
}

/** 레이아웃 칸(1×1 표) 안에 라벨/값 표를 하나 넣은 문서 — 실제 기관 양식에서 흔한 모양. */
function layoutCellWithNestedTable(innerRows, outerLabel = "구분", outerValue = "") {
  const inner = tableElement(innerRows);
  const layoutCell = `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
    + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${outerLabel}</hp:t></hp:run></hp:p>`
    + `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17">${inner}</hp:run></hp:p></hp:subList>`
    + `<hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="2" rowSpan="1"/>`
    + `<hp:cellSz width="2000" height="900"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  const headerCells = `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
    + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${outerValue}</hp:t></hp:run></hp:p></hp:subList>`
    + `<hp:cellAddr colAddr="1" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
    + `<hp:cellSz width="1000" height="500"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  const outer = `<hp:tbl id="9" rowCnt="1" colCnt="2" cellSpacing="0" borderFillIDRef="1">`
    + `<hp:sz width="3000" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:tr>${layoutCell}${headerCells}</hp:tr></hp:tbl>`;
  return `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17">${outer}</hp:run></hp:p>`;
}

function sectionXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
}

/** 결과 XML에서 hp:t 글자를 문서 순서로 모은다(재읽기 검증용). */
function textsOf(xml) {
  return Array.from(String(xml).matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)).map((match) => match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"));
}

test("escapeXmlText escapes XML special characters and drops control characters", () => {
  assert.equal(escapeXmlText("A&B <C> \"D\""), "A&amp;B &lt;C&gt; \"D\"");
  assert.equal(escapeXmlText("줄\u0000바꿈\t유지"), "줄바꿈\t유지");
  assert.equal(escapeXmlText(""), "");
});

test("parseHwpxXml keeps offsets for self-closing and nested elements", () => {
  const xml = '<a><b x="1"/><c>글</c></a>';
  const root = parseHwpxXml(xml);
  const [a] = root.children.filter((child) => child.type !== "text");
  assert.equal(a.name, "a");
  const [, c] = a.children.filter((child) => child.type !== "text");
  assert.equal(c.name, "c");
  assert.equal(xml.slice(c.openEnd, c.closeStart), "글");
});

test("fillableValueState treats blanks, placeholders and date blanks as fillable", () => {
  assert.equal(fillableValueState("").fillable, true);
  assert.equal(fillableValueState("   ").fillable, true);
  assert.equal(fillableValueState("___").fillable, true);
  assert.equal(fillableValueState("[입력]").fillable, true);
  assert.equal(fillableValueState("{{사업명}}").label, "사업명");
  assert.equal(fillableValueState("년   월   일").fillable, true);
  assert.equal(fillableValueState("이미 적힌 값").fillable, false);
});

test("patchSectionXml fills the cell right of a label and keeps its run format", () => {
  const xml = sectionXml(tableXml([["구분", "내용"], ["사업명", ""]]));
  const result = patchSectionXml(xml, { 사업명: "양양 생활문화 혁신 지원사업" });
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].key, "사업명");
  const cellAround = (source, needle) => {
    const at = source.indexOf(needle);
    assert.ok(at >= 0, `${needle} 를 찾지 못했습니다`);
    return source.slice(source.lastIndexOf("<hp:tc ", at), source.indexOf("</hp:tc>", at) + "</hp:tc>".length);
  };
  const before = cellAround(xml, "사업명");
  const after = cellAround(result.xml, "양양 생활문화 혁신 지원사업");
  // 값 칸의 run·charPrIDRef·문단 모양이 그대로 남는다
  assert.equal((after.match(/charPrIDRef="17"/g) || []).length, 1);
  assert.equal((after.match(/paraPrIDRef="9"/g) || []).length, 1);
  assert.match(after, /cellAddr colAddr="1" rowAddr="1"/);
  assert.ok(before.includes('charPrIDRef="17"'));
  assert.deepEqual(textsOf(result.xml), ["구분", "내용", "사업명", "양양 생활문화 혁신 지원사업"]);
});

test("patchSectionXml escapes XML special characters in values", () => {
  const xml = sectionXml(tableXml([["구분", "내용"], ["산출 내역", ""]]));
  const result = patchSectionXml(xml, { "산출 내역": "단가 30,000원 & 2회 <합계>" });
  assert.match(result.xml, /단가 30,000원 &amp; 2회 &lt;합계&gt;/);
  assert.deepEqual(textsOf(result.xml).at(-1), "단가 30,000원 & 2회 <합계>");
});

test("patchSectionXml writes multi-line values as extra paragraphs inside the cell", () => {
  const xml = sectionXml(tableXml([["구분", "내용"], ["추진 내용", ""]]));
  const result = patchSectionXml(xml, { "추진 내용": "1) 워크숍 4회\n2) 자원 조사 2회\n3) 시범 운영 2회" });
  assert.equal(result.filled.length, 1);
  const lines = textsOf(result.xml);
  assert.deepEqual(lines.slice(-3), ["1) 워크숍 4회", "2) 자원 조사 2회", "3) 시범 운영 2회"]);
  // 복제한 문단도 같은 문단 모양을 쓴다
  assert.equal((result.xml.match(/<hp:p paraPrIDRef="9" styleIDRef="0">/g) || []).length, 4 + 2);
});

test("patchSectionXml leaves cells that already hold text untouched", () => {
  const xml = sectionXml(tableXml([["구분", "내용"], ["사업명", "작년 사업명"], ["수행기관", ""]]));
  const result = patchSectionXml(xml, { 사업명: "새 사업명", 수행기관: "양양군농촌활성화지원센터" });
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].key, "수행기관");
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].label, "사업명");
  assert.match(result.skipped[0].reason, /이미 값/);
  assert.deepEqual(textsOf(result.xml), ["구분", "내용", "사업명", "작년 사업명", "수행기관", "양양군농촌활성화지원센터"]);
});

test("patchSectionXml fills table placeholders and inline labels in body text", () => {
  const body = tableXml([["구분", "내용"], ["사업기간", "{{사업기간}}"]])
    + `<hp:p paraPrIDRef="18" styleIDRef="0"><hp:run charPrIDRef="26"><hp:t>검토 의견: [입력]</hp:t></hp:run></hp:p>`;
  const result = patchSectionXml(sectionXml(body), { 사업기간: "2027. 3. ~ 11.", "검토 의견": "예산 근거를 보완했습니다" });
  assert.equal(result.filled.length, 2);
  assert.deepEqual(textsOf(result.xml), ["구분", "내용", "사업기간", "2027. 3. ~ 11.", "검토 의견: 예산 근거를 보완했습니다"]);
});

test("patchSectionXml fills a column-header table row by row with array values", () => {
  const xml = sectionXml(tableXml([
    ["성명", "소속"],
    ["", ""],
    ["", ""]
  ]));
  const result = patchSectionXml(xml, { 성명: ["김하나", "이두나"] });
  assert.equal(result.filled.length, 2);
  assert.deepEqual(result.filled.map((item) => item.value), ["김하나", "이두나"]);
  assert.deepEqual(textsOf(result.xml), ["성명", "소속", "김하나", "", "이두나", ""]);
});

test("patchSectionXml fills a label/value table nested inside a layout cell", () => {
  // Codex 리뷰: 레이아웃 칸 안쪽 표를 건너뛰어 다운로드 때 대상 칸을 못 찾던 문제
  const xml = sectionXml(layoutCellWithNestedTable([["사업명", ""], ["수행기관", ""]]));
  const result = patchSectionXml(xml, { 사업명: "2027 양양 시군역량강화사업", 수행기관: "양양군농촌활성화지원센터" });
  assert.equal(result.filled.length, 2);
  assert.deepEqual(result.filled.map((item) => item.key).sort(), ["수행기관", "사업명"].sort());
  // 안쪽 표는 바깥 표와 따로 세어 2번 표로 잡힌다
  assert.ok(result.filled.every((item) => item.where.startsWith("2번 표")));
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("2027 양양 시군역량강화사업"));
  assert.ok(texts.includes("양양군농촌활성화지원센터"));
  // 표 구조는 그대로 — 안쪽 표도 행·칸 수가 늘거나 줄지 않는다
  assert.equal((result.xml.match(/<hp:tbl /g) || []).length, 2);
  assert.equal((result.xml.match(/<hp:tr>/g) || []).length, (xml.match(/<hp:tr>/g) || []).length);
});

test("patchSectionXml keeps each table's row collection isolated when tables nest", () => {
  // 바깥 표의 라벨/값 칸과 안쪽 표의 라벨/값 칸이 서로의 행으로 새지 않는다
  const xml = sectionXml(layoutCellWithNestedTable([["성명", "소속"], ["", ""], ["", ""]]));
  const filled = patchSectionXml(xml, { 성명: ["김하나", "이두나"] });
  assert.equal(filled.filled.length, 2);
  assert.deepEqual(filled.filled.map((item) => item.value), ["김하나", "이두나"]);
  // 안쪽 표의 행 주소는 2행·3행 — 바깥 표 행과 섞이지 않는다
  assert.deepEqual(filled.filled.map((item) => item.where), ["2번 표 · 2행 1열", "2번 표 · 3행 1열"]);
  assert.equal((filled.xml.match(/<hp:tbl /g) || []).length, 2);
});

test("patchSectionXml reads inline line breaks and tabs inside a cell as spacing", () => {
  // 실제 기관 양식(2027 시군역량강화 예비계획서)은 라벨 칸에 <hp:lineBreak/> 를 쓴다.
  const xml = sectionXml(tableXml([["항목", "내용"], ["사업비<hp:lineBreak/>(천원)", ""], ["사업기간<hp:tab/>", ""]]));
  const result = patchSectionXml(xml, { "사업비(천원)": "400,000", "사업기간": "2027. 1. ~ 12." });
  assert.equal(result.filled.length, 2, JSON.stringify(result.filled));
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("400,000"));
  assert.ok(texts.includes("2027. 1. ~ 12."));
  // 라벨 칸의 원래 글자는 그대로 둔다(줄바꿈 요소도 보존)
  assert.match(result.xml, /사업비<hp:lineBreak\/>/);
});

test("createFillCursors keeps array order and merges labels that normalize the same", () => {
  const cursors = createFillCursors({ "추진 내용": ["가", "나"], "추진내용": "다" });
  const cursor = cursors.get("추진내용");
  assert.equal(cursor.list.length, 3);
  assert.equal(cursor.array, true);
});

test("patchHwpxBytes patches the practice form and the filled file reads back every value", async () => {
  const bytes = new Uint8Array(fs.readFileSync(PRACTICE));
  const values = {
    사업명: "2027 양양 생활문화 혁신 지원사업",
    수행기관: "양양군농촌활성화지원센터",
    사업기간: "2027. 3. ~ 2027. 11.",
    "지역 현황": "빈집 120채, 청년 인구 18% 감소",
    문제점: "청년이 떠나며 콘텐츠를 만들 사람이 줄었습니다.",
    "추진 내용": "1) 워크숍 4회\n2) 자원 조사 2회",
    인건비: "250,000원 × 4회 = 1,000,000원",
    "검토 의견": "제출 전 증빙과 대조해 주세요."
  };
  const result = await patchHwpxBytes({ bytes, values });
  assert.equal(result.changed, true);
  assert.equal(result.filled.length, Object.keys(values).length);
  assert.deepEqual(result.unmatched, []);
  assert.equal(result.sectionCount, 1);

  const zip = await JSZip.loadAsync(result.bytes);
  // mimetype 은 압축하지 않고 맨 앞에 둔다
  assert.equal(await zip.file("mimetype").async("text"), "application/hwp+zip");
  assert.equal(Object.keys(zip.files)[0], "mimetype");
  const section = await zip.file("Contents/section0.xml").async("text");
  const header = await zip.file("Contents/header.xml").async("text");
  // 헤더(서식 정의)는 손대지 않는다
  const sourceZip = await JSZip.loadAsync(bytes);
  assert.equal(header, await sourceZip.file("Contents/header.xml").async("text"));
  for (const value of ["2027 양양 생활문화 혁신 지원사업", "양양군농촌활성화지원센터", "빈집 120채", "1) 워크숍 4회", "제출 전 증빙과 대조해 주세요."]) {
    assert.ok(section.includes(value), `section should include ${value}`);
  }
  // 표 구조(라벨 칸·값 칸 주소)는 그대로다
  assert.equal((section.match(/<hp:tc /g) || []).length, (await sourceZip.file("Contents/section0.xml").async("text")).match(/<hp:tc /g).length);
});

test("patchHwpxBytes reports values that have no place in the form", async () => {
  const bytes = new Uint8Array(fs.readFileSync(PRACTICE));
  const result = await patchHwpxBytes({ bytes, values: { 사업명: "새 사업", 존재하지않는칸: "값" } });
  assert.deepEqual(result.unmatched, ["존재하지않는칸"]);
  assert.equal(result.filled.length, 1);
});

test("patchHwpxBytes counts a value that found an already-filled cell as kept, not unmatched", async () => {
  // 원본 칸을 그대로 둔 값까지 ‘자리를 못 찾은 값’으로 보여 주면 화면 안내가 틀린다.
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/section0.xml", sectionXml(tableXml([["구분", "내용"], ["사업명", "작년 사업명"]])));
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const result = await patchHwpxBytes({ bytes, values: { 사업명: "새 사업명", 수행기관: "양양군농촌활성화지원센터" } });
  assert.equal(result.filled.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.label), ["사업명"]);
  // 사업명은 라벨도 칸도 있고 원본 값을 지키기로 했다 — 못 찾은 값은 수행기관 하나뿐이다
  assert.deepEqual(result.unmatched, ["수행기관"]);
});

test("patchHwpxBytes rejects an empty file with a readable message", async () => {
  await assert.rejects(() => patchHwpxBytes({ bytes: new Uint8Array(), values: { 사업명: "값" } }), /채울 \.hwpx 파일이 없습니다/);
});

test("filledFileName and summarizeFill describe the outcome", async () => {
  assert.equal(filledFileName("plan-practice-form.hwpx"), "plan-practice-form-채움.hwpx");
  assert.equal(filledFileName(""), "양식-채움.hwpx");
  const summary = summarizeFill({ filled: [{}, {}], skipped: [{}], unmatched: ["가", "나"] });
  assert.match(summary, /2칸을 채웠습니다/);
  assert.match(summary, /1칸은 원본 값을 그대로 두었습니다/);
  assert.match(summary, /2개 값은 들어갈 칸을 찾지 못했습니다/);
});
