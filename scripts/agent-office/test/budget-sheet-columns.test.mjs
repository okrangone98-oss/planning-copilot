import test from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_SHEET_COLUMNS,
  budgetDocumentTable,
  applyBlockPaste,
  sheetExportRows,
  sheetRows,
  sheetToTsv,
  sheetTotals
} from "../../../src/lib/budgetSheet.mjs";
import {
  DEFAULT_BUDGET_COLUMNS,
  cellValueOf,
  columnTotalOf,
  columnsForStorage,
  createBudgetColumn,
  isCustomizedColumn,
  normalizeBudgetColumns
} from "../../../src/lib/budgetColumns.mjs";
import { mapHeaderRow, mergeBudgetLines, parseBudgetTable } from "../../../src/lib/budgetImport.mjs";
import { createEmptyGrantPlan, sanitizeGrantPlan } from "../../../src/lib/grantWorkflow.mjs";
import { buildBudgetDigestText, buildProjectDataText } from "../../../src/lib/projectDataReuse.mjs";
import { buildReportDocument, renderReportBodyXml } from "../../../src/lib/reportHwpx.mjs";
import { createEmptyProjectWork } from "../../../src/lib/projectOperations.mjs";
import { matchBudgetHeader, patchSectionXml } from "../../../src/lib/browserHwpxFiller.mjs";

/* ── 공통 자료 ─────────────────────────────────────────────── */

function line(id, category, item, unitCost, quantity, extra = {}) {
  return { id, category, item, unitCost, quantity, basis: "", note: "", ...extra };
}

/** 국비·지방비 열을 더하고 산출근거 이름을 바꾼 표 — 요청의 대표 사용례. */
function customColumns() {
  const base = normalizeBudgetColumns(null);
  const gukbi = createBudgetColumn({ label: "국비", numeric: true }, base);
  const jibang = createBudgetColumn({ label: "지방비", numeric: true }, [...base, gukbi]);
  return base.map((column) => (column.role === "basis" ? { ...column, label: "산출내역" } : column)).concat([gukbi, jibang]);
}

const LINES = [
  line("b1", "인건비", "외래강사비", "250000", "8", { basis: "250,000원 × 8회", custom: { "col-1": "1400000", "col-2": "400000" } }),
  line("b2", "운영비", "재료비", "100000", "2", { basis: "100,000원 × 2회", custom: { "col-1": "60000", "col-2": "0" } })
];

function makePlan(overrides = {}) {
  return {
    ...createEmptyGrantPlan(),
    programName: "2027 양양 관광두레 플러스",
    agency: "양양군농촌활성화지원센터",
    fundingYear: "2027",
    budgetLines: LINES,
    ...overrides
  };
}

/* ── 열 정의 ──────────────────────────────────────────────── */

test("열 정의가 없으면 기본 열(비목·세목·단가·수량·편성액·집행액·잔액·산출근거·비고)을 쓴다", () => {
  const columns = normalizeBudgetColumns(null);
  assert.deepEqual(columns.map((column) => column.label), BUDGET_SHEET_COLUMNS.map((column) => column.label));
  assert.deepEqual(columns.map((column) => column.role), ["category", "item", "unitPrice", "qty", "budget", "spent", "balance", "basis", "note"]);
  assert.equal(columns.every((column) => column.id === column.role), true, "기본 열 id 는 역할과 같다");
});

test("머리글 이름을 바꾸면 이름만 바뀌고 역할·계산은 그대로다", () => {
  const renamed = normalizeBudgetColumns(DEFAULT_BUDGET_COLUMNS.map((column) => (
    column.role === "item" ? { ...column, label: "세부사업명" } : column
  )));
  const item = renamed.find((column) => column.role === "item");
  assert.equal(item.label, "세부사업명");
  assert.equal(item.key, "item");
  assert.equal(isCustomizedColumn(item), true);
  assert.equal(isCustomizedColumn(renamed.find((column) => column.role === "category")), false);

  // 표 계산은 이름과 무관하게 같은 값에서 나온다.
  const rows = sheetRows({ lines: LINES });
  assert.equal(cellValueOf(rows[0], item), "외래강사비");
});

test("같은 역할의 열은 하나만 남기고, 빈 이름은 기본 이름으로 되돌린다", () => {
  const columns = normalizeBudgetColumns([
    { id: "a", role: "category", label: "비목" },
    { id: "b", role: "category", label: "비목2" },
    { id: "c", role: "item", label: "   " }
  ]);
  assert.equal(columns.filter((column) => column.role === "category").length, 1);
  assert.equal(columns.find((column) => column.role === "item").label, "세목");
});

