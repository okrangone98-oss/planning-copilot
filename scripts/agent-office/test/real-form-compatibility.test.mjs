// 실제 기관 양식(계약서·서약서·동의서·이력서·증빙)에서 확인한 호환성 문제의 회귀 테스트.
// 원본 양식 파일은 개인정보가 있어 저장소에 넣지 않는다 — 여기서는 같은 구조만 익명화한 합성 XML을 쓴다.
//   · 여러 열을 덮은 표 제목 띠(‘강사카드’·‘인적사항’)를 라벨|값으로 오인하지 않는다
//   · 병합 행 머리(‘경력’·‘전공’) 오른쪽의 열 머리를 값 칸으로 채우지 않는다
//   · 제목 띠 다음 줄의 열 머리 아래 빈 행은 채울 수 있다(빈 이력서)
//   · (서명/인) 자리 표시는 ‘이미 적힌 값’이 아니라 이름을 넣을 자리다
//   · 한 칸·한 문단 안의 인라인 서명 블록(‘성명: … 생년월일: …’)을 라벨별로 읽고 채운다
//   · 법령·조례 본문의 ‘칸 0개’는 오류가 아니라 정상이라고 안내한다
//   · 개인정보는 외부 AI 로 보내기 전에 가린다

import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  buildKordocFillValues,
  extractFormFields,
  isFillableCellText,
  isInlineSignatureBlock,
  isLegalDocumentSchema,
  isSignaturePlaceholderCell
} from "../../../src/lib/kordocFormSpec.mjs";
import { readHwpxBlocks, extractHwpxBlocks, parseSampleTemplate } from "../../../src/lib/sampleTemplateParser.mjs";
import { patchHwpxBytes, patchSectionXml } from "../../../src/lib/browserHwpxFiller.mjs";
import { buildDownloadPreflight } from "../../../src/lib/downloadPreflight.mjs";
import { maskPii } from "../../../src/lib/piiGuard.mjs";
import { buildSmartTextPrompt } from "../../../src/lib/smartTextMapper.mjs";

/* ────────────────────────── 합성 HWPX 조각 ────────────────────────── */

function cellXml(spec, fallbackIndex = 0) {
  const {
    text = "",
    col = fallbackIndex,
    row = 0,
    colSpan = 1,
    rowSpan = 1,
    paragraphs = null,
    nested = ""
  } = spec;
  const body = paragraphs
    ? paragraphs.map((line) => `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${line}</hp:t></hp:run></hp:p>`).join("")
    : `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${text}</hp:t></hp:run></hp:p>`;
  return `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
    + `${body}${nested}</hp:subList>`
    + `<hp:cellAddr colAddr="${col}" rowAddr="${row}"/><hp:cellSpan colSpan="${colSpan}" rowSpan="${rowSpan}"/>`
    + `<hp:cellSz width="1000" height="500"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
}

function tableXml(rowSpecs) {
  const rows = rowSpecs.map((cells, rowIndex) => `<hp:tr>${cells.map((cell, index) => cellXml({ row: rowIndex, ...cell }, index)).join("")}</hp:tr>`).join("");
  const columnCount = Math.max(...rowSpecs.map((cells) => cells.reduce((max, cell) => Math.max(max, (cell.col ?? 0) + (cell.colSpan ?? 1)), 0)), 1);
  return `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17">`
    + `<hp:tbl id="1" rowCnt="${rowSpecs.length}" colCnt="${columnCount}" cellSpacing="0" borderFillIDRef="1">`
    + `<hp:sz width="1000" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>${rows}</hp:tbl>`
    + `</hp:run></hp:p>`;
}

function sectionXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
}

/** 섹션 XML 하나로 스키마를 만든다 — 실제 화면이 읽는 경로(readHwpxBlocks → parseSampleTemplate)와 같다. */
function schemaOf(xml, fileName = "합성양식.hwpx") {
  const blocks = extractHwpxBlocks(xml);
  return parseSampleTemplate({ blocks, fileName, format: "hwpx" });
}

function paragraphXml(text, charPr = "26") {
  return `<hp:p paraPrIDRef="18" styleIDRef="0"><hp:run charPrIDRef="${charPr}"><hp:t>${text}</hp:t></hp:run></hp:p>`;
}

