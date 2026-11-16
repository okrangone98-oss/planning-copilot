import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  detectDocumentTitleText,
  labelledParagraphParts,
  parseSampleTemplate,
  readHwpxBlocks
} from "../../../src/lib/sampleTemplateParser.mjs";
import { buildKordocFillValues, extractFormFields } from "../../../src/lib/kordocFormSpec.mjs";
import { mapFreeTextToFields } from "../../../src/lib/smartTextMapper.mjs";
import {
  applyCarryoverGuard,
  buildCarryoverPlan,
  buildTextRewrites,
  detectPreviousYearDocument,
  markCarryoverRows,
  proposeDocumentTitle,
  swapTitleYear
} from "../../../src/lib/yearCarryover.mjs";
import { patchHwpxBytes } from "../../../src/lib/browserHwpxFiller.mjs";
import { planSourceLines } from "../../../src/lib/hwpxSourceExtractor.mjs";

// 실제 센터 문서를 그대로 쓰지 않는다 — 같은 구조를 가진 최소 익명 픽스처로만 확인한다.
const CURRENT_YEAR = 2026;

/** 한 문단(줄) 하나 — 문단 안 줄바꿈은 <hp:lineBreak/>.
 *  제목 줄과 ‘라벨: 값’ 줄은 실제 결과보고서처럼 1×1 틀(표) 안에 넣기도 한다. */
function paragraph(text, charPr = "12") {
  return `<hp:p paraPrIDRef="3" styleIDRef="0"><hp:run charPrIDRef="${charPr}"><hp:t>${text}</hp:t></hp:run><hp:linesegarray><hp:lineseg textpos="0" vertpos="0"/></hp:linesegarray></hp:p>`;
}

function tableOf(rows) {
  const body = rows
    .map((row) => `<hp:tr>${row.map((cell) => `<hp:tc><hp:subList><hp:p><hp:run charPrIDRef="12"><hp:t>${cell}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc>`).join("")}</hp:tr>`)
    .join("");
  return `<hp:tbl borderFillIDRef="1">${body}</hp:tbl>`;
}

const SECTION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  ${paragraph("Ⅰ. 사업 개요", "20")}
  ${paragraph("1. 목적")}
  ${paragraph("가. 지역 기록 역량을 갖춘 주민 활동가를 발굴·양성나. 교육과 실습을 연결하는 모델 구축")}
  ${paragraph("2. 사업개요")}
  ${paragraph("사 업 명: 2025 예시마을 활동가 양성 사업")}
  ${paragraph("사업기간: 2025년 5월 1일 ~ 2025년 11월 30일")}
  ${paragraph("사업대상: 예시군 주민")}
  ${paragraph("사업장소: 예시군 농업기술센터 쉼")}
  ${paragraph("3. 실적")}
  ${paragraph("총 운영회차: 24회")}
  ${paragraph("총 참여 인원(누적): 320명")}
  ${paragraph("수료자: 21명")}
  ${tableOf([["성과 항목", "계획", "실적"], ["교육과정 운영", "3과정 20회", "3과정 24회"]])}
  <hp:p paraPrIDRef="30"><hp:run charPrIDRef="12">${tableOf([["2025년 예시마을 활동가 양성 사업 결과보고서"]])}</hp:run></hp:p>
  <hp:p><hp:run charPrIDRef="12"><hp:t>가. 위 내용은 예시입니다.</hp:t></hp:run></hp:p>