test("새 열은 겹치지 않는 id 와 이름을 받고, 숫자 열로 만들 수 있다", () => {
  const base = normalizeBudgetColumns(null);
  const one = createBudgetColumn({ label: "국비", numeric: true }, base);
  const two = createBudgetColumn({ label: "국비", numeric: false }, [...base, one]);
  assert.equal(one.role, "custom");
  assert.equal(one.kind, "number");
  assert.notEqual(one.id, two.id);
  assert.notEqual(one.label, two.label);
  assert.equal(two.kind, "text");
});

/* ── 합계 ─────────────────────────────────────────────────── */

test("사용자가 더한 숫자 열(국비·지방비)은 표 아래에 열 합계로 더해진다", () => {
  const columns = customColumns();
  const rows = sheetRows({ lines: LINES });
  const totals = sheetTotals(rows, columns);
  assert.equal(totals.plan, 2200000);
  assert.deepEqual(totals.columnTotals["col-1"], 1460000);
  assert.deepEqual(totals.columnTotals["col-2"], 400000);
  // 적힌 0 은 0으로 세고, 아예 비어 있는 열은 null(0원과 구분).
  assert.equal(columnTotalOf([{ custom: {} }], columns.find((column) => column.id === "col-2")), null);
});

/* ── 내려받기·붙여넣기·불러오기 ──────────────────────────── */

test("CSV·XLSX 내려받기 머리글은 사용자가 바꾼 이름이고, 사용자 열 값도 함께 나간다", () => {
  const columns = customColumns();
  const table = sheetExportRows({ lines: LINES, columns });
  assert.deepEqual(table[0], ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출내역", "비고", "국비", "지방비"]);
  assert.equal(table[1][7], "250,000원 × 8회", "이름을 바꾼 산출내역 열에 근거가 들어간다");
  assert.deepEqual(table[1].slice(-2), ["1400000", "400000"]);
  assert.equal(sheetToTsv({ lines: LINES, columns }).split("\n")[0].split("\t")[7], "산출내역");
});

test("표를 다시 붙여넣으면 사용자 열 이름으로 맞춰 그 열에 값이 들어간다", () => {
  const columns = customColumns();
  const pasted = [
    ["비목", "세목", "산출내역", "국비", "지방비"],
    ["인건비", "강사비", "200,000원 × 4회", "560,000", "240,000"]
  ];
  const parsed = parseBudgetTable(pasted.map((row) => row.join("\t")).join("\n"), { columns });
  assert.equal(parsed.hadHeader, true);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].category, "인건비");
  assert.equal(parsed.rows[0].item, "강사비");
  assert.equal(parsed.rows[0].basis, "200,000원 × 4회");
  assert.deepEqual(parsed.rows[0].custom, { "col-1": "560,000", "col-2": "240,000" });

  const merged = mergeBudgetLines([], parsed.rows, "append");
  assert.deepEqual(merged[0].custom, { "col-1": "560,000", "col-2": "240,000" });
});

test("머리글이 없어도 표에 있는 열 순서대로 읽어 사용자 열까지 채운다", () => {
  const columns = customColumns();
  const row = ["인건비", "강사비", "250,000", "8", "2000000", "", "", "250,000원 × 8회", "", "1400000", "400000"];
  const parsed = parseBudgetTable(row.join("\t"), { columns });
  assert.equal(parsed.hadHeader, false);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].item, "강사비");
  assert.equal(parsed.rows[0].basis, "250,000원 × 8회");
  assert.deepEqual(parsed.rows[0].custom, { "col-1": "1400000", "col-2": "400000" });
});

test("열을 지운 뒤에도 적어 둔 값은 남아 있고, 다시 더하면 그대로 보인다", () => {
  const columns = customColumns();
  const without = columns.filter((column) => column.id !== "col-2");
  const exported = sheetExportRows({ lines: LINES, columns: without });
  assert.equal(exported[0].includes("지방비"), false);
  assert.equal(exported[1].slice(-1)[0], "1400000");
  // 데이터는 예산 행에 그대로 남는다.
  assert.equal(LINES[0].custom["col-2"], "400000");
  const back = sheetExportRows({ lines: LINES, columns });
  assert.equal(back[0].includes("지방비"), true);
});

