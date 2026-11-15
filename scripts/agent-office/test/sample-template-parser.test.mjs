import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  HWP_BINARY_GUIDANCE,
  blocksToText,
  buildRuleBasedFill,
  buildTemplateFillPrompt,
  checkStructureCoverage,
  classifyHeading,
  describeSampleSupport,
  detectSlotKind,
  documentFormatOf,
  extractDocxHtmlBlocks,
  extractHwpxBlocks,
  normalizeProfile,
  parseSampleTemplate,
  parseTextBlocks,
  readHwpxBlocks,
  renderSchemaOutline,
  summarizeSchema
} from "../../../src/lib/sampleTemplateParser.mjs";

const SAMPLE_TEMPLATE = `Ⅰ. 사업 개요
1. 추진 배경
○ (작성 요령) 지역의 문제를 3줄 이내로 쓰세요.
2. 사업 목표
사업명: ______
추진 기간: (    )
| 구분 | 사업명 | 추진 기간 | 예산 |
| --- | --- | --- | --- |
| 주관 |  |  |  |
| 협력 |  |  |  |
가. 기대 효과
- 지역 청년 20명의 활동 기회 확대
`;

test("파일 형식을 구분하고 구형 .hwp는 대안을 안내한다", () => {
  assert.equal(documentFormatOf("공고_2026.hwpx"), "hwpx");
  assert.equal(documentFormatOf("사업계획서.HWP"), "hwp");
  assert.equal(documentFormatOf("계획서.docx"), "docx");
  assert.equal(documentFormatOf("계획서.pdf"), "pdf");
  assert.equal(documentFormatOf("메모.md"), "markdown");
  assert.equal(documentFormatOf("목록.csv"), "csv");
  assert.equal(documentFormatOf(""), "unknown");

  const hwp = describeSampleSupport("사업계획서.hwp");
  assert.equal(hwp.supported, false);
  assert.match(hwp.message, /HWPX/);
  assert.match(hwp.message, /kordoc/);
  assert.equal(hwp.message, HWP_BINARY_GUIDANCE);

  assert.equal(describeSampleSupport("양식.hwpx").supported, true);
  assert.equal(describeSampleSupport("양식.hppt").supported, false);
});

test("제목 번호 체계를 계층으로 읽고 문장은 제목으로 보지 않는다", () => {
  assert.deepEqual(classifyHeading("Ⅰ. 사업 개요"), { level: 1, title: "사업 개요" });
  assert.deepEqual(classifyHeading("1. 추진 배경"), { level: 2, title: "추진 배경" });
  assert.deepEqual(classifyHeading("가. 현황 분석"), { level: 3, title: "현황 분석" });
  assert.deepEqual(classifyHeading("(1) 세부 내용"), { level: 4, title: "세부 내용" });
  assert.deepEqual(classifyHeading("① 추진 일정"), { level: 5, title: "추진 일정" });
  assert.deepEqual(classifyHeading("## 표 구조"), { level: 2, title: "표 구조" });
  assert.deepEqual(classifyHeading("【붙임 1】"), { level: 2, title: "붙임 1" });
  assert.equal(classifyHeading("이 사업은 지역 청년을 대상으로 합니다."), null);
  assert.equal(classifyHeading("1. 사업은 지역 청년을 대상으로 하며 참여자 20명을 모집합니다. 운영 기간은 10개월입니다."), null);
});

test("평문을 제목·표·목록·문단 블록으로 나눈다", () => {
  const blocks = parseTextBlocks(SAMPLE_TEMPLATE);
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].title, "사업 개요");

  const table = blocks.find((block) => block.type === "table");
  assert.ok(table, "표 블록을 찾지 못했습니다");
  assert.deepEqual(table.headers, ["구분", "사업명", "추진 기간", "예산"]);
  assert.equal(table.rows.length, 2);
  assert.equal(table.rows[0][0], "주관");

  const list = blocks.find((block) => block.type === "list");
  assert.ok(list);
  assert.match(list.text, /작성 요령/);

  assert.deepEqual(
    parseTextBlocks("--- 1쪽 ---\n본문입니다.").map((block) => block.type),
    ["meta", "paragraph"]
  );
});

test("탭으로 구분한 표도 인식하고, 머리글이 없으면 열 이름을 만든다", () => {
  const blocks = parseTextBlocks("항목\t내용\t비고\n인력\t3명\t-\n예산\t1,000만원\t확인 필요");
  const table = blocks.find((block) => block.type === "table");
  assert.ok(table);
  assert.deepEqual(table.headers, ["항목", "내용", "비고"]);
  assert.equal(table.rows.length, 2);

  const noHeader = parseTextBlocks("10\t20\t30\n40\t50\t60");
  const second = noHeader.find((block) => block.type === "table");
  assert.ok(second);
  assert.deepEqual(second.headers, ["열 1", "열 2", "열 3"]);
  assert.equal(second.rows.length, 2);
});

