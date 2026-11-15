// 실제 업무 시나리오 A·B·C — 같은 코드 경로(양식 읽기 → 칸 인식 → 자유 텍스트 배치 → 사전 점검 → HWPX 패치)를
// 저장소 안의 연습 양식·결과보고 바탕으로 돌린다.
//
// A: 주민 교육 추진계획서 / B: 프로그램 운영계획서 / C: 사업 결과보고서
// 저장소에 없는 기관 문서를 새로 받아 왔다고 말하지 않는다. 자동으로 확인할 수 있는 것만 여기서 확인하고,
// 한글에서 눈으로 봐야 하는 항목은 docs/field-usability-checklist.md 의 5장으로 넘긴다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { parseHwpxXml, patchHwpxBytes, summarizeFill } from "../../../src/lib/browserHwpxFiller.mjs";
import { applyFieldValues, buildKordocFillValues, extractFormFields } from "../../../src/lib/kordocFormSpec.mjs";
import { buildDownloadPreflight, explainDownloadFailure } from "../../../src/lib/downloadPreflight.mjs";
import { buildReportDocument, buildReportHwpxBytes } from "../../../src/lib/reportHwpx.mjs";
import {
  parseSampleTemplate,
  parseTextBlocks,
  readHwpxBlocks,
  summarizeSchema
} from "../../../src/lib/sampleTemplateParser.mjs";
import { collectSelectedValues, mapFreeTextToFields } from "../../../src/lib/smartTextMapper.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PRACTICE_HWPX = path.join(ROOT, "public/practice/plan-practice-form.hwpx");
const REPORT_BASE = path.join(ROOT, "public/hwpx/report-base.hwpx");

/** 연습 양식 .hwpx 를 앱과 같은 경로로 읽는다(업로드 → 블록 추출 → 스키마). */
async function loadPractice() {
  const bytes = new Uint8Array(fs.readFileSync(PRACTICE_HWPX));
  const zip = await JSZip.loadAsync(bytes);
  const blocks = await readHwpxBlocks(zip);
  const schema = parseSampleTemplate({ blocks, fileName: "plan-practice-form.hwpx", format: "hwpx" });
  return { bytes, schema };
}

/** ② 단계 자동 배치 → ③ 단계 값 확정 → 사전 점검. */
function fillFlow({ schema, text }) {
  const fields = extractFormFields(schema);
  const mapped = mapFreeTextToFields({ fields, text });
  const selected = new Set(mapped.rows.map((row) => row.fieldId));
  const { values } = collectSelectedValues(mapped.rows, selected);
  const applied = applyFieldValues(schema, values, { force: true });
  const lowConfidenceIds = new Set(mapped.rows.filter((row) => row.score < 0.6).map((row) => row.fieldId));
  const preflight = buildDownloadPreflight({
    fields,
    values,
    autoFieldIds: selected,
    lowConfidenceIds,
    leftovers: mapped.leftovers,
    schema: applied.schema || schema,
    title: schema?.title || "",
    hasFile: true
  });
  return { fields, mapped, values, lowConfidenceIds, preflight };
}

function textsOf(xml) {
  return Array.from(String(xml).matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)).map((match) =>
    match[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  );
}

async function patchedXml(bytes, values) {
  const result = await patchHwpxBytes({ bytes, values });
  const zip = await JSZip.loadAsync(result.bytes);
  const names = Object.keys(zip.files).filter((name) => /^Contents\/section\d+\.xml$/.test(name));
  const xml = (await Promise.all(names.map((name) => zip.file(name).async("string")))).join("\n");
  return { result, zip, xml, names };
}

function countTags(xml, tag) {
  return (String(xml).match(new RegExp(`<hp:${tag}[\\s>]`, "g")) || []).length;
}

/* ────────────────────────── A. 주민 교육 추진계획서 ────────────────────────── */

