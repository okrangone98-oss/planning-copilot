// HWPX 미리보기(Preview/) 회귀 테스트 — 채운 파일이 ‘작년 문서’로 보이던 문제.
//
// 실제 사례: 2025년 양식을 2026년 내용으로 채워 내려받았더니 본문은 2026년인데
// ZIP 안 Preview/PrvImage.png · Preview/PrvText.txt 가 2025년 그대로 남아,
// 모바일·일부 뷰어가 미리보기를 먼저 보여 줘 작년 문서처럼 보였다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  DEFAULT_PREVIEW_TEXT_LIMIT,
  PREVIEW_IMAGE_ENTRY,
  PREVIEW_TEXT_ENTRY,
  extractPreviewText,
  isPreviewImageEntry,
  isPreviewTextEntry,
  planPreviewPatch,
  stripPreviewImageReferences
} from "../../../src/lib/hwpxPreview.mjs";
import { patchHwpxBytes } from "../../../src/lib/browserHwpxFiller.mjs";
import { buildReportDocument, buildReportHwpxBytes } from "../../../src/lib/reportHwpx.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PRACTICE = path.join(ROOT, "public/practice/plan-practice-form.hwpx");

function sectionXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`;
}

function paragraph(text) {
  return `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${text}</hp:t></hp:run></hp:p>`;
}

/** 라벨 | 값 두 칸짜리 표 한 줄. */
function labelRow(label) {
  const cell = (text, col) => `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
    + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${text}</hp:t></hp:run></hp:p></hp:subList>`
    + `<hp:cellAddr colAddr="${col}" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
    + `<hp:cellSz width="1000" height="500"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  return `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17">`
    + `<hp:tbl id="1" rowCnt="1" colCnt="2" cellSpacing="0" borderFillIDRef="1">`
    + `<hp:sz width="2000" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:tr>${cell(label, 0)}${cell("", 1)}</hp:tr></hp:tbl></hp:run></hp:p>`;
}

const OLD_TITLE = "2025년 시군역량강화사업 추진 계획";
const NEW_TITLE = "2026년 시군역량강화사업 추진 계획";