test("양식 스키마는 섹션 계층·표·작성 슬롯을 구조화한다", () => {
  const schema = parseSampleTemplate({ text: SAMPLE_TEMPLATE, fileName: "양식.md", format: "markdown" });
  assert.equal(schema.title, "사업 개요");
  assert.deepEqual(schema.sections.map((section) => section.title), ["사업 개요", "추진 배경", "사업 목표", "기대 효과"]);
  assert.deepEqual(schema.sections.map((section) => section.level), [1, 2, 2, 3]);
  assert.equal(schema.sections[1].parentId, schema.sections[0].id);
  assert.equal(schema.sections[3].parentId, schema.sections[2].id);

  assert.equal(schema.tables.length, 1);
  const table = schema.tables[0];
  assert.equal(table.caption, "사업 목표");
  assert.equal(table.sectionId, schema.sections[2].id);
  assert.equal(table.emptyCells, 6);

  const kinds = schema.slots.map((slot) => slot.kind);
  assert.ok(kinds.includes("guide"), "작성 요령 슬롯이 없습니다");
  assert.ok(kinds.includes("blank"), "빈칸 슬롯이 없습니다");
  assert.ok(kinds.includes("item"), "목록 항목 슬롯이 없습니다");
  assert.equal(schema.slots.filter((slot) => slot.kind === "table-cell").length, 6);

  const summary = summarizeSchema(schema);
  assert.equal(summary.sections, 4);
  assert.equal(summary.tables, 1);
  assert.equal(summary.slots, schema.slots.length);
  assert.equal(summary.emptyCells, 6);

  assert.equal(detectSlotKind("사업명: ______", "paragraph"), "blank");
  assert.equal(detectSlotKind("○ (작성 요령) 세 줄로 정리", "list"), "guide");
  assert.equal(detectSlotKind("담당자:", "paragraph"), "label");
  assert.equal(detectSlotKind("다음과 같습니다:", "paragraph"), null);
  assert.equal(detectSlotKind("지역 청년 20명", "paragraph"), null);
});