const PLAN_TEXT_A = [
  "사업명: 2027년 주민 공동체 교육 추진",
  "수행기관: 양양군농촌활성화지원센터",
  "사업기간: 2027-03-02 ~ 2027-11-30",
  "사업지역: 양양군 현남면",
  "총사업비: 12,000,000원",
  "담당자: 오대훈",
  "지역 현황: 현남면 인구 4,120명 가운데 65세 이상이 38%입니다.",
  "문제점: 주민 교육을 열어도 강사와 장소를 매번 새로 구해야 합니다.",
  "목표: 주민 40명이 마을 수업을 스스로 기획합니다.",
  "참여 인원: 40명",
  "추진 내용: 마을 기록 교실 8회와 목공 교실 4회를 엽니다.",
  "운영 방법: 마을회관과 센터 강당을 함께 씁니다.",
  "협력 기관: 현남면 마을회",
  "인건비: 6,000,000원",
  "운영비: 4,000,000원",
  "홍보비: 1,000,000원",
  "예비비: 1,000,000원"
].join("\n");

test("A. 주민 교육 추진계획서 — 연습 양식에서 칸을 읽고 자유 텍스트를 제자리에 배치한다", async () => {
  const { schema } = await loadPractice();
  const summary = summarizeSchema(schema);
  assert.equal(summary.sections, 7);
  assert.equal(summary.tables, 7);

  const { fields, mapped, values, preflight } = fillFlow({ schema, text: PLAN_TEXT_A });
  assert.equal(fields.length, 25);
  assert.ok(mapped.rows.length >= 12, `배치된 칸이 12개 미만입니다: ${mapped.rows.length}`);

  const byLabel = new Map(mapped.rows.map((row) => [row.label, row]));
  for (const label of ["사업명", "수행기관", "사업기간", "총사업비", "담당자", "추진 내용", "인건비"]) {
    assert.ok(byLabel.has(label), `‘${label}’ 칸에 배치되지 않았습니다`);
    assert.equal(byLabel.get(label).score, 1, `‘${label}’은 라벨이 그대로라 점수 1이어야 합니다`);
  }
  assert.equal(values[byLabel.get("사업기간").fieldId], "2027-03-02 ~ 2027-11-30");
  // 사업명 칸에 다른 칸의 값이 섞이지 않는다.
  assert.equal(values[byLabel.get("사업명").fieldId], "2027년 주민 공동체 교육 추진");

  assert.equal(preflight.stats.filled >= 12, true);
  assert.equal(preflight.counts.block, 0, preflight.items.map((item) => item.title).join(" / "));
  assert.equal(preflight.canDownload, true);
  assert.equal(preflight.budget.status, "match", "총사업비와 비목 합계가 같아야 합니다");
});

test("A. 받은 .hwpx — 서식 정의는 그대로, 값은 제자리에, 수정한 값도 유지된다", async () => {
  const { bytes, schema } = await loadPractice();
  const { fields, values, mapped } = fillFlow({ schema, text: PLAN_TEXT_A });
  const fill = buildKordocFillValues({ fields, values });
  const byLabel = new Map(mapped.rows.map((row) => [row.label, row]));

  const before = await JSZip.loadAsync(bytes);
  const { result, zip, xml } = await patchedXml(bytes, fill.values);

  assert.ok(result.filled.length >= 12, `채운 칸 ${result.filled.length}개`);
  assert.equal(result.unmatched.length, 0, `못 찾은 값: ${result.unmatched.join(", ")}`);
  const summary = summarizeFill(result);
  assert.match(summary, /채웠습니다/);

  const texts = textsOf(xml);
  assert.ok(texts.some((line) => line.includes("2027년 주민 공동체 교육 추진")));
  assert.ok(texts.some((line) => line.includes("양양군농촌활성화지원센터")));
  assert.ok(texts.some((line) => line.includes("6,000,000원")));

  // 표·칸 수와 서식 정의(header.xml)는 원본과 같아야 한다 — 서식이 깨지면 한글에서 문서가 달라진다.
  const originalSection = await before.file("Contents/section0.xml").async("string");
  assert.equal(countTags(xml, "tbl"), countTags(originalSection, "tbl"));
  assert.equal(countTags(xml, "tc"), countTags(originalSection, "tc"));
  const originalHeader = await before.file("Contents/header.xml").async("string");
  const patchedHeader = await zip.file("Contents/header.xml").async("string");
  assert.equal(patchedHeader, originalHeader);

  // 문단 모양·글자 모양 참조가 새로 생기지 않았는지 (서식 정의를 건드리지 않았다는 두 번째 증거)
  assert.equal(countTags(xml, "p"), countTags(originalSection, "p"));

  // 3단계에서 값을 고친 뒤 다시 내려받아도 고친 값이 남는다.
  const editedLabel = "홍보비";
  const editedField = byLabel.get(editedLabel).fieldId;
  const editedValues = { ...fill.values, [editedLabel]: "1,200,000원" };
  const edited = await patchedXml(bytes, editedValues);
  assert.ok(textsOf(edited.xml).some((line) => line.includes("1,200,000원")), "수정한 값이 .hwpx에 들어가지 않았습니다");
  assert.equal(editedField.length > 0, true);
  assert.ok(textsOf(edited.xml).some((line) => line.includes("2027년 주민 공동체 교육 추진")), "다른 칸 값이 사라졌습니다");

  // 내려받은 파일을 다시 읽어 칸 구조가 남아 있는지 (kordoc 재읽기와 같은 경로)
  const reread = await readHwpxBlocks(edited.zip);
  const rereadText = reread.filter((block) => block.type === "table")
    .flatMap((block) => (block.rows || []).flat())
    .join(" ");
  assert.ok(rereadText.includes("1,200,000원"), "다시 읽은 문서에 수정한 값이 없습니다");
  assert.ok(rereadText.includes("양양군농촌활성화지원센터"));
});

