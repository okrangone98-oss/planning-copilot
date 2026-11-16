import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { extractPlanSource, appendMaterialText, planSourceLines } from "../../../src/lib/hwpxSourceExtractor.mjs";
import {
  buildCarryoverPlan,
  carryoverOverwriteMap,
  classifyCarryover,
  CARRYOVER_LEFTOVER_LABEL,
  CARRYOVER_REPLACED_LABEL,
  detectPreviousYearDocument,
  findLeftoverYearValues,
  previousYearSignals
} from "../../../src/lib/yearCarryover.mjs";
import {
  dateFromPhotoName,
  parseAttendanceMaterial,
  parseExpenseMaterial,
  parseSpreadsheetMaterial,
  photoCaptions,
  titleFromPhotoName
} from "../../../src/lib/reportMaterials.mjs";
import { extractFormFields, normalizeFormLabel } from "../../../src/lib/kordocFormSpec.mjs";
import { parseSampleTemplate, readHwpxBlocks } from "../../../src/lib/sampleTemplateParser.mjs";
import { patchSectionXml, patchHwpxBytes } from "../../../src/lib/browserHwpxFiller.mjs";
import { buildDownloadPreflight } from "../../../src/lib/downloadPreflight.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const PRACTICE = path.join(ROOT, "public/practice/plan-practice-form.hwpx");
const CURRENT_YEAR = 2026;

/** 연습 양식을 읽어 라벨 뒤의 첫 빈 글자 자리에 값을 넣은 .hwpx 를 만든다. */
async function filledPlanHwpx(values) {
  const zip = await JSZip.loadAsync(fs.readFileSync(PRACTICE));
  const out = new JSZip();
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) {
      out.folder(name.replace(/\/$/, ""));
      continue;
    }
    let data = await entry.async("uint8array");
    if (/^Contents\/section\d+\.xml$/i.test(name)) {
      let xml = new TextDecoder().decode(data);
      for (const [label, value] of Object.entries(values)) {
        const labelIndex = xml.indexOf(`<hp:t>${label}</hp:t>`);
        if (labelIndex < 0) continue;
        const after = xml.slice(labelIndex);
        const emptyRun = /<hp:t\s*\/>|<hp:t><\/hp:t>/.exec(after);
        if (!emptyRun) continue;
        const at = labelIndex + after.indexOf(emptyRun[0]);
        xml = xml.slice(0, at) + `<hp:t>${value}</hp:t>` + xml.slice(at + emptyRun[0].length);
      }
      data = new TextEncoder().encode(xml);
    }
    out.file(name, data, { binary: true, compression: "DEFLATE" });
  }
  return out.generateAsync({ type: "uint8array" });
}

/* ────────────────────────── ① 올해 추진계획서 추출기 ────────────────────────── */

test("올해 추진계획서 .hwpx에서 라벨·값·예산·일정을 재료 글로 뽑는다", async () => {
  const bytes = await filledPlanHwpx({
    사업명: "2026 양양 서핑 청년 마을 만들기",
    수행기관: "양양군농촌활성화지원센터",
    사업기간: "2026년 3월 ~ 11월",
    총사업비: "총 4,800만원"
  });
  const result = await extractPlanSource({ bytes, fileName: "2026-추진계획서.hwpx" });
  assert.equal(result.ok, true);
  assert.ok(result.text.includes("■ 올해 추진계획서 (2026-추진계획서.hwpx)"));
  assert.ok(result.text.includes("사업명: 2026 양양 서핑 청년 마을 만들기"));
  assert.ok(result.counts.labels >= 4);
  // 계획값이라는 안내가 함께 나온다 — 실적 칸에 그대로 넣지 않게.
  assert.ok(result.notes.some((note) => note.includes("계획값")));
});

