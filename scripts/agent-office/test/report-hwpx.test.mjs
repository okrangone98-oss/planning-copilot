import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import {
  buildReportDocument,
  buildReportHwpxBytes,
  contentBlocks,
  renderReportBodyXml,
  reportFileName,
  reportTemplateUrl,
  tableXml
} from "../../../src/lib/reportHwpx.mjs";
import { parseHwpxXml } from "../../../src/lib/browserHwpxFiller.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const BASE = path.join(ROOT, "public/hwpx/report-base.hwpx");

const PLAN = {
  schemaVersion: 1,
  presetId: "national-basic",
  presetName: "국고보조사업 기본",
  programName: "2026 양양 관광두레 플러스",
  agency: "양양군농촌활성화지원센터",
  fundingSource: "국고보조금",
  fundingYear: "2026",
  subsidyRate: "70",
  localRate: "20",
  selfRate: "10",
  budgetLines: [
    { id: "b1", category: "인건비", item: "외래강사비", unitCost: "250000", quantity: "4", basis: "250,000원 × 4회", note: "" },
    { id: "b2", category: "운영비", item: "재료비", unitCost: "100000", quantity: "2", basis: "100,000원 × 2회", note: "" }
  ],
  checklist: [],
  reportSections: [
    { id: "r1", title: "추진 배경", hint: "", content: "양양 청년의 마을 콘텐츠 기획 역량을 키웁니다.\n두 번째 문단입니다." },
    { id: "r2", title: "운영 결과", hint: "", content: "· 회차: 전체 2회\n· 참석 연인원: 18명" },
    { id: "r3", title: "예산 집행", hint: "", content: "" }
  ],
  schedule: {
    applyDeadline: "2026-02-10",
    projectStart: "2026-03-01",
    projectEnd: "2026-12-20",
    settlementDeadline: "2026-12-31",
    reportDeadline: "2027-01-15",
    memo: ""
  },
  memo: "",
  updatedAt: "2026-11-15T00:00:00.000Z"
};

const WORK = {
  schemaVersion: 1,
  projectId: "prj1",
  tasks: [],
  sessions: [
    { id: "s1", sequence: 1, title: "1회차", startAt: "2026-11-20T14:00", venue: "", instructorName: "", trackAttendance: true, capacity: null, registered: null, attended: 12, status: "done", notes: "" },
    { id: "s2", sequence: 2, title: "2회차", startAt: "2026-12-05T10:00", venue: "", instructorName: "", trackAttendance: true, capacity: null, registered: null, attended: 6, status: "planned", notes: "" }
  ],
  expenses: [
    { id: "e1", budgetLineId: "b1", amount: 500000, vendor: "행복강사", description: "강사비 2회", spentAt: "2026-04-01", status: "paid", evidenceChecked: true, evidenceType: "카드", note: "" }
  ],
  revisions: [],
  changes: [],
  generations: [],
  updatedAt: "2026-11-15T00:00:00.000Z"
};

function textsOf(xml) {
  return Array.from(String(xml).matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)).map((match) => match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"));
}

test("contentBlocks keeps lines and marks bullet lines", () => {
  const blocks = contentBlocks("첫 문단\n\n· 회차: 전체 2회\n- 참석 18명\n");
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "bullet", "bullet"]);
  assert.equal(blocks[1].text, "· 회차: 전체 2회");
});

test("buildReportDocument collects meta, sections, auto totals and the budget table", () => {
  const document = buildReportDocument({ plan: PLAN, work: WORK, generatedAt: "2026-11-15T12:00:00.000Z" });
  assert.equal(document.title, "2026 양양 관광두레 플러스");
  assert.equal(document.subtitle, "결과보고");
  const meta = Object.fromEntries(document.metaRows.map((row) => [row.label, row.value]));
  assert.equal(meta["수행기관"], "양양군농촌활성화지원센터");
  assert.equal(meta["사업기간"], "2026. 3. 1. ~ 2026. 12. 20.");
  assert.equal(meta["결과보고 마감"], "2027. 1. 15.");
  assert.equal(document.sections.length, 3);
  assert.equal(document.sections[2].blocks[0].type, "note");
  const summary = Object.fromEntries(document.summary.map((row) => [row.label, row.value]));
  assert.match(summary["참석 연인원"], /18명/);
  assert.match(summary["예산"], /편성 1,200,000원 \/ 집행 500,000원/);
  assert.deepEqual(document.budget.headers, ["비목", "세목", "산출 근거", "계획(원)", "집행(원)"]);
  assert.deepEqual(document.budget.rows[0], ["인건비", "외래강사비", "250,000원 × 4회", "1,000,000", "500,000"]);
  assert.deepEqual(document.budget.total, ["합계", "", "", "1,200,000", "500,000"]);
});