/* ────────────────────────── B. 프로그램 운영계획서 ────────────────────────── */

const PLAN_TEXT_B = [
  "사업명: 2026 양양 생활문화 프로그램 운영",
  "수행기관: 양양군생활문화센터",
  "사업기간: 2026-04-01 ~ 2026-12-15",
  "총사업비: 5,000,000원",
  "담당자: 김말랑",
  "목표: 주민 60명이 생활문화 프로그램에 참여합니다.",
  "참여 인원: 60명",
  "운영 방법: 매주 토요일 오전 10시, 센터 2층 강당",
  "추진 내용: 우쿨렐레 교실 12회, 도예 교실 8회를 엽니다.",
  "인건비: 3,000,000원",
  "운영비: 1,500,000원",
  "홍보비: 300,000원",
  "예비비: 0원"
].join("\n");

test("B. 프로그램 운영계획서 — 예산 합계가 어긋나면 알리되 내려받기는 막지 않는다", async () => {
  const { bytes, schema } = await loadPractice();
  const { fields, values, preflight } = fillFlow({ schema, text: PLAN_TEXT_B });

  // 3,000,000 + 1,500,000 + 300,000 = 4,800,000 ≠ 5,000,000
  assert.equal(preflight.budget.status, "mismatch");
  const budgetItem = preflight.items.find((item) => item.id === "budget-mismatch");
  assert.ok(budgetItem);
  assert.equal(budgetItem.level, "warn");
  assert.match(budgetItem.detail, /차액 200,000원/);
  assert.equal(preflight.canDownload, true, "권장 항목은 다운로드를 막지 않는다");

  const fill = buildKordocFillValues({ fields, values });
  const { result, xml } = await patchedXml(bytes, fill.values);
  assert.ok(result.filled.length >= 8, `채운 칸 ${result.filled.length}개`);
  const texts = textsOf(xml);
  assert.ok(texts.some((line) => line.includes("2026 양양 생활문화 프로그램 운영")));
  assert.ok(texts.some((line) => line.includes("우쿨렐레 교실")));
});