test("계획서에서 읽지 못한 형식은 추측하지 않고 안내를 돌려준다", async () => {
  const legacy = await extractPlanSource({ bytes: new Uint8Array([1, 2, 3]), fileName: "2026-추진계획서.hwp" });
  assert.equal(legacy.ok, false);
  assert.ok(legacy.warning.includes("HWPX"));

  const broken = await extractPlanSource({ bytes: new Uint8Array([1, 2, 3]), fileName: "계획서.hwpx" });
  assert.equal(broken.ok, false);
  assert.ok(broken.warning.length > 0);
});

test("재료 글은 이미 붙여넣은 글을 지우지 않고 이어 붙이고, 같은 재료를 다시 올리면 그 블록만 새로 바꾼다", () => {
  const first = appendMaterialText({ existing: "메모: 첫 회차 18명", block: "■ 올해 추진계획서 (a.hwpx)\n사업명: X" });
  assert.equal(first.mode, "append");
  assert.ok(first.text.startsWith("메모: 첫 회차 18명"));

  const second = appendMaterialText({ existing: first.text, block: "■ 올해 추진계획서 (a.hwpx)\n사업명: Y" });
  assert.equal(second.mode, "refresh");
  assert.ok(second.text.includes("사업명: Y"));
  assert.ok(!second.text.includes("사업명: X"));
  assert.ok(second.text.startsWith("메모: 첫 회차 18명"));

  // 다른 재료(출석 자료)는 그 뒤에 더 붙는다.
  const third = appendMaterialText({ existing: second.text, block: "■ 출석·지출 자료\n참석 인원: 총 57명" });
  assert.equal(third.mode, "append");
  assert.ok(third.text.includes("사업명: Y") && third.text.includes("총 57명"));
});

test("계획서의 작성 요령 안내문은 재료에서 뺀다", () => {
  const { lines } = planSourceLines([
    { type: "paragraph", text: "※사업명은 공고문의 사업명과 같게 적고, 기간은 시작과 끝을 함께 적습니다." },
    { type: "paragraph", text: "지역에 빈집이 120채 있고 청년이 계속 떠나고 있습니다." }
  ]);
  assert.equal(lines.filter((line) => line.value.includes("작성")).length, 0);
  assert.ok(lines.some((line) => line.value.includes("빈집이 120채")));
});

/* ────────────────────────── ② 전년도 양식 이양 ────────────────────────── */

/** 결과보고서처럼 값이 채워진 스키마를 흉내낸다. */
function filledReportFields() {
  const zip = JSZip.loadAsync(fs.readFileSync(PRACTICE));
  return zip.then(async (loaded) => {
    const blocks = await readHwpxBlocks(loaded);
    const schema = parseSampleTemplate({ blocks, fileName: "2025-결과보고서.hwpx", format: "hwpx" });
    const byLabel = {
      사업명: "2025 양양 서핑 청년 마을 만들기",
      수행기관: "양양군농촌활성화지원센터",
      사업기간: "2025년 3월 ~ 11월",
      총사업비: "4,500만원",
      "참여 인원": "120명"
    };
    const tables = schema.tables.map((table) => ({
      ...table,
      rows: table.rows.map((row) => {
        const label = String(row[0] ?? "").trim();
        return byLabel[label] !== undefined && !String(row[1] ?? "").trim() ? [label, byLabel[label]] : row;
      })
    }));
    const filled = { ...schema, title: "2025년 결과보고서", tables };
    return { schema: filled, byLabel };
  });
}

test("작년 값이 채워진 결과보고서를 이양 대상으로 자동 감지한다", async () => {
  const { schema } = await filledReportFields();
  const fields = extractFormFields(schema);
  const detection = detectPreviousYearDocument({ fileName: "2025-결과보고서.hwpx", fields, currentYear: CURRENT_YEAR });
  assert.equal(detection.sourceYear, 2025);
  assert.equal(detection.isPreviousYearDocument, true);
  assert.equal(detection.suggested, true);
  assert.ok(detection.reason.includes("2025"));
  // 빈 양식은 이양 대상이 아니다
  const emptySchema = parseSampleTemplate({ blocks: await readHwpxBlocks(await JSZip.loadAsync(fs.readFileSync(PRACTICE))), fileName: "2026-결과보고서.hwpx", format: "hwpx" });
  const emptyDetection = detectPreviousYearDocument({ fileName: "2026-결과보고서.hwpx", fields: extractFormFields(emptySchema), currentYear: CURRENT_YEAR });
  assert.equal(emptyDetection.suggested, false);
});