/** 채운 파일에서 <hp:t> 글자를 문서 순서로 모은다. */
function textsOf(xml) {
  return Array.from(String(xml).matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g)).map((match) => match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"));
}

/* ────────────────────────── 1. 표 제목 띠 ────────────────────────── */

test("여러 열을 덮은 표 제목 띠는 라벨|값으로 읽지 않고 값도 넣지 않는다", () => {
  // 실제 강사 증빙 묶음의 ‘강 의 사 진’ 칸 — 제목 띠 아래 빈 사진 칸이 값 자리처럼 보인다.
  const xml = sectionXml(tableXml([
    [{ text: "강 의 사 진", colSpan: 2 }],
    [{ col: 0 }, { col: 1 }]
  ]));
  const schema = schemaOf(xml);
  const fields = extractFormFields(schema);
  assert.equal(fields.some((field) => field.label.includes("사 진")), false, JSON.stringify(fields.map((field) => field.label)));

  const result = patchSectionXml(xml, { "강 의 사 진": "테스트" });
  assert.equal(result.filled.length, 0);
  assert.deepEqual(textsOf(result.xml).filter(Boolean), ["강 의 사 진"]);
});

test("제목 띠가 여러 줄인 표도 첫 줄을 값 칸으로 채우지 않는다", () => {
  const xml = sectionXml(tableXml([
    [{ text: "강사카드", colSpan: 3 }],
    [{ text: "", colSpan: 3 }],
    [{ col: 0, text: "성 명" }, { col: 1 }, { col: 2, text: "생년월일" }, { col: 3 }],
    [{ col: 1 }, { col: 3 }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  assert.equal(fields.some((field) => field.label === "강사카드"), false);
  const result = patchSectionXml(xml, { 강사카드: "테스트", "성 명": "홍길동" });
  assert.deepEqual(result.filled.map((entry) => entry.label), ["성 명"]);
});

/* ────────────────────────── 2. 병합 행 머리 ────────────────────────── */

test("병합 행 머리(‘경력’) 오른쪽의 열 머리(‘기간’)를 값으로 채우지 않는다", () => {
  const xml = sectionXml(tableXml([
    [{ text: "자격사항", colSpan: 4 }],
    [{ text: "경 력", rowSpan: 2 }, { text: "기 간" }, { text: "소속(강의기관)" }, { text: "담당과목" }],
    [{ col: 1, text: "2023.03 ~ 현재" }, { col: 2, text: "양양군 농촌활성화지원센터" }, { col: 3, text: "사업 기획" }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  assert.equal(fields.some((field) => field.label.replace(/\s/g, "") === "경력"), false);
  assert.equal(fields.some((field) => field.label.replace(/\s/g, "") === "전공"), false);

  const result = patchSectionXml(xml, { "경 력": "덮어쓰면 안 됨", "기 간": "덮어쓰면 안 됨" });
  assert.equal(result.filled.length, 0);
  assert.ok(!textsOf(result.xml).includes("덮어쓰면 안 됨"));
});

test("제목 띠 다음 열 머리 아래 빈 행은 이력서 칸으로 읽고 채운다", () => {
  // 빈 이력서 양식 — 채울 곳이 실제로 있는 경우.
  const xml = sectionXml(tableXml([
    [{ text: "자격사항", colSpan: 4 }],
    [{ text: "경 력", rowSpan: 4 }, { text: "기 간" }, { text: "소속(강의기관)" }, { text: "담당과목" }],
    [{ col: 1 }, { col: 2 }, { col: 3 }],
    [{ col: 1 }, { col: 2 }, { col: 3 }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  for (const label of ["기 간", "소속(강의기관)", "담당과목"]) {
    assert.ok(fields.some((field) => field.label === label && field.empty), `${label} 칸을 찾지 못했습니다`);
  }
  const values = buildKordocFillValues({
    fields,
    values: { [fields.find((field) => field.label === "기 간").id]: "2023.03 ~ 현재" }
  });
  const result = patchSectionXml(xml, values.values);
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].value, "2023.03 ~ 현재");
  assert.ok(textsOf(result.xml).includes("2023.03 ~ 현재"));
});

/* ────────────────────────── 3. 레이아웃 행 띠 ────────────────────────── */

test("행 앞쪽이 전부 빈칸인 격자 칸(책임분담표)은 라벨|값으로 채우지 않는다", () => {
  const xml = sectionXml(tableXml([
    [{ text: "총 괄" }, { col: 1 }, { col: 2 }, { col: 3, text: "농촌개발과" }],
    [{ col: 0 }, { col: 1 }, { col: 2 }, { col: 3, text: "양양군 농촌활성화지원센터" }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  assert.equal(fields.some((field) => field.label.replace(/\s/g, "") === "총괄"), false);
  const result = patchSectionXml(xml, { "총 괄": "값" });
  assert.equal(result.filled.length, 0);
});

/* ────────────────────────── 4. 서명 자리 표시 ────────────────────────── */

test("(서명/인) 자리 표시는 빈칸으로 읽고 이름을 채운다", () => {
  assert.equal(isSignaturePlaceholderCell("(서명/인)"), true);
  assert.equal(isSignaturePlaceholderCell("(서명 또는 인)"), true);
  assert.equal(isSignaturePlaceholderCell("(인)"), true);
  assert.equal(isSignaturePlaceholderCell("오대훈"), false);
  assert.equal(isFillableCellText("(서명/인)"), true);

  const xml = sectionXml(tableXml([
    [{ text: "성 명" }, { text: "   (서명/인)  " }, { text: "핸드폰연락처" }, { col: 3 }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  const nameField = fields.find((field) => field.label === "성 명");
  assert.ok(nameField);
  assert.equal(nameField.empty, true, "서명 자리 표시를 이미 적힌 값으로 보면 안 됩니다");

  const result = patchSectionXml(xml, { "성 명": "홍길동" });
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].value, "홍길동");
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("홍길동"));
  assert.ok(!texts.includes("(서명/인)"), "서명 자리 표시는 채운 이름으로 바뀝니다");
});

/* ────────────────────────── 5. 인라인 서명 블록 ────────────────────────── */

test("한 칸 안의 인라인 서명 블록을 라벨별로 읽고 빈칸만 채운다", () => {
  const filled = "성 명 : 홍길동 생년월일 : 1990년 01월 01일 주 소 : 강원 양양군 현남면";
  assert.equal(isInlineSignatureBlock(filled), true);

  const xml = sectionXml(tableXml([
    [{ text: "강사" }, { col: 1, paragraphs: ["성 명 : 홍길동", "생년월일 : 1990년 01월 01일", "주 소 : 강원 양양군 현남면"] }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  const labels = fields.filter((field) => field.origin === "inline").map((field) => field.label.replace(/\s/g, ""));
  assert.deepEqual(labels, ["성명", "생년월일", "주소"]);
  assert.ok(fields.every((field) => field.empty === false), "이미 적힌 서명 블록은 원본 유지로 읽습니다");
});

test("인라인 서명 블록의 빈칸은 같은 자리에 채우고 옆 라벨 글자는 건드리지 않는다", () => {
  const xml = sectionXml(tableXml([
    [{ text: "강사" }, { col: 1, paragraphs: ["성 명 : ", "생년월일 : 1990년 01월 01일", "주 소 : 강원 양양군 현남면"] }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  const nameField = fields.find((field) => field.label.replace(/\s/g, "") === "성명");
  assert.ok(nameField);
  assert.equal(nameField.empty, true);

  const result = patchSectionXml(xml, { 성명: "김하나" });
  assert.equal(result.filled.length, 1);
  assert.equal(result.filled[0].kind, "inline");
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("성 명 : 김하나"));
  assert.ok(texts.includes("생년월일 : 1990년 01월 01일"));
  assert.ok(texts.includes("주 소 : 강원 양양군 현남면"));
});

test("라벨 옆 칸이 인라인 서명 블록이면 라벨|값과 인라인 양쪽에서 채운다", () => {
  // 실제 계약서처럼 왼쪽 칸 ‘(강사)’ 옆 칸에 ‘성명: … 생년월일: … 주소: …’가 통째로 들어온 경우.
  const xml = sectionXml(tableXml([
    [{ text: "강사" }, { col: 1, paragraphs: ["성 명 : ", "생년월일 : ", "주 소 : "] }]
  ]));
  const fields = extractFormFields(schemaOf(xml));
  const inlineLabels = fields.filter((field) => field.origin === "inline").map((field) => field.label.replace(/\s/g, ""));
  assert.deepEqual(inlineLabels, ["성명", "생년월일", "주소"]);

  const result = patchSectionXml(xml, { 성명: "김하나", 생년월일: "1990-01-01", 주소: "강원 양양군" });
  assert.deepEqual(result.filled.map((entry) => entry.key).sort(), ["생년월일", "성명", "주소"].sort());
  assert.ok(result.skipped.every((entry) => entry.label !== "성명" && entry.label !== "생년월일" && entry.label !== "주소"));
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("성 명 : 김하나"));
  assert.ok(texts.includes("생년월일 : 1990-01-01"));
  assert.ok(texts.includes("주 소 : 강원 양양군"));
});

test("서약서 본문 한 줄의 서명란(‘강사 성명 : (인)’)도 칸으로 읽고 채운다", () => {
  const line = "(프로그램명: 내가Green양양) 강사 성명 : (인)";
  assert.equal(isInlineSignatureBlock(line), true);

  const xml = sectionXml(paragraphXml(line));
  const fields = extractFormFields(schemaOf(xml));
  const nameField = fields.find((field) => field.fillKey.replace(/\s/g, "") === "성명");
  assert.ok(nameField, JSON.stringify(fields.map((field) => field.label)));
  assert.equal(nameField.empty, true);

  const result = patchSectionXml(xml, { 성명: "김하나" });
  assert.equal(result.filled.length, 1);
  assert.ok(textsOf(result.xml).some((text) => text.includes("김하나")));
  assert.ok(textsOf(result.xml).some((text) => text.includes("프로그램명: 내가Green양양")));
});

test("예산 내역처럼 금액 라벨이 줄지은 칸은 서명 블록으로 보지 않는다", () => {
  const line = "운영비 : 324백만원 - 인건비 : 208백만원 - 공과금 : 48백만원";
  assert.equal(isInlineSignatureBlock(line), false);
});

/* ────────────────────────── 6. 법령·조례 본문 ────────────────────────── */

test("법령·조례 본문의 ‘칸 0개’는 오류가 아니라 정상으로 안내한다", () => {
  const legalSchema = parseSampleTemplate({
    blocks: [
      { type: "paragraph", text: "양양군 청년 기본 조례" },
      { type: "heading", level: 1, title: "제1조(목적)" },
      { type: "heading", level: 1, title: "제2조(정의)" },
      { type: "heading", level: 1, title: "제3조(청년정책)" }
    ],
    fileName: "조례.hwpx",
    format: "hwpx"
  });
  assert.equal(isLegalDocumentSchema(legalSchema), true);
  const legalPreflight = buildDownloadPreflight({ fields: [], values: {}, schema: legalSchema, title: legalSchema.title, hasFile: true });
  const legalItem = legalPreflight.items.find((item) => item.id === "no-fields-legal");
  assert.ok(legalItem, JSON.stringify(legalPreflight.items.map((item) => item.id)));
  assert.match(legalItem.title, /정상/);
  assert.match(legalItem.fix, /양식/);

  const notesSchema = parseSampleTemplate({
    blocks: [{ type: "paragraph", text: "회의록" }, { type: "paragraph", text: "오늘 회의는 짧게 끝났습니다." }],
    fileName: "회의록.hwpx",
    format: "hwpx"
  });
  assert.equal(isLegalDocumentSchema(notesSchema), false);
  const notesPreflight = buildDownloadPreflight({ fields: [], values: {}, schema: notesSchema, title: notesSchema.title, hasFile: true });
  assert.ok(notesPreflight.items.some((item) => item.id === "no-fields"));
  assert.equal(notesPreflight.items.some((item) => item.id === "no-fields-legal"), false);
});

/* ────────────────────────── 7. 병합 정보·개인정보 ────────────────────────── */

test("양식 스키마가 표 병합 정보를 보존한다", () => {
  const xml = sectionXml(tableXml([
    [{ text: "성 명", rowSpan: 2 }, { col: 1 }],
    [{ col: 1 }]
  ]));
  const schema = schemaOf(xml);
  const table = schema.tables[0];
  assert.ok(Array.isArray(table.spans), "병합 정보가 스키마에 담기지 않았습니다");
  assert.deepEqual(table.spans[0][0], [2, 1]);
});

test("개인정보가 든 문서는 외부 AI 로 보내기 전에 이름·주민번호·연락처·주소를 가린다", () => {
  const fields = [
    { id: "f1", label: "성 명", key: "성명", fillKey: "성 명", value: "", empty: true, type: "text", hint: "", sectionId: null, sectionTitle: "", context: "" },
    { id: "f2", label: "주민등록번호", key: "주민등록번호", fillKey: "주민등록번호", value: "", empty: true, type: "idnum", hint: "", sectionId: null, sectionTitle: "", context: "" }
  ];
  const raw = "성명: 홍길동\n주민등록번호: 900101-1234568\n연락처: 010-1234-5678\n주소: 강원도 양양군 현남면 북죽로 74-38";
  const prompt = buildSmartTextPrompt({ fields, text: raw });
  const masked = maskPii(prompt).text;
  for (const secret of ["홍길동", "900101-1234568", "010-1234-5678", "북죽로 74-38"]) {
    assert.equal(masked.includes(secret), false, `${secret} 가 프롬프트에 남아 있습니다`);
  }
  assert.match(masked, /\[성명_1\]|\[주민번호_1\]|\[연락처_1\]|\[주소_1\]/);
});

/* ────────────────────────── 8. 파일 전체 무결성 ────────────────────────── */

test("채운 .hwpx는 표 구조·헤더·mimetype 을 그대로 두고 값을 다시 읽을 수 있다", async () => {
  const xml = sectionXml(tableXml([
    [{ text: "강사카드", colSpan: 2 }],
    [{ text: "성 명" }, { text: "(서명/인)" }],
    [{ text: "소속" }, { col: 1 }]
  ]));
  const header = "<hh:head xmlns:hh=\"http://www.hancom.co.kr/hwpml/2011/head\"><hh:refList/></hh:head>";
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/header.xml", header);
  zip.file("Contents/section0.xml", xml);
  const bytes = await zip.generateAsync({ type: "uint8array" });

  const result = await patchHwpxBytes({ bytes, values: { "성 명": "홍길동", 소속: "양양군농촌활성화지원센터" } });
  assert.equal(result.filled.length, 2);
  assert.equal(result.unmatched.length, 0);

  const outZip = await JSZip.loadAsync(result.bytes);
  assert.equal(Object.keys(outZip.files)[0], "mimetype");
  assert.equal(Buffer.from(result.bytes).readUInt16LE(8), 0, "mimetype 은 압축하지 않아야 합니다");
  assert.equal(await outZip.file("Contents/header.xml").async("text"), header);
  const outSection = await outZip.file("Contents/section0.xml").async("text");
  assert.equal((outSection.match(/<hp:tc[ >]/g) || []).length, (xml.match(/<hp:tc[ >]/g) || []).length);
  assert.equal((outSection.match(/<hp:tr[ >]/g) || []).length, (xml.match(/<hp:tr[ >]/g) || []).length);
  assert.equal((outSection.match(/<hp:tbl[ >]/g) || []).length, (xml.match(/<hp:tbl[ >]/g) || []).length);
  assert.equal(await outZip.file("Contents/section0.xml").async("text").then((text) => text.includes("홍길동")), true);

  const reread = await readHwpxBlocks(outZip);
  const rereadFields = extractFormFields(parseSampleTemplate({ blocks: reread, fileName: "합성양식.hwpx", format: "hwpx" }));
  assert.ok(rereadFields.some((field) => field.value === "홍길동"));
  assert.ok(rereadFields.some((field) => field.value === "양양군농촌활성화지원센터"));
});