test("엑셀 붙여넣기는 사용자 열 자리에 값을 넣고, 이름을 바꾼 열은 역할로 받는다", () => {
  const columns = customColumns();
  const result = applyBlockPaste({
    lines: [line("b1", "", "", "", "")],
    columns,
    startRow: 0,
    startColumn: 0,
    block: [["인건비", "강사비", "250000", "2", "", "", "", "200,000원 × 2회", "", "1,120,000", "480,000"]]
  });
  const next = result.lines[0];
  assert.equal(next.category, "인건비");
  assert.equal(next.item, "강사비");
  assert.equal(next.unitCost, "250000");
  assert.equal(next.quantity, "2");
  assert.equal(next.basis, "200,000원 × 2회");
  assert.equal(next.custom["col-1"], "1,120,000");
  assert.equal(next.custom["col-2"], "480,000");
  assert.equal(result.cells, 7);
});

test("양식 머리글 별칭으로도 열을 맞춘다 — 양식이 ‘산출내역’이라 적어도 산출근거 열에 들어간다", () => {
  const columns = normalizeBudgetColumns(null);
  const cells = [
    { text: "비목", colAddr: 0 },
    { text: "세목", colAddr: 1 },
    { text: "산출내역", colAddr: 2 },
    { text: "계획액", colAddr: 3 }
  ];
  const matches = matchBudgetHeader(cells, columns);
  assert.deepEqual(matches.map((match) => match.column.role), ["category", "item", "basis", "budget"]);
});

/* ── 저장(사업별) ─────────────────────────────────────────── */