test("이양 계획은 전년도 값이 적힌 칸을 짚고, 바꿀 값이 없으면 잔존으로 남긴다", async () => {
  const { schema } = await filledReportFields();
  const fields = extractFormFields(schema);
  const plan = buildCarryoverPlan({ fields, currentYear: CURRENT_YEAR, sourceYear: 2025 });
  assert.ok(plan.counts.strong >= 2, `강한 흔적 칸 ${plan.counts.strong}`);
  const periodRow = plan.rows.find((row) => row.label === "사업기간");
  assert.ok(periodRow, "사업기간 칸이 이양 대상이어야 한다");
  assert.equal(periodRow.value, "2025년 3월 ~ 11월");

  // 올해 값으로 바꾸면 잔존이 없다
  const values = {};
  for (const row of plan.rows) values[row.fieldId] = row.value.replaceAll("2025", "2026").replace("4,500만원", "4,800만원").replace("120명", "156명");
  const leftover = findLeftoverYearValues({ fields, values, planRows: plan.rows, currentYear: CURRENT_YEAR, sourceYear: 2025 });
  assert.equal(leftover.counts.strong, 0);

  // 바꿀 값이 없는 칸은 전년도 값이 그대로 남는다
  const partial = { ...values };
  delete partial[plan.rows[0].fieldId];
  const leftoverPartial = findLeftoverYearValues({ fields, values: partial, planRows: plan.rows, currentYear: CURRENT_YEAR, sourceYear: 2025 });
  assert.ok(leftoverPartial.rows.some((row) => row.fieldId === plan.rows[0].fieldId));

  // 3단계 배지 — 바꾼 칸은 교체, 남은 칸은 잔존
  const classified = classifyCarryover({ planRows: plan.rows, leftover: leftoverPartial, values: partial });
  assert.equal(classified.byId[plan.rows[0].fieldId].status, "leftover");
  assert.equal(classified.byId[plan.rows[0].fieldId].label, CARRYOVER_LEFTOVER_LABEL);
  const replacedId = plan.rows.find((row) => partial[row.fieldId]).fieldId;
  assert.equal(classified.byId[replacedId].status, "replaced");
  assert.equal(classified.byId[replacedId].label, CARRYOVER_REPLACED_LABEL);
});

test("전년도 흔적은 지난해 연도·날짜로 잡고, 금액·인원은 확인 대상으로만 세운다", () => {
  const strong = previousYearSignals("2025년 3월 ~ 11월 운영", { currentYear: 2026 });
  assert.equal(strong.hasPreviousYear, true);
  assert.deepEqual(strong.years, [2025]);

  const mixed = previousYearSignals("2026년 예산 4,800만원 · 참석 156명", { currentYear: 2026 });
  assert.equal(mixed.hasPreviousYear, false);
  assert.equal(mixed.hasValueSignals, true);
  assert.ok(mixed.weak.some((item) => item.kind === "amount"));

  const current = previousYearSignals("2026년 3월 ~ 11월", { currentYear: 2026 });
  assert.equal(current.hasPreviousYear, false);
});

/* ────────────────────────── ③ .hwpx 안에서 전년도 값 갈아끼우기 ────────────────────────── */