test("미리보기 목차는 섹션·표·작성 항목을 담고, 길면 자른다", () => {
  const schema = parseSampleTemplate({ text: SAMPLE_TEMPLATE, fileName: "양식.md" });
  const outline = renderSchemaOutline(schema);
  assert.match(outline, /## 목차 \(4개\)/);
  assert.match(outline, /- 사업 개요/);
  assert.match(outline, /\| 구분 \| 사업명 \| 추진 기간 \| 예산 \|/);
  assert.match(outline, /## 작성 항목/);
  assert.match(outline, /표 빈칸/);

  const short = renderSchemaOutline(schema, { maxChars: 120 });
  assert.ok(short.length < 260);
  assert.match(short, /생략/);

  assert.match(renderSchemaOutline(null), /아직 읽지 못했습니다/);
});

test("AI 채우기 프롬프트는 양식 구조와 내 사업 정보, 구조 유지 규칙을 담는다", () => {
  const schema = parseSampleTemplate({ text: SAMPLE_TEMPLATE, fileName: "양식.md" });
  const prompt = buildTemplateFillPrompt({
    schema,
    profile: { projectName: "양양 생활문화 혁신", summary: "빈집을 마을 작업실로 바꾼다", budget: "총 4,800만원" }
  });
  assert.match(prompt, /샘플 양식 구조/);
  assert.match(prompt, /- 사업 개요/);
  assert.match(prompt, /목차 순서와 제목을 그대로 유지/);
  assert.match(prompt, /확인 필요/);
  assert.match(prompt, /사업·프로젝트명: 양양 생활문화 혁신/);
  assert.match(prompt, /예산·재원: 총 4,800만원/);
  assert.match(prompt, /# 양양 생활문화 혁신/);
});

test("규칙 기반 채우기는 원본 목차·표를 유지하고 빈칸을 확인 필요로 남긴다", () => {
  const schema = parseSampleTemplate({ text: SAMPLE_TEMPLATE, fileName: "양식.md" });
  const filled = buildRuleBasedFill({
    schema,
    profile: { projectName: "양양 생활문화 혁신", organization: "양양군농촌활성화지원센터", summary: "빈집을 마을 작업실로 바꿉니다." }
  });

  assert.match(filled, /^# 양양 생활문화 혁신/);
  assert.match(filled, /## 사업 개요/);
  assert.match(filled, /### 추진 배경/);
  assert.match(filled, /\| 구분 \| 사업명 \| 추진 기간 \| 예산 \|/);
  // 표의 ‘사업명’ 열은 프로필 값으로, 다른 빈칸은 확인 필요로 채운다.
  assert.match(filled, /\| 주관 \| 양양 생활문화 혁신 \|/);
  assert.match(filled, /확인 필요/);
  assert.match(filled, /## 확인 필요/);
  // 작성 요령은 결과물에 옮기지 않는다.
  assert.doesNotMatch(filled, /작성 요령/);

  const order = ["사업 개요", "추진 배경", "사업 목표", "기대 효과"].map((title) => filled.indexOf(title));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, "섹션 순서가 원본과 다릅니다");

  const empty = buildRuleBasedFill({ schema, profile: {} });
  assert.match(empty, /확인 필요/);
});

test("AI 결과가 양식 제목을 얼마나 지켰는지 센다", () => {
  const schema = parseSampleTemplate({ text: SAMPLE_TEMPLATE, fileName: "양식.md" });
  const good = checkStructureCoverage(schema, "## 사업 개요\n### 추진 배경\n### 사업 목표\n### 기대 효과");
  assert.equal(good.total, 4);
  assert.equal(good.matched, 4);
  assert.equal(good.ratio, 1);
  const poor = checkStructureCoverage(schema, "## 사업 개요");
  assert.ok(poor.ratio < 0.6);
  assert.deepEqual(checkStructureCoverage(null, "x"), { total: 0, matched: 0, ratio: 1 });
});

test("HWPX 섹션 XML에서 문단과 표 구조를 읽는다", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2016/hwpapp">
  <hp:p><hp:run><hp:t>Ⅰ. 사업 개요</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>1. 추진 배경</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>○ (작성 요령) 지역 문제를 쓰세요.</hp:t></hp:run></hp:p>
  <hp:tbl>
    <hp:tr><hp:tc><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:tc><hp:tc><hp:p><hp:run><hp:t>내용</hp:t></hp:run></hp:p></hp:tc></hp:tr>
    <hp:tr><hp:tc><hp:p><hp:run><hp:t>주관</hp:t></hp:run></hp:p></hp:tc><hp:tc><hp:p><hp:run><hp:t/></hp:run></hp:p></hp:tc></hp:tr>
  </hp:tbl>
  <hp:p><hp:run><hp:t>가. 기대 효과</hp:t></hp:run></hp:p>
</hp:sec>`;
  const blocks = extractHwpxBlocks(xml);
  const headings = blocks.filter((block) => block.type === "heading").map((block) => block.title);
  assert.deepEqual(headings, ["사업 개요", "추진 배경", "기대 효과"]);

  const table = blocks.find((block) => block.type === "table");
  assert.ok(table);
  assert.deepEqual(table.headers, ["구분", "내용"]);
  assert.deepEqual(table.rows, [["주관", ""]]);

  const schema = parseSampleTemplate({ blocks, fileName: "공고.hwpx", format: "hwpx" });
  assert.equal(schema.counts.emptyCells, 1);
  assert.equal(schema.slots.some((slot) => slot.kind === "guide"), true);
});

test("실제 HWPX(zip)에서 섹션 XML을 모아 읽는다", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/section0.xml", "<hp:sec xmlns:hp='x'><hp:p><hp:run><hp:t>사업 개요</hp:t></hp:run></hp:p></hp:sec>");
  zip.file("Contents/section1.xml", "<hp:sec xmlns:hp='x'><hp:p><hp:run><hp:t>1. 추진 배경</hp:t></hp:run></hp:p></hp:sec>");
  const blocks = await readHwpxBlocks(zip);
  assert.deepEqual(blocks.map((block) => block.title || block.text), ["사업 개요", "추진 배경"]);
});

test("DOCX HTML에서 제목·표·목록을 블록으로 만든다", () => {
  const html = `<h1>사업계획서</h1><p>지역 문제를 정리합니다.</p>
    <table><tr><th>구분</th><th>내용</th></tr><tr><td>주관</td><td></td></tr></table>
    <ul><li>청년 20명 참여</li><li>두레동아리 5팀</li></ul>
    <h2>2. 추진 배경</h2><p>인구 감소 &amp; 빈집 증가</p>`;
  const blocks = extractDocxHtmlBlocks(html);
  assert.equal(blocks[0].type, "heading");
  assert.equal(blocks[0].title, "사업계획서");
  assert.ok(blocks.some((block) => block.type === "paragraph" && block.text.includes("인구 감소 & 빈집 증가")));
  const table = blocks.find((block) => block.type === "table");
  assert.deepEqual(table.headers, ["구분", "내용"]);
  assert.deepEqual(table.rows, [["주관", ""]]);
  assert.equal(blocks.filter((block) => block.type === "list").length, 2);
});

test("블록을 평문으로 되돌리면 표와 제목이 Markdown으로 남는다", () => {
  const text = blocksToText([
    { type: "heading", level: 1, title: "사업 개요" },
    { type: "paragraph", text: "본문" },
    { type: "table", headers: ["구분", "내용"], rows: [["주관", "센터"]] }
  ]);
  assert.equal(text, "# 사업 개요\n본문\n| 구분 | 내용 |\n| --- | --- |\n| 주관 | 센터 |");
});

test("프로필 값은 공백을 정리하고 길이를 제한한다", () => {
  const profile = normalizeProfile({ projectName: "  양양   생활문화  ", summary: "가".repeat(3000), unknown: "무시" });
  assert.equal(profile.projectName, "양양 생활문화");
  assert.equal(profile.summary.length, 2000);
  assert.equal(Object.hasOwn(profile, "unknown"), false);
  assert.equal(profile.region, "");
});
