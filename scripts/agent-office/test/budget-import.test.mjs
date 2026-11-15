import test from "node:test";
import assert from "node:assert/strict";
import {
  BUDGET_IMPORT_SAMPLE,
  budgetLinesToTsv,
  detectDelimiter,
  mapHeaderRow,
  mergeBudgetLines,
  parseBudgetTable
} from "../../../src/lib/budgetImport.mjs";
import { lineAmount } from "../../../src/lib/grantWorkflow.mjs";

test("구글 시트에서 복사한 탭 구분 표를 예산 행으로 읽는다", () => {
  const text = [
    "비목\t세목\t단가\t수량\t산출근거\t비고",
    "인건비\t외래강사비\t250,000\t8\t250,000원 × 8회\t두레동아리 4회 × 2명",
    "사업비\t행사 운영비\t1,200,000\t1\t1,200,000원 × 1식\t체험 부스"
  ].join("\n");

  const result = parseBudgetTable(text);
  assert.equal(result.hadHeader, true);
  assert.equal(result.delimiter, "\t");
  assert.equal(result.lineCount, 2);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(
    result.rows.map((row) => [row.category, row.item, row.unitCost, row.quantity, row.basis, row.note]),
    [
      ["인건비", "외래강사비", "250000", "8", "250,000원 × 8회", "두레동아리 4회 × 2명"],
      ["사업비", "행사 운영비", "1200000", "1", "1,200,000원 × 1식", "체험 부스"]
    ]
  );
  assert.equal(result.totalAmount, 250000 * 8 + 1200000);
});

test("머리글 순서가 달라도 열 이름으로 찾는다", () => {
  const text = [
    "세목,비목,수량,단가,비고",
    "현수막,홍보비,3,80000,동네 인쇄소"
  ].join("\n");
  const { rows } = parseBudgetTable(text);
  assert.equal(rows[0].category, "홍보비");
  assert.equal(rows[0].item, "현수막");
  assert.equal(rows[0].unitCost, "80000");
  assert.equal(lineAmount(rows[0]), 240000);
});

test("금액 열이 있으면 단가·수량과 비교해 다른 줄만 알린다", () => {
  const text = [
    "비목\t세목\t단가\t수량\t금액",
    "인건비\t강사비\t200,000\t4\t800,000",
    "운영비\t간식비\t10,000\t5\t60,000"
  ].join("\n");
  const result = parseBudgetTable(text);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].unitCost, "10000");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /금액 60,000원/);
  assert.match(result.warnings[0], /단가×수량 50,000원/);
});

test("금액만 있는 줄은 금액을 단가로, 수량을 1로 채운다", () => {
  const text = ["비목\t세목\t금액", "사업비\t버스 임차\t600,000"].join("\n");
  const { rows } = parseBudgetTable(text);
  assert.equal(rows[0].unitCost, "600000");
  assert.equal(rows[0].quantity, "1");
  assert.equal(lineAmount(rows[0]), 600000);
});

test("머리글이 없으면 정해진 순서로 읽고 그 사실을 알린다", () => {
  const text = ["인건비\t강사비\t250,000\t8회\t250,000원 × 8회\t-"].join("\n");
  const result = parseBudgetTable(text);
  assert.equal(result.hadHeader, false);
  assert.equal(result.rows[0].quantity, "8회");
  assert.equal(lineAmount(result.rows[0]), 2000000);
  assert.ok(result.warnings.some((warning) => warning.includes("머리글이 없어")));
});

test("합계 행은 넣지 않고 건너뛴 사실을 남긴다", () => {
  const text = [
    "비목\t세목\t단가\t수량",
    "인건비\t강사비\t100,000\t2",
    "합계\t\t\t"
  ].join("\n");
  const result = parseBudgetTable(text);
  assert.equal(result.lineCount, 1);
  assert.ok(result.warnings.some((warning) => warning.includes("합계 행")));
});

test("Markdown 표와 따옴표가 든 CSV도 읽는다", () => {
  const markdown = ["| 비목 | 세목 | 단가 | 수량 |", "| --- | --- | --- | --- |", "| 홍보비 | 현수막 | 80,000 | 3 |"].join("\n");
  const fromMarkdown = parseBudgetTable(markdown);
  assert.equal(fromMarkdown.lineCount, 1);
  assert.equal(fromMarkdown.rows[0].item, "현수막");

  const csv = ['비목,세목,단가,수량,비고', '사업비,"체험 부스, 운영",300000,2,"현장, 우천 대비"'].join("\r\n");
  const fromCsv = parseBudgetTable(csv);
  assert.equal(fromCsv.rows[0].item, "체험 부스, 운영");
  assert.equal(fromCsv.rows[0].note, "현장, 우천 대비");
});

test("만원 표기와 원·쉼표가 섞인 금액을 같은 값으로 읽는다", () => {
  const text = ["비목\t세목\t단가\t수량", "운영비\t다과비\t5만원\t4", "운영비\t인쇄비\t₩120,000\t2"].join("\n");
  const { rows } = parseBudgetTable(text);
  assert.equal(lineAmount(rows[0]), 200000);
  assert.equal(lineAmount(rows[1]), 240000);
});

test("빈 입력·예산 행 없음은 이유와 함께 빈 결과로 돌려준다", () => {
  assert.equal(parseBudgetTable("").lineCount, 0);
  assert.match(parseBudgetTable("   ").warnings[0], /비어 있습니다/);

  const noRows = parseBudgetTable(["비목\t세목\t단가\t수량", "\t\t100000\t2"].join("\n"));
  assert.equal(noRows.lineCount, 0);
  assert.ok(noRows.warnings.some((warning) => warning.includes("비목·세목이 없어")));
});

test("머리글 판정은 이름 2개 이상이 맞아야 한다", () => {
  assert.equal(mapHeaderRow(["비목", "세목", "단가", "수량"]).category, 0);
  assert.equal(mapHeaderRow(["가", "나", "다"]), null);
  assert.equal(detectDelimiter("a,b,c"), ",");
  assert.equal(detectDelimiter("a\tb"), "\t");
  assert.equal(detectDelimiter("| a | b |"), "|");
});

test("덧붙이기·바꾸기·합치기가 기존 행을 지키거나 교체한다", () => {
  const existing = [{ id: "line-1", category: "인건비", item: "강사비", unitCost: "100000", quantity: "2", basis: "", note: "" }];
  const { rows } = parseBudgetTable(["비목\t세목\t단가\t수량", "인건비\t강사비\t150000\t3", "홍보비\t현수막\t80000\t2"].join("\n"));

  const appended = mergeBudgetLines(existing, rows, "append");
  assert.equal(appended.length, 3);
  assert.equal(appended[0].id, "line-1");
  assert.ok(appended.slice(1).every((line) => line.id.startsWith("import-")));

  const replaced = mergeBudgetLines(existing, rows, "replace");
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0].unitCost, "150000");

  const merged = mergeBudgetLines(existing, rows, "merge");
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, "line-1");
  assert.equal(merged[0].unitCost, "150000");
  assert.equal(merged[1].item, "현수막");
});

test("견본 표는 그대로 다시 읽힌다", () => {
  const parsed = parseBudgetTable(BUDGET_IMPORT_SAMPLE);
  assert.ok(parsed.lineCount >= 3);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.rows[0].item, "외래강사비");
  const tsv = budgetLinesToTsv(parsed.rows);
  assert.equal(parseBudgetTable(tsv).lineCount, parsed.lineCount);
});