function reportXml(rows) {
  const cells = rows.map((row, rowIndex) => `<hp:tr>${row.map((cell, colIndex) => {
    return `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
      + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
      + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${cell}</hp:t></hp:run></hp:p></hp:subList>`
      + `<hp:cellAddr colAddr="${colIndex}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
      + `<hp:cellSz width="1000" height="500"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
  }).join("")}</hp:tr>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">`
    + `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17"><hp:tbl id="1" rowCnt="${rows.length}" colCnt="2" cellSpacing="0" borderFillIDRef="1">`
    + `<hp:sz width="1000" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>${cells}</hp:tbl></hp:run></hp:p></hs:sec>`;
}

test("양식 이yang 모드에서 전년도 값이 적힌 칸만 정확히 갈아끼운다", () => {
  const xml = reportXml([
    ["구분", "내용"],
    ["사업기간", "2025년 3월 ~ 11월"],
    ["주요 내용", "작년에 적어 둔 다른 내용"],
    ["담당자", ""]
  ]);
  const values = { 사업기간: "2026년 3월 ~ 11월" };
  const key = normalizeFormLabel("사업기간");
  const overwrites = { [key]: ["2025년 3월 ~ 11월"] };

  // 이양 모드 — 같은 글자로 짚인 칸만 바뀐다
  const result = patchSectionXml(xml, values, { overwrites });
  assert.ok(result.changed);
  assert.ok(result.xml.includes("2026년 3월 ~ 11월"));
  assert.ok(!result.xml.includes("2025년 3월 ~ 11월"));
  assert.ok(result.xml.includes("작년에 적어 둔 다른 내용"), "짚이지 않은 칸은 그대로");
  assert.equal(result.filled[0].replaced, "2025년 3월 ~ 11월");

  // 이양이 아니면 원본 값을 덮지 않는다 — 기존 안전 규칙 유지
  const plain = patchSectionXml(xml, values);
  assert.equal(plain.changed, false);
  assert.ok(plain.xml.includes("2025년 3월 ~ 11월"));

  // 글자가 다르면(사람이 이미 고친 칸) 갈아끼우지 않는다
  const guarded = patchSectionXml(xml, values, { overwrites: { [key]: ["다른 글자"] } });
  assert.ok(guarded.xml.includes("2025년 3월 ~ 11월"));
});

test("내려받은 .hwpx 전체에서 전년도 값을 갈아끼우고 kordoc validate 를 통과하는 수준의 ZIP 을 만든다", async () => {
  const bytes = await filledPlanHwpx({
    사업명: "2025 양양 서핑 청년 마을 만들기",
    사업기간: "2025년 3월 ~ 11월"
  });
  const blocks = await readHwpxBlocks(await JSZip.loadAsync(bytes));
  const schema = parseSampleTemplate({ blocks, fileName: "2025-결과보고서.hwpx", format: "hwpx" });
  const fields = extractFormFields(schema);
  const plan = buildCarryoverPlan({ fields, currentYear: CURRENT_YEAR, sourceYear: 2025 });
  // 패처는 라벨 키 값을 받는다 — 3단계에서 채운 값을 kordoc fill 키로 바꾼 모양 그대로.
  const values = {};
  for (const row of plan.rows) values[row.fillKey || row.label] = row.value.replaceAll("2025", "2026");
  const overwrites = carryoverOverwriteMap({ planRows: plan.rows, values: Object.fromEntries(plan.rows.map((row) => [row.fieldId, values[row.fillKey || row.label]])) });

  const result = await patchHwpxBytes({ bytes, values, overwrites });
  assert.ok(result.changed);
  assert.ok(result.filled.some((item) => item.replaced));

  const out = await JSZip.loadAsync(result.bytes);
  const sectionXml = await out.file("Contents/section0.xml").async("text");
  assert.ok(sectionXml.includes("2026"));
  assert.ok(!sectionXml.includes("2025"));
});

/* ────────────────────────── ④ 출석·지출·사진 재료 ────────────────────────── */

test("출석현황 CSV를 읽어 참석 인원 합계를 재료 줄로 만든다", () => {
  const parsed = parseSpreadsheetMaterial("일자,참석인원,활동\n2026-03-02,18,창업 기초 강좌\n2026-03-16,22,마을홀 대토론\n2026-04-06,17,서핑 안전 교육");
  assert.equal(parsed.kind, "attendance");
  assert.equal(parsed.total, 57);
  assert.ok(parsed.line.includes("총 57명"));
  assert.ok(parsed.line.includes("회차 3회"));
});

test("지출내역 TSV·CSV를 읽어 집행액과 비목별 금액을 재료 줄로 만든다", () => {
  const tsv = parseSpreadsheetMaterial("적요\t금액\t비목\n강사비 이체\t1200000\t인건비\n간식 구매\t180000\t운영비\n홍보물 인쇄\t320000\t홍보비");
  assert.equal(tsv.kind, "expense");
  assert.equal(tsv.total, 1700000);
  assert.ok(tsv.line.includes("총 1,700,000원"));
  assert.ok(tsv.line.includes("인건비 1,200,000원"));

  const csv = parseSpreadsheetMaterial("내역,금액\n간식,90000\n홍보물,50000");
  assert.equal(csv.kind, "expense");
  assert.equal(csv.total, 140000);
});

test("머리글이 없는 표는 순서로 읽고 무엇을 가정했는지 밝힌다", () => {
  const parsed = parseSpreadsheetMaterial("3/2\t10\n3/9\t12");
  assert.equal(parsed.rows, 2);
  assert.ok(parsed.warnings.some((warning) => warning.includes("머리글")));
});

test("활동사진 파일 이름에서 날짜·활동 내용 캡션을 만들고, 못 만든 파일은 밝힌다", () => {
  assert.equal(dateFromPhotoName("IMG_20260302_1412.jpg"), "2026-03-02");
  assert.equal(dateFromPhotoName("2026-03-16_마을홀_대토론.png"), "2026-03-16");
  assert.ok(titleFromPhotoName("2026-03-16_마을홀_대토론.png").includes("마을홀"));

  const result = photoCaptions([
    { name: "IMG_20260302_1412.jpg" },
    { name: "2026-03-16_마을홀_대토론.png" },
    { name: "DSC04231.jpg" }
  ]);
  assert.equal(result.lines.length, 3);
  assert.ok(result.text.includes("■ 활동사진 증빙"));
  assert.ok(result.lines[1].caption.includes("마을홀"));
  assert.ok(result.warnings.some((warning) => warning.includes("DSC04231")));
});

/* ────────────────────────── ⑤ 사전 점검 연동 ────────────────────────── */

test("다운로드 전 사전 점검에 전년도 값 잔존 항목을 눈에 띄게 올린다", async () => {
  const { schema } = await filledReportFields();
  const fields = extractFormFields(schema);
  const plan = buildCarryoverPlan({ fields, currentYear: CURRENT_YEAR, sourceYear: 2025 });
  const values = {};
  for (const row of plan.rows) values[row.fieldId] = row.value.replaceAll("2025", "2026");
  const partial = { ...values };
  delete partial[plan.rows[0].fieldId];
  const leftover = findLeftoverYearValues({ fields, values: partial, planRows: plan.rows, currentYear: CURRENT_YEAR, sourceYear: 2025 });

  const preflight = buildDownloadPreflight({
    fields,
    values: partial,
    schema,
    hasFile: true,
    carryover: { plan, leftover }
  });
  const item = preflight.items.find((entry) => entry.id === "carryover-leftover");
  assert.ok(item, "잔존 항목이 있어야 한다");
  assert.equal(item.level, "manual");
  assert.ok(item.title.includes(CARRYOVER_LEFTOVER_LABEL));

  // 이양을 끄면 항목이 없다
  const plain = buildDownloadPreflight({ fields, values: partial, schema, hasFile: true });
  assert.ok(!plain.items.some((entry) => entry.id === "carryover-leftover"));
});