/** 한컴오피스가 만든 양식처럼 미리보기 그림·글자·목록 참조를 모두 갖춘 2025년 양식. */
async function oldYearFormBytes() {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip");
  zip.file("version.xml", "<hv:HCFVersion major=\"5\"/>");
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>`
    + `<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"><ocf:rootfiles>`
    + `<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>`
    + `<ocf:rootfile full-path="Preview/PrvText.txt" media-type="text/plain"/>`
    + `</ocf:rootfiles></ocf:container>`);
  zip.file("Contents/content.hpf", `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>`
    + `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>`
    + `<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>`
    + `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>`
    + `<opf:item id="prvtext" href="Preview/PrvText.txt" media-type="text/plain"/>`
    + `<opf:item id="prvimage" href="Preview/PrvImage.png" media-type="image/png"/>`
    + `</opf:manifest><opf:spine><opf:itemref idref="section0" linear="yes"/><opf:itemref idref="prvimage" linear="no"/></opf:spine></opf:package>`);
  zip.file("Contents/header.xml", "<hh:head/>");
  zip.file("Contents/section0.xml", sectionXml(paragraph(OLD_TITLE) + labelRow("사업명")));
  zip.file("Preview/PrvText.txt", `${OLD_TITLE}\n1. 사업명: 2025년 사업\n`);
  zip.file(PREVIEW_IMAGE_ENTRY, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

test("extractPreviewText reads visible text with paragraph, line break and tab handling", () => {
  const xml = sectionXml(
    paragraph("첫 문단") .replace("<hp:t>첫 문단</hp:t>", "<hp:t>첫 문단&amp;끝</hp:t>")
    + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>둘째<hp:lineBreak/>줄</hp:t><hp:t>이어짐</hp:t><hp:t/></hp:run></hp:p>`
    + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>탭<hp:tab/>뒤</hp:t></hp:run></hp:p>`
  );
  const text = extractPreviewText([xml]);
  assert.equal(text, "첫 문단&끝\r\n둘째\r\n줄이어짐\r\n탭 뒤");
});

test("extractPreviewText skips self-closing t elements without swallowing later text", () => {
  // <hp:t/> 뒤에 오는 글자를 앞 요소의 글자로 잘못 붙이면 목록·표가 통째로 밀린다.
  const xml = sectionXml(`<hp:p><hp:run><hp:t/></hp:run></hp:p>${paragraph("살아 있는 글")}`);
  assert.equal(extractPreviewText([xml]), "살아 있는 글");
});

test("extractPreviewText keeps the front of the body and stops at a line boundary", () => {
  const long = Array.from({ length: 40 }, (_, index) => `줄 ${index + 1} ${"가".repeat(40)}`).join("\n");
  const text = extractPreviewText([sectionXml(paragraph(long))]);
  assert.ok(text.length <= DEFAULT_PREVIEW_TEXT_LIMIT, `미리보기 길이 ${text.length}`);
  assert.match(text, /^줄 1 /);
  const last = text.split("\r\n").at(-1);
  assert.match(last, /줄 \d+ 가+$/); // 줄 중간에서 잘리지 않는다
  assert.equal(/\r(?!\n)/.test(text) || /(^|[^\r])\n/.test(text), false, "CRLF 줄바꿈만 쓴다");
});

test("stripPreviewImageReferences removes the image item and its spine reference", () => {
  const hpf = `<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>`
    + `<opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>`
    + `<opf:item id="prvtext" href="Preview/PrvText.txt" media-type="text/plain"/>`
    + `<opf:item id="prvimage" href="Preview/PrvImage.png" media-type="image/png"/>`
    + `</opf:manifest><opf:spine><opf:itemref idref="section0" linear="yes"/><opf:itemref idref="prvimage" linear="no"/></opf:spine></opf:package>`;
  const result = stripPreviewImageReferences(hpf);
  assert.equal(result.changed, true);
  assert.ok(!/PrvImage/i.test(result.xml));
  assert.match(result.xml, /id="prvtext" href="Preview\/PrvText\.txt"/);
  assert.match(result.xml, /idref="section0"/);
  assert.equal(stripPreviewImageReferences("<odf:manifest/>").changed, false);
});

test("isPreviewImageEntry and isPreviewTextEntry match the ZIP paths", () => {
  assert.equal(isPreviewImageEntry("Preview/PrvImage.png"), true);
  assert.equal(isPreviewImageEntry("Preview/PrvImage.bmp"), true);
  assert.equal(isPreviewImageEntry("Preview/PrvText.txt"), false);
  assert.equal(isPreviewTextEntry("Preview/PrvText.txt"), true);
  assert.equal(isPreviewTextEntry("Contents/section0.xml"), false);
});

test("planPreviewPatch collects the stale image entry and rebuilds the text", () => {
  const plan = planPreviewPatch({ names: ["mimetype", "Preview/PrvImage.png", "Contents/section0.xml"], sectionXmls: [sectionXml(paragraph("새 본문"))] });
  assert.deepEqual(plan.removeEntries, ["Preview/PrvImage.png"]);
  assert.equal(plan.previewText, "새 본문");
});

test("patchHwpxBytes replaces the old-year preview text and drops the old preview image", async () => {
  const bytes = await oldYearFormBytes();
  const result = await patchHwpxBytes({
    bytes,
    values: { 사업명: NEW_TITLE },
    rewrites: [{ from: OLD_TITLE, to: NEW_TITLE, label: "문서 제목" }]
  });
  assert.deepEqual(result.filled.map((item) => item.value).sort(), [NEW_TITLE, NEW_TITLE].sort());
  assert.equal(result.preview.written, true);
  assert.deepEqual(result.preview.removedImages, [PREVIEW_IMAGE_ENTRY]);

  const zip = await JSZip.loadAsync(result.bytes);
  const preview = await zip.file(PREVIEW_TEXT_ENTRY).async("text");
  // 1) 미리보기 글자는 채운 본문에서 새로 만든다 — 원본 미리보기 글(2025년 사업)이 남지 않는다
  assert.ok(preview.includes(NEW_TITLE), `미리보기에 ${NEW_TITLE} 가 없습니다: ${preview}`);
  assert.ok(!preview.includes("1. 사업명: 2025년 사업"), `원본 미리보기 글자가 남았습니다: ${preview}`);
  assert.ok(!/2025/.test(preview), `옛 연도 글자가 남았습니다: ${preview}`);
  // 2) 옛 그림 미리보기는 넣지 않는다
  assert.equal(zip.file(PREVIEW_IMAGE_ENTRY), null);
  assert.equal(Object.keys(zip.files).some((name) => isPreviewImageEntry(name)), false);
  // 3) 목록 정합성 — 그림 항목은 지우고, 글자 미리보기 항목은 남긴다
  const hpf = await zip.file("Contents/content.hpf").async("text");
  assert.ok(!/PrvImage/i.test(hpf), hpf);
  assert.match(hpf, /href="Preview\/PrvText\.txt"/);
  const container = await zip.file("META-INF/container.xml").async("text");
  assert.match(container, /full-path="Preview\/PrvText\.txt"/, "container.xml 이 가리키는 미리보기 글자는 그대로 있어야 한다");
  assert.ok(zip.file(PREVIEW_TEXT_ENTRY), "container.xml 이 가리키는 파일이 없으면 패키지가 깨진다");
  // 4) HWPX 규칙 — mimetype 은 첫 엔트리·무압축
  assert.equal(Object.keys(zip.files)[0], "mimetype");
  // 5) 본문·서식은 그대로
  const section = await zip.file("Contents/section0.xml").async("text");
  assert.ok(section.includes(NEW_TITLE));
  assert.equal(await zip.file("Contents/header.xml").async("text"), "<hh:head/>");
});

test("patchHwpxBytes keeps the practice form readable and refreshes its preview text", async () => {
  const bytes = new Uint8Array(fs.readFileSync(PRACTICE));
  const before = await (await JSZip.loadAsync(bytes)).file(PREVIEW_TEXT_ENTRY).async("text");
  const result = await patchHwpxBytes({ bytes, values: { 사업명: "2027 양양 생활문화 혁신 지원사업", 수행기관: "양양군농촌활성화지원센터" } });
  assert.equal(result.filled.length, 2);
  const zip = await JSZip.loadAsync(result.bytes);
  const preview = await zip.file(PREVIEW_TEXT_ENTRY).async("text");
  // 원본 미리보기를 그대로 복사하지 않고, 채운 본문에서 다시 만든다
  assert.notEqual(preview, before);
  assert.ok(preview.includes("2027 양양 생활문화 혁신 지원사업"), preview.slice(0, 400));
  assert.ok(preview.includes("양양군농촌활성화지원센터"));
  assert.ok(await zip.file("Contents/section0.xml").async("text"));
});

test("patchHwpxBytes adds a preview text when the form had only an image", async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip");
  zip.file("Contents/section0.xml", sectionXml(paragraph("그림만 있던 양식") + labelRow("사업명")));
  zip.file(PREVIEW_IMAGE_ENTRY, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  const bytes = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  const result = await patchHwpxBytes({ bytes, values: { 사업명: "새 사업" } });
  const output = await JSZip.loadAsync(result.bytes);
  assert.equal(output.file(PREVIEW_IMAGE_ENTRY), null);
  assert.match(await output.file(PREVIEW_TEXT_ENTRY).async("text"), /그림만 있던 양식/);
});

test("buildReportHwpxBytes writes preview text from the report body, not the template", async () => {
  const baseBytes = new Uint8Array(fs.readFileSync(path.join(ROOT, "public/hwpx/report-base.hwpx")));
  const document = buildReportDocument({
    plan: {
      programName: "2026 양양 관광두레 플러스",
      agency: "양양군농촌활성화지원센터",
      fundingYear: "2026",
      budgetLines: [],
      reportSections: [{ id: "r1", title: "추진 배경", hint: "", content: "청년 콘텐츠 기획 역량을 키웠습니다." }]
    },
    generatedAt: "2026-11-16T00:00:00.000Z"
  });
  const { bytes, preview } = await buildReportHwpxBytes({ baseBytes, document });
  assert.equal(preview.written, true);
  const zip = await JSZip.loadAsync(bytes);
  const text = await zip.file(PREVIEW_TEXT_ENTRY).async("text");
  assert.ok(text.includes("추진 배경"), text.slice(0, 300));
  assert.ok(text.includes("청년 콘텐츠 기획 역량을 키웠습니다."), text.slice(0, 500));
  assert.equal(Object.keys(zip.files).some((name) => isPreviewImageEntry(name)), false);
  assert.equal(Object.keys(zip.files)[0], "mimetype");
});