test("바꾼 열과 사용자 열의 칸 값이 사업 저장에 남는다", () => {
  const plan = makePlan({ budgetColumns: columnsForStorage(customColumns()) });
  const saved = sanitizeGrantPlan(JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(saved.budgetColumns.map((column) => column.label), ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출내역", "비고", "국비", "지방비"]);
  assert.deepEqual(saved.budgetLines[0].custom, { "col-1": "1400000", "col-2": "400000" });
  assert.equal(saved.budgetLines[1].custom["col-1"], "60000");
  // 다시 불러도 같은 표로 그려진다.
  assert.equal(sheetExportRows({ lines: saved.budgetLines, columns: saved.budgetColumns })[0][9], "국비");
});

test("저장된 값에 모르는 필드·너무 긴 값이 섞여도 표가 깨지지 않는다", () => {
  const saved = sanitizeGrantPlan({
    budgetColumns: [{ id: "", role: "custom", label: "가".repeat(80), kind: "number" }, { role: "category", label: "비목" }],
    budgetLines: [{ id: "b1", category: "인건비", custom: { ["col-" + "9".repeat(60)]: "가".repeat(400), "": "x" } }]
  });
  assert.equal(saved.budgetColumns.length, 2);
  assert.ok(saved.budgetColumns[0].label.length <= 24);
  assert.ok(String(saved.budgetColumns[0].id).length > 0);
  assert.equal(Object.values(saved.budgetLines[0].custom).every((value) => value.length <= 200), true);
});

/* ── 서류 연동 ────────────────────────────────────────────── */

test("예산 관리표 글(2단계 붙여넣기)에 바꾼 머리글과 사용자 열이 그 이름으로 들어간다", () => {
  const plan = makePlan({ budgetColumns: columnsForStorage(customColumns()) });
  const work = createEmptyProjectWork("p1");
  const digest = buildBudgetDigestText({ plan, work });
  assert.match(digest.text, /산출내역: 250,000원 × 8회/);
  assert.match(digest.text, /국비: 1,400,000/);
  assert.match(digest.text, /국비: 60,000/);
  assert.match(digest.text, /지방비: 400,000/);
  assert.doesNotMatch(digest.text, /산출근거:/);
  // 행 순서대로 두 줄이 나온다(양식이 배열 값을 행마다 받는다).
  assert.equal(digest.text.match(/^국비: /gm).length, 2);
});

test("이름을 바꾸지 않은 기본 표의 글은 예전 그대로 둔다(불필요한 줄을 늘리지 않는다)", () => {
  const plan = makePlan();
  const digest = buildBudgetDigestText({ plan, work: createEmptyProjectWork("p1") });
  assert.doesNotMatch(digest.text, /^비목: /m);
  assert.match(digest.text, /인건비: 외래강사비/);
});

test("사업 데이터 글의 소요 예산 줄에도 사용자 열의 머리글과 값이 함께 적힌다", () => {
  const plan = makePlan({ budgetColumns: columnsForStorage(customColumns()) });
  const text = buildProjectDataText({ meta: { name: "관광두레" }, plan, work: createEmptyProjectWork("p1"), project: {} });
  assert.match(text.text, /국비 1,400,000/);
  assert.match(text.text, /지방비 400,000/);
});

test("결과보고 .hwpx 예산 표는 바꾼 머리글과 사용자 열로 만든다", () => {
  const plan = makePlan({ budgetColumns: columnsForStorage(customColumns()) });
  const document = buildReportDocument({ plan, work: createEmptyProjectWork("p1"), project: { projectName: "관광두레" } });
  assert.deepEqual(document.budget.headers, ["비목", "세목", "단가", "수량", "편성액", "집행액", "잔액", "산출내역", "비고", "국비", "지방비"]);
  const instructor = document.budget.rows.find((row) => row[1] === "외래강사비");
  assert.equal(instructor[4], "2,000,000", "편성액은 계산값 그대로");
  assert.equal(instructor[9], "1,400,000");
  assert.equal(instructor[10], "400,000");
  assert.equal(document.budget.total[9], "1,460,000");

  const xml = renderReportBodyXml(document);
  assert.match(xml, /국비/);
  assert.match(xml, /1,460,000/);

  // 기본 표는 결과보고에 맞춘 다섯 칸 그대로.
  const plain = buildReportDocument({ plan: makePlan(), work: createEmptyProjectWork("p1"), project: {} });
  assert.deepEqual(plain.budget.headers, ["비목", "세목", "산출 근거", "계획(원)"]);
});

test("예산 표 모델은 서류·화면·시트가 같은 값에서 나온다", () => {
  const plan = makePlan({ budgetColumns: columnsForStorage(customColumns()) });
  const table = budgetDocumentTable({ plan, work: createEmptyProjectWork("p1") });
  const rows = sheetRows({ lines: plan.budgetLines });
  assert.equal(table.rows[0][4], String(rows[0].amount));
  assert.equal(table.total[4], String(sheetTotals(rows, table.columns).plan));
  assert.deepEqual(table.numeric.slice(0, 5), [false, false, true, true, true]);
});

/* ── .hwpx 양식 채우기 ───────────────────────────────────── */

/** 머리글 + 빈 행으로 된 예산 표 하나를 가진 최소 본문. */
function budgetSection(headerCells, dataRows) {
  const rows = [headerCells, ...dataRows];
  const cells = rows.map((row, rowIndex) => `<hp:tr>${row.map((cell, colIndex) => `<hp:tc name="" header="0" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="12">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">`
    + `<hp:p paraPrIDRef="9" styleIDRef="0"><hp:run charPrIDRef="17"><hp:t>${cell}</hp:t></hp:run></hp:p></hp:subList>`
    + `<hp:cellAddr colAddr="${colIndex}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
    + `<hp:cellSz width="1000" height="500"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`).join("")}</hp:tr>`).join("");
  const table = `<hp:tbl id="1" rowCnt="${rows.length}" colCnt="${headerCells.length}" cellSpacing="0" borderFillIDRef="1">`
    + `<hp:sz width="6000" widthRelTo="ABSOLUTE" height="1000" heightRelTo="ABSOLUTE" protect="0"/>${cells}</hp:tbl>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">`
    + `<hp:p paraPrIDRef="10" styleIDRef="0"><hp:run charPrIDRef="17">${table}</hp:run></hp:p></hs:sec>`;
}

function textsOf(xml) {
  return Array.from(String(xml).matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)).map((match) => match[1]);
}

test("양식의 예산 표 머리글이 사용자의 열 이름과 같으면 행 순서대로 칸을 채운다", () => {
  const columns = customColumns();
  const xml = budgetSection(
    ["비목", "세목", "산출내역", "국비", "지방비"],
    [["", "", "", "", ""], ["", "", "", "", ""]]
  );
  const result = patchSectionXml(xml, {}, {
    budgetSheet: {
      columns,
      // 행 값은 예산 관리표의 열 순서 그대로(비목·세목·단가·수량·편성액·집행액·잔액·산출내역·비고·국비·지방비)
      rows: [
        ["인건비", "외래강사비", "250000", "8", "2000000", "0", "2000000", "250,000원 × 8회", "", "1,400,000", "400,000"],
        ["운영비", "재료비", "100000", "2", "200000", "0", "200000", "100,000원 × 2회", "", "60,000", "0"]
      ]
    }
  });
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("인건비"));
  assert.ok(texts.includes("외래강사비"));
  assert.ok(texts.includes("1,400,000"));
  assert.ok(texts.includes("운영비"));
  assert.ok(texts.includes("60,000"));
  assert.equal(result.filled.filter((item) => item.kind === "budget").length, 10);
});