test("B. 엉뚱한 칸에 붙은 값은 조용히 넘어가지 않고 ‘확인 필요’로 잡아낸다", async () => {
  const { schema } = await loadPractice();
  // 연습 양식에는 ‘출석 인원’ 칸이 없다 — 자유 배치가 비슷한 ‘참여 인원’ 칸에 붙일 수 있다.
  const text = `${PLAN_TEXT_B}\n출석 인원: 0명`;
  const { fields, values, mapped, preflight } = fillFlow({ schema, text });
  const joinRow = mapped.rows.find((row) => row.label === "참여 인원");
  assert.ok(joinRow.proposed.includes("0명"), "규칙 배치가 두 값을 한 칸에 붙이는 상황을 재현하지 못했습니다");

  const flagged = preflight.items.find((item) => item.id === "invalid-format");
  assert.ok(flagged, `형식 오류로 잡지 못했습니다: ${preflight.items.map((item) => item.id).join(", ")}`);
  assert.equal(flagged.level, "block");
  assert.match(flagged.detail, /참여 인원/);
  assert.equal(preflight.canDownload, false);
  assert.match(preflight.gateMessage, /한 번 더 누르면/);

  // 사람이 칸에서 직접 고치면 그 값만 바뀌고 다른 칸 값은 그대로다.
  const fixed = { ...values, [joinRow.fieldId]: "60명" };
  const after = buildDownloadPreflight({ fields, values: fixed, hasFile: true });
  assert.equal(after.items.some((item) => item.id === "invalid-format"), false);
  assert.equal(fixed[fields.find((field) => field.label === "사업명").id], "2026 양양 생활문화 프로그램 운영");
});

test("B. 같은 이름의 칸이 여러 곳이면 어느 곳에 어떤 값이 들어가는지 사람이 확인하게 한다", async () => {
  const { schema } = await loadPractice();
  const fields = extractFormFields(schema);
  const values = {
    [fields.find((field) => field.label === "사업명").id]: "2026 양양 생활문화 프로그램 운영",
    [fields.find((field) => field.label === "담당자").id]: "김말랑"
  };
  const preflight = buildDownloadPreflight({
    fields: [...fields, { ...fields[0], id: "dup-name", label: "사업명", fillKey: "사업명" }],
    values: { ...values, "dup-name": "다른 사업명" },
    hasFile: true
  });
  const item = preflight.items.find((entry) => entry.id === "duplicate-label");
  assert.ok(item);
  assert.equal(item.level, "warn");
});

/* ────────────────────────── C. 사업 결과보고서 ────────────────────────── */

const REPORT_FORM = `# 2026년 청년 마을활동가 양성 과정 결과보고서

## 1. 사업 개요

| 구분 | 내용 |
| --- | --- |
| 사업명 |  |
| 수행기관 |  |
| 사업기간 |  |

## 2. 운영 결과

| 구분 | 내용 |
| --- | --- |
| 추진 실적 |  |
| 출석 인원 |  |
| 만족도 |  |

## 3. 예산 집행

| 구분 | 내용 |
| --- | --- |
| 집행액 |  |
`;

const REPORT_TEXT = [
  "사업명: 2026년 청년 마을활동가 양성 과정",
  "수행기관: 양양군농촌활성화지원센터",
  "추진 실적: 8회 운영, 수료 14명"
].join("\n");

test("C. 결과보고서 양식 — 실적·출석이 비면 불완전하다고 표시하고, 미입력과 0명을 구분한다", () => {
  const blocks = parseTextBlocks(REPORT_FORM);
  const schema = parseSampleTemplate({ blocks, text: REPORT_FORM, fileName: "결과보고서.md", format: "markdown" });
  const { fields, values, preflight } = fillFlow({ schema, text: REPORT_TEXT });

  const labels = fields.map((field) => field.label);
  for (const label of ["사업명", "수행기관", "추진 실적", "출석 인원", "만족도", "집행액"]) {
    assert.ok(labels.includes(label), `‘${label}’ 칸을 읽지 못했습니다: ${labels.join(", ")}`);
  }
  assert.equal(values[fields.find((field) => field.label === "사업명").id], "2026년 청년 마을활동가 양성 과정");

  const ids = preflight.items.map((item) => item.id);
  assert.ok(ids.includes("report-incomplete"), `결과보고 불완전 안내가 없습니다: ${ids.join(", ")}`);
  assert.ok(ids.includes("attendance-blank"), "출석 미입력 안내가 없습니다");
  const incomplete = preflight.items.find((item) => item.id === "report-incomplete");
  assert.equal(incomplete.level, "manual", "자동 판단 불가 항목은 사람 확인으로 넘긴다");
  assert.match(incomplete.fix, /미입력인지 0명인지/);
  assert.equal(preflight.canDownload, true, "양식 파일이 있으면 사람 확인 항목만으로 막지 않는다");
});