</hs:sec>`;

async function schemaOf(sectionXml, fileName = "작년결과보고서.hwpx") {
  const zip = new JSZip();
  const blocks = await readHwpxBlocks(zipWith(zip, sectionXml));
  const schema = parseSampleTemplate({ blocks, fileName, format: "hwpx" });
  return { schema, fields: extractFormFields(schema), blocks };
}

function zipWith(zip, xml) {
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/section0.xml", xml);
  return zip;
}

test("본문 문단의 ‘라벨: 값’을 라벨과 값으로 나눈다", () => {
  assert.deepEqual(labelledParagraphParts("사 업 명: 2025 예시 사업"), [
    { label: "사업명", fillLabel: "사업명", value: "2025 예시 사업", prefix: "사 업 명: ", inline: true }
  ]);
  assert.deepEqual(labelledParagraphParts("1)총 운영회차: 24회"), [
    { label: "총 운영회차", fillLabel: "운영회차", value: "24회", prefix: "1)총 운영회차: ", inline: true }
  ]);
  // 괄호가 섞인 라벨은 값 자리를 짚기 어려워 줄 앞부분을 그대로 둔 채 통째로 바꾼다.
  assert.deepEqual(labelledParagraphParts("총 참여 인원(누적): 320명"), [
    { label: "총 참여 인원(누적)", fillLabel: "총 참여 인원(누적)", value: "320명", prefix: "총 참여 인원(누적): ", inline: false }
  ]);
  // 문장 속 콜론은 라벨이 아니다 — 줄 첫머리 라벨만 본다.
  assert.deepEqual(labelledParagraphParts("가. 교육을 마친 뒤 다음과 같이 적었다: 참여자 20명"), []);
  // 안내문·서명 블록은 값 칸이 아니다.
  assert.deepEqual(labelledParagraphParts("※ 작성 요령: 표를 채우세요"), []);
  assert.deepEqual(labelledParagraphParts("성명: 홍길동 생년월일: 900101 주소: 서울"), []);
});

test("연도가 박힌 문서 제목만 제목으로 본다", () => {
  assert.equal(detectDocumentTitleText("2025년 예시마을 활동가 양성 사업 결과보고서"), "2025년 예시마을 활동가 양성 사업 결과보고서");
  assert.equal(detectDocumentTitleText("사업 개요"), "");
  assert.equal(detectDocumentTitleText("3. 2025년 계획"), "");
  assert.equal(detectDocumentTitleText("사업기간: 2025년 5월"), "");
});

test("HWPX 문단 안 줄바꿈은 줄 단위로 나눠 읽는다", async () => {
  const xml = `<hs:sec><hp:p><hp:run><hp:t>가. 사 업 명: 2025 예시 사업</hp:t><hp:lineBreak/><hp:t>나. 사업기간: 2025년 5월 ~ 11월</hp:t></hp:run></hp:p></hs:sec>`;
  const { extractHwpxBlocks } = await import("../../../src/lib/sampleTemplateParser.mjs");
  const blocks = extractHwpxBlocks(xml);
  assert.equal(blocks.length, 2, "줄바꿈에서 문단이 갈라지지 않았습니다");
  assert.equal(blocks[0].title || blocks[0].text, "사 업 명: 2025 예시 사업");
  assert.equal(blocks[1].title || blocks[1].text, "사업기간: 2025년 5월 ~ 11월");
  // 한 문단에 몰려 있을 때는 240자 제한에 걸려 라벨을 못 읽었다.
  const schema = parseSampleTemplate({ format: "hwpx", fileName: "x.hwpx", blocks });
  const labels = extractFormFields(schema).map((field) => field.label);
  assert.ok(labels.includes("사업명"));
  assert.ok(labels.includes("사업기간"));
});

test("결과보고서 문단 값이 검토할 칸으로 잡힌다 (표 밖 본문 포함)", async () => {
  const { schema, fields } = await schemaOf(SECTION);
  const text = fields.filter((field) => field.origin === "text");
  assert.ok(text.length >= 6, `본문 칸이 ${text.length}개뿐입니다`);
  const labels = text.map((field) => field.label);
  assert.ok(labels.includes("사업명"), JSON.stringify(labels));
  assert.ok(labels.includes("총 운영회차"));
  assert.ok(labels.includes("수료자"));
  // 괄호 라벨은 줄 전체를 바꾸는 칸으로 잡힌다.
  const cumulative = text.find((field) => field.label === "총 참여 인원(누적)");
  assert.ok(cumulative, "괄호 라벨이 칸으로 잡히지 않았습니다");
  assert.equal(cumulative.rewrite, true);
  assert.equal(cumulative.prefix, "총 참여 인원(누적): ");
  const title = fields.find((field) => field.label === "문서 제목");
  assert.ok(title, "문서 제목 칸이 없습니다");
  assert.equal(title.value, "2025년 예시마을 활동가 양성 사업 결과보고서");
  assert.equal(schema.title, "2025년 예시마을 활동가 양성 사업 결과보고서");
  assert.equal(schema.counts.labelled, text.filter((field) => field.label !== "문서 제목").length);
  assert.equal(schema.counts.titles, 1);
});

test("작년 결과보고서를 알아보고 이양 대상 칸을 고른다", async () => {
  const { schema, fields } = await schemaOf(SECTION);
  const detection = detectPreviousYearDocument({ schema, fileName: schema.fileName, currentYear: CURRENT_YEAR });
  assert.equal(detection.isPreviousYearDocument, true);
  assert.equal(detection.suggested, true);
  assert.equal(detection.sourceYear, 2025);
  const plan = buildCarryoverPlan({ fields, currentYear: CURRENT_YEAR, sourceYear: detection.sourceYear });
  const labels = plan.rows.map((row) => row.label);
  assert.ok(labels.includes("사업명"), "사업명이 이양 대상이 아닙니다");
  assert.ok(labels.includes("문서 제목"), "문서 제목이 이양 대상이 아닙니다");
  const strong = plan.rows.filter((row) => row.strength === "strong").map((row) => row.label);
  assert.ok(strong.includes("사업기간"));
});

test("본문 문단 값을 .hwpx 안에서 갈아끼운다 — 라벨 글자와 서식(run)은 그대로", async () => {
  const { fields } = await schemaOf(SECTION);
  const nameField = fields.find((field) => field.label === "사업명");
  const periodField = fields.find((field) => field.label === "사업기간");
  const values = { [nameField.id]: "2026 예시마을 퍼실리테이터 양성 사업", [periodField.id]: "2026년 7월~10월" };
  const planRows = buildCarryoverPlan({ fields, currentYear: CURRENT_YEAR }).rows;
  const { carryoverOverwriteMap } = await import("../../../src/lib/yearCarryover.mjs");
  const overwrites = carryoverOverwriteMap({ planRows, values });
  const fill = buildKordocFillValues({ fields, values });

  const zip = new JSZip();
  zipWith(zip, SECTION);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const result = await patchHwpxBytes({ bytes, values: fill.values, overwrites });
  assert.equal(result.filled.length, 2, JSON.stringify(result.filled));
  const outZip = await JSZip.loadAsync(result.bytes);
  const xml = await outZip.file("Contents/section0.xml").async("text");
  assert.ok(xml.includes("<hp:t>사 업 명: 2026 예시마을 퍼실리테이터 양성 사업</hp:t>"), "본문 라벨 줄이 바뀌지 않았습니다");
  assert.ok(xml.includes("<hp:t>사업기간: 2026년 7월~10월</hp:t>"));
  // 라벨 글자와 run 의 글자 모양은 남는다.
  assert.ok(xml.includes('<hp:run charPrIDRef="12"><hp:t>사 업 명: 2026 예시마을'));
});

test("문서 제목은 라벨 없이 글자 전체를 갈아끼운다", async () => {
  const { fields } = await schemaOf(SECTION);
  const title = fields.find((field) => field.label === "문서 제목");
  const values = { [title.id]: "2026년 예시마을 퍼실리테이터 양성 사업 결과보고서" };
  const rewrites = buildTextRewrites({ fields, values });
  const titleRewrite = rewrites.find((row) => row.label === "문서 제목");
  assert.ok(titleRewrite, JSON.stringify(rewrites));
  assert.equal(titleRewrite.from, "2025년 예시마을 활동가 양성 사업 결과보고서");
  assert.equal(titleRewrite.to, "2026년 예시마을 퍼실리테이터 양성 사업 결과보고서");

  const zip = new JSZip();
  zipWith(zip, SECTION);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  const result = await patchHwpxBytes({ bytes, values: {}, rewrites });
  assert.equal(result.filled.length, 1);
  const outZip = await JSZip.loadAsync(result.bytes);
  const xml = await outZip.file("Contents/section0.xml").async("text");
  assert.ok(xml.includes("<hp:t>2026년 예시마을 퍼실리테이터 양성 사업 결과보고서</hp:t>"));
  assert.ok(!xml.includes("2025년 예시마을 활동가 양성 사업 결과보고서"));
  // 값이 그대로면 건드리지 않는다.
  const same = await patchHwpxBytes({ bytes, values: {}, rewrites: [{ from: "다른 제목", to: "새 제목" }] });
  assert.equal(same.filled.length, 0);
});

test("제목 제안은 계획서 사업명으로, 없으면 연도만 바꾼다", async () => {
  const { fields } = await schemaOf(SECTION);
  const planLines = [{ kind: "label", label: "사업명", value: "예시마을 퍼실리테이터 양성 사업" }];
  const [fromPlan] = proposeDocumentTitle({ fields, planLines, currentYear: CURRENT_YEAR });
  assert.equal(fromPlan.proposal, "2026년 예시마을 퍼실리테이터 양성 사업 결과보고서");
  assert.equal(fromPlan.basis, "plan");
  const [fromYear] = proposeDocumentTitle({ fields, planLines: [], currentYear: CURRENT_YEAR });
  assert.equal(fromYear.proposal, "2026년 예시마을 활동가 양성 사업 결과보고서");
  assert.equal(fromYear.basis, "year");
  assert.equal(swapTitleYear("2024~2025년 계획", 2026), "2026~2026년 계획");
});

test("자동 배치 확신이 낮은 칸은 이양 모드에서 체크하지 않는다", () => {
  const result = {
    rows: [
      { fieldId: "a", checked: true, score: 1 },
      { fieldId: "b", checked: true, score: 0.55 },
      { fieldId: "c", checked: false, score: 0.9 }
    ],
    leftovers: []
  };
  const guarded = applyCarryoverGuard(result);
  assert.equal(guarded.rows.find((row) => row.fieldId === "a").checked, true);
  assert.equal(guarded.rows.find((row) => row.fieldId === "b").checked, false);
  assert.equal(guarded.rows.find((row) => row.fieldId === "b").lowConfidence, true);
  assert.equal(guarded.rows.find((row) => row.fieldId === "c").checked, false);
  // 이양 계획에 있는 칸도 점수가 낮으면 체크가 풀린다.
  const marked = markCarryoverRows({ rows: [{ fieldId: "x", proposed: "새 값", current: "2025 값", score: 0.4 }] }, [
    { fieldId: "x", value: "2025 값", strength: "strong", label: "사업기간" }
  ]);
  assert.equal(marked.rows[0].carryover, true);
  assert.equal(applyCarryoverGuard(marked).rows[0].checked, false);
});

test("올해 추진계획서에서 결재란·연락처·붙임 서식을 걷어 낸다", () => {
  const blocks = [
    { type: "table", headers: ["수신", "경유"], rows: [["수신", "내부결재"], ["(경유)", ""]] },
    { type: "heading", level: 2, title: "사 업 명: 예시 퍼실리테이터 양성 사업" },
    { type: "heading", level: 2, title: "기 간: 2026년 6월~9월" },
    { type: "paragraph", text: "라. 예산과목: 농촌협약, 민간경상사업보조(307-02)" },
    { type: "paragraph", text: "붙 임: 1. 추진계획 1부. 끝." },
    { type: "table", headers: ["열 1", "열 2"], rows: [["팀장", "사무국장"], ["센터장", ""]] },
    { type: "paragraph", text: "제출 방법: 담당자 메일(example@example.org)로 제출" },
    { type: "paragraph", text: "사업예산: 20,000,000원(금이천만원)" },
    { type: "paragraph", text: "2. 세부 내용" },
    { type: "paragraph", text: "수료 기준: 전체 교육 과정의 80% 이상 출석" },
    { type: "table", headers: ["구분", "내용"], rows: [["교육시간", "기초 32시간"], ["강의장소", "센터"]] },
    { type: "paragraph", text: "2026년 예시 PD 위촉 계약서" },
    { type: "paragraph", text: "제1조 [목적] 본 계약은 활동 조건을 규정한다." }
  ];
  const { lines } = planSourceLines(blocks);
  const text = lines.map((line) => `${line.label}|${line.value}`).join("\n");
  assert.ok(!text.includes("내부결재"), "수신/결재란이 남았습니다");
  assert.ok(!text.includes("팀장"), "결재란 표가 남았습니다");
  assert.ok(!text.includes("example@example.org"), "연락처가 남았습니다");
  assert.ok(!text.includes("붙 임"), "붙임 줄이 남았습니다");
  assert.ok(!text.includes("제1조"), "붙임 계약서가 남았습니다");
  const pairs = lines.map((line) => [line.label, line.value]);
  assert.ok(pairs.some(([label, value]) => label === "사 업 명" && value === "예시 퍼실리테이터 양성 사업"), text);
  assert.ok(pairs.some(([label, value]) => label === "기 간" && value === "2026년 6월~9월"), text);
  assert.ok(pairs.some(([label, value]) => label === "수료 기준" && value === "전체 교육 과정의 80% 이상 출석"), text);
  assert.ok(pairs.some(([label, value]) => label === "교육시간" && value === "기초 32시간"), text);
});

test("계획서 안에서 같은 항목의 값이 다르면 알려 준다", () => {
  const blocks = [
    { type: "heading", level: 2, title: "예 산: 금30,000,000원(금삼천만원)" },
    { type: "paragraph", text: "사업명: 예시 사업" },
    { type: "paragraph", text: "사업예산: 20,000,000원(금이천만원)" },
    { type: "paragraph", text: "평가 지표" },
    { type: "table", headers: ["영역", "지표", "목표치"], rows: [["교육", "수료율", "80% 이상"], ["교육", "양성인력", "20명"]] }
  ];
  const { conflicts, lines } = planSourceLines(blocks);
  assert.equal(conflicts.length, 1, JSON.stringify(conflicts));
  assert.equal(conflicts[0].label, "예 산");
  assert.equal(conflicts[0].values.length, 2);
  // 영역·지표 두 칸을 합친 라벨이라 서로 다른 지표가 같은 라벨로 묶이지 않는다.
  const labels = lines.filter((line) => line.kind === "label").map((line) => line.label);
  assert.ok(labels.includes("교육 · 수료율"));
  assert.ok(labels.includes("교육 · 양성인력"));
});

test("라벨이 정확히 같은 계획서 줄은 그 칸에 먼저 붙는다", async () => {
  const { fields } = await schemaOf(SECTION);
  const text = [
    "■ 올해 추진계획서",
    "사업명: 2026 예시마을 퍼실리테이터 양성 사업",
    "사업기간: 2026년 7월~10월",
    "사업대상: 예시군 주민",
    "사업장소: 예시군 농업기술센터",
    "수료율: 85% 이상"
  ].join("\n");
  const result = mapFreeTextToFields({ fields, text });
  const byLabel = Object.fromEntries(result.rows.map((row) => [row.label, row.proposed]));
  assert.equal(byLabel["사업명"], "2026 예시마을 퍼실리테이터 양성 사업");
  assert.equal(byLabel["사업기간"], "2026년 7월~10월");
  assert.equal(byLabel["사업대상"], "예시군 주민");
  assert.equal(byLabel["사업장소"], "예시군 농업기술센터");
});