test("양식이 쓰는 다른 머리글(산출내역·계획액)도 역할로 맞춰 채운다", () => {
  const columns = normalizeBudgetColumns(null);
  const xml = budgetSection(["비목", "세목", "산출내역", "계획액"], [["", "", "", ""]]);
  const result = patchSectionXml(xml, {}, {
    budgetSheet: {
      columns,
      rows: [["인건비", "외래강사비", "250000", "8", "2,000,000", "", "", "250,000원 × 8회", ""]]
    }
  });
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("인건비"));
  assert.ok(texts.includes("250,000원 × 8회"));
  assert.ok(texts.includes("2,000,000"));
});

test("양식 표에 이미 적힌 값은 예산표 값으로 덮지 않는다", () => {
  const columns = normalizeBudgetColumns(null);
  const xml = budgetSection(["비목", "세목", "산출내역", "계획액"], [["인건비", "작년 강사비", "작년 근거", "900,000"]]);
  const result = patchSectionXml(xml, {}, {
    budgetSheet: { columns, rows: [["인건비", "올해 강사비", "250000", "8", "2,000,000", "", "", "올해 근거", ""]] }
  });
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("작년 강사비"), "이미 적힌 칸은 그대로 둔다");
  assert.equal(result.filled.filter((item) => item.kind === "budget").length, 0);
  assert.ok(result.skipped.length >= 1);
});

test("금액 열이 없는 ‘비목|내용’ 모양의 라벨 표는 예산 표로 보지 않는다", () => {
  // 연습 양식·기관 양식의 ‘비목 | 내용’ 섹션 표를 예산 표로 오인하면 사업명·수행기관 값 칸을 덮어 버린다.
  const columns = normalizeBudgetColumns(null);
  const xml = budgetSection(["비목", "내용"], [["사업명", ""], ["수행기관", ""]]);
  const result = patchSectionXml(xml, {}, {
    budgetSheet: { columns, rows: [["인건비", "외래강사비", "250000", "8", "2000000", "", "", "근거", ""]] }
  });
  assert.equal(result.filled.filter((item) => item.kind === "budget").length, 0);
  assert.deepEqual(textsOf(result.xml).filter((text) => text === "외래강사비"), []);
});

test("예산표 값이 없으면 양식 표를 건드리지 않는다", () => {
  const xml = budgetSection(["비목", "세목"], [["", ""]]);
  const result = patchSectionXml(xml, { 사업명: "관광두레" }, { budgetSheet: { columns: normalizeBudgetColumns(null), rows: [] } });
  assert.equal(result.filled.filter((item) => item.kind === "budget").length, 0);
});

test("머리글이 하나만 맞으면 예산표 채우기를 하지 않는다(엉뚱한 표를 건드리지 않게)", () => {
  const columns = normalizeBudgetColumns(null);
  const matches = matchBudgetHeader([{ text: "비목", colAddr: 0 }, { text: "성명", colAddr: 1 }], columns);
  assert.equal(matches.length, 1);
  const xml = budgetSection(["비목", "성명"], [["", ""]]);
  const result = patchSectionXml(xml, {}, { budgetSheet: { columns, rows: [["인건비", "", "", "", "", "", "", "", ""]] } });
  assert.equal(result.filled.filter((item) => item.kind === "budget").length, 0);
});

test("사용자 열의 숫자 열 값이 양식 금액 칸에 들어간다", () => {
  const columns = customColumns();
  const xml = budgetSection(["비목", "국비", "지방비"], [["", "", ""]]);
  const result = patchSectionXml(xml, {}, {
    budgetSheet: { columns, rows: [["인건비", "", "", "", "", "", "", "", "", "1,400,000", "400,000"]] }
  });
  const texts = textsOf(result.xml);
  assert.ok(texts.includes("인건비"));
  assert.ok(texts.includes("1,400,000"));
  assert.ok(texts.includes("400,000"));
  assert.equal(result.filled.filter((item) => item.kind === "budget").length, 3);
});

test("세목도 금액도 없는 빈 행은 예산 관리표 글에 적히지 않는다", () => {
  const plan = makePlan({ budgetLines: [...LINES, { id: "b3", category: "", item: "", unitCost: "", quantity: "", basis: "", note: "", custom: {} }] });
  const digest = buildBudgetDigestText({ plan, work: createEmptyProjectWork("p1") });
  assert.doesNotMatch(digest.text, /미분류/);
});