test("C. 결과보고서 양식인데 .hwpx 파일이 없으면 이유와 다음 할 일을 준다", () => {
  const blocks = parseTextBlocks(REPORT_FORM);
  const schema = parseSampleTemplate({ blocks, text: REPORT_FORM, fileName: "결과보고서.md", format: "markdown" });
  const fields = extractFormFields(schema);
  const mapped = mapFreeTextToFields({ fields, text: REPORT_TEXT });
  const { values } = collectSelectedValues(mapped.rows, new Set(mapped.rows.map((row) => row.fieldId)));
  const preflight = buildDownloadPreflight({ fields, values, schema, title: schema.title, hasFile: false });

  assert.equal(preflight.canDownload, false);
  const noFile = preflight.items.find((item) => item.id === "no-file");
  assert.ok(noFile);
  assert.match(noFile.fix, /연습 양식을 불러온 뒤/);
  assert.match(noFile.fix, /지금 적은 값은 그대로 남습니다/);

  const failure = explainDownloadFailure(new Error("not a zip"));
  assert.match(failure.fix, /HWPX/);
});

test("C. 결과보고 .hwpx — 참석을 적지 않은 회차와 0명을 다르게 적는다", async () => {
  const plan = {
    programName: "2026년 청년 마을활동가 양성 과정",
    agency: "양양군농촌활성화지원센터",
    fundingSource: "군비",
    fundingYear: "2026",
    budgetLines: [
      { id: "b1", category: "인건비", item: "강사비", unitCost: "200000", quantity: "8", basis: "200,000원 × 8회", note: "" }
    ],
    reportSections: [
      { id: "r1", title: "운영 결과", hint: "", content: "⌐ 8회 운영, 수료 14명" },
      { id: "r2", title: "아쉬운 점", hint: "", content: "" }
    ],
    schedule: { projectStart: "2026-03-02", projectEnd: "2026-11-30", reportDeadline: "2026-12-15" }
  };
  const work = {
    sessions: [
      { id: "s1", sequence: 1, title: "1회차", status: "done", trackAttendance: true, attended: 12 },
      { id: "s2", sequence: 2, title: "2회차", status: "done", trackAttendance: true },
      { id: "s3", sequence: 3, title: "3회차", status: "planned", trackAttendance: true, attended: 0 }
    ],
    expenses: [
      { id: "e1", budgetLineId: "b1", amount: 1_600_000, vendor: "행복강사", description: "강사비 8회", spentAt: "2026-06-01", status: "paid", evidenceChecked: false, evidenceType: "", note: "" }
    ]
  };

  const document = buildReportDocument({ plan, project: {}, work, generatedAt: "2026-12-01T00:00:00.000Z" });
  const attended = document.summary.find((row) => row.label === "참석 연인원");
  assert.ok(attended);
  assert.match(attended.value, /12명/);
  assert.match(attended.value, /참석을 적지 않은 1회차는 합계에서 뺌/);
  assert.match(attended.value, /0명으로 세지 않음/);

  // 본문에 쓰지 않은 절은 “아직 쓰지 않았습니다”로 남겨 불완전한 보고서를 숨기지 않는다.
  const emptySection = document.sections.find((section) => section.title === "아쉬운 점");
  assert.equal(emptySection.blocks[0].text, "아직 쓰지 않았습니다. 제출 전에 내용을 채워 주세요.");

  const baseBytes = new Uint8Array(fs.readFileSync(REPORT_BASE));
  const { bytes } = await buildReportHwpxBytes({ baseBytes, document });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("Contents/section0.xml").async("string");
  const texts = textsOf(xml);
  assert.ok(texts.some((line) => line.includes("2026년 청년 마을활동가 양성 과정")));
  assert.ok(texts.some((line) => line.includes("참석을 적지 않은 1회차는 합계에서 뺌")));
  assert.ok(texts.some((line) => line.includes("1,600,000")), "집행액이 보고서에 적히지 않았습니다");
  assert.equal(parseHwpxXml(xml) !== null, true);
});