test("buildReportDocument works with a plan only (no work data)", () => {
  const document = buildReportDocument({ plan: { ...PLAN, budgetLines: [] } });
  assert.equal(document.summary.length, 0);
  assert.equal(document.budget, null);
  assert.equal(document.sections.length, 3);
});

test("renderReportBodyXml writes titles, section headings, paragraphs and tables as HWPX paragraphs", () => {
  const document = buildReportDocument({ plan: PLAN, work: WORK });
  const xml = renderReportBodyXml(document);
  const root = parseHwpxXml(`<hs:sec>${xml}</hs:sec>`);
  assert.ok(root.children.length > 0);
  const texts = textsOf(xml);
  assert.equal(texts[0], "2026 양양 관광두레 플러스");
  assert.equal(texts[1], "결과보고");
  assert.ok(texts.includes("Ⅱ. 추진 배경"));
  assert.ok(texts.includes("두 번째 문단입니다."));
  assert.ok(texts.includes("Ⅰ. 사업 개요"));
  assert.ok(texts.includes("합계"));
  // 태그 짝이 맞는다 — 열고 닫은 문단 수가 같다
  assert.equal((xml.match(/<hp:p /g) || []).length, (xml.match(/<\/hp:p>/g) || []).length);
  assert.equal((xml.match(/<hp:tbl /g) || []).length, 2);
});

test("tableXml keeps cell addresses in a grid and escapes cell text", () => {
  const xml = tableXml({ headers: ["비목", "내용"], rows: [["인건비", "A&B <합계>"]], total: ["합계", ""] });
  assert.match(xml, /rowCnt="3"/);
  assert.match(xml, /colCnt="2"/);
  assert.match(xml, /<hp:cellAddr colAddr="1" rowAddr="1"\/>/);
  assert.match(xml, /A&amp;B &lt;합계&gt;/);
});

test("buildReportHwpxBytes produces a readable HWPX whose section restores the report content", async () => {
  const baseBytes = new Uint8Array(fs.readFileSync(BASE));
  const document = buildReportDocument({ plan: PLAN, work: WORK });
  const { bytes, sectionXml } = await buildReportHwpxBytes({ baseBytes, document });
  assert.ok(bytes.length > 2000);

  const zip = await JSZip.loadAsync(bytes);
  assert.equal(await zip.file("mimetype").async("text"), "application/hwp+zip");
  assert.equal(Object.keys(zip.files)[0], "mimetype");
  assert.ok(zip.file("Contents/header.xml"));
  const written = await zip.file("Contents/section0.xml").async("text");
  assert.equal(written, sectionXml);
  // 쪽 설정(secPr)은 템플릿 것을 그대로 두고 본문만 덧붙였다
  assert.match(written, /<hp:secPr /);
  assert.equal((written.match(/<hp:secPr /g) || []).length, 1);
  assert.ok(written.endsWith("</hs:sec>\n"));

  const texts = textsOf(written);
  assert.equal(texts[0], "2026 양양 관광두레 플러스");
  assert.ok(texts.includes("양양군농촌활성화지원센터"));
  assert.ok(texts.includes("양양 청년의 마을 콘텐츠 기획 역량을 키웁니다."));
  assert.ok(texts.includes("1,200,000"));

  // 다시 파싱해도 문단·표 구조가 깨지지 않는다
  const root = parseHwpxXml(written);
  const tableCount = (written.match(/<hp:tbl /g) || []).length;
  assert.equal(tableCount, 2);
  assert.ok(root.children.length >= 2);
});

test("buildReportHwpxBytes refuses a missing template or a template without a body", async () => {
  await assert.rejects(() => buildReportHwpxBytes({ baseBytes: new Uint8Array(), document: buildReportDocument({ plan: PLAN }) }), /템플릿을 불러오지 못했습니다/);
  const empty = new JSZip();
  empty.file("mimetype", "application/hwp+zip");
  const bytes = await empty.generateAsync({ type: "uint8array" });
  await assert.rejects(() => buildReportHwpxBytes({ baseBytes: bytes, document: buildReportDocument({ plan: PLAN }) }), /본문\(Contents\/section0\.xml\)이 없습니다/);
});

test("reportFileName and reportTemplateUrl build safe paths", () => {
  assert.equal(reportFileName({ plan: PLAN }), "2026 양양 관광두레 플러스-결과보고.hwpx");
  assert.equal(reportFileName({ plan: { programName: '가/나:*?"<>|' } }), "가 나-결과보고.hwpx");
  assert.equal(reportTemplateUrl("http://127.0.0.1:5173/planning-copilot/"), "http://127.0.0.1:5173/planning-copilot/hwpx/report-base.hwpx");
});
