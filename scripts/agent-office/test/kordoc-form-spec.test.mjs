import test from "node:test";
import assert from "node:assert/strict";
import {
  KORDOC_SPEC_VERSION,
  applyFieldValues,
  buildKordocFillCommand,
  buildKordocFillPayload,
  buildKordocFillValues,
  buildKordocPatchCommand,
  detectPlaceholders,
  extractFormFields,
  fieldTypeOf,
  findMatchingFieldKey,
  isBlankValueCell,
  isColumnHeaderRow,
  isDatePlaceholderCell,
  isFormLabelCell,
  isSubLabelBeside,
  kordocFillJsonText,
  normalizeFormLabel,
  safeShellName,
  scanInlineFieldSegments
} from "../../../src/lib/kordocFormSpec.mjs";
import { emptyTemplateSchema, extractHwpxBlocks, parseSampleTemplate } from "../../../src/lib/sampleTemplateParser.mjs";

function schemaWith({ sections = [], tables = [], slots = [] }) {
  const schema = emptyTemplateSchema("양식.hwpx");
  schema.sections = sections;
  schema.tables = tables;
  schema.slots = slots;
  return schema;
}

const BASE_SCHEMA = schemaWith({
  sections: [
    { id: "s1", rawLevel: 1, level: 1, parentId: null, title: "사업 개요", order: 1, line: 1 },
    { id: "s2", rawLevel: 1, level: 1, parentId: null, title: "추진 배경", order: 2, line: 6 }
  ],
  tables: [
    {
      id: "t1",
      order: 1,
      sectionId: "s1",
      caption: "사업 개요",
      headers: ["구분", "내용"],
      rows: [["사업명", ""], ["수행기관", ""], ["사업기간", ""], ["총사업비", ""]],
      columnCount: 2,
      rowCount: 4,
      emptyCells: 4
    },
    {
      id: "t2",
      order: 2,
      sectionId: "s2",
      caption: "추진 배경",
      headers: ["항목", "내용"],
      rows: [["지역 현황", ""], ["문제점", "청년이 떠나고 있습니다"]],
      columnCount: 2,
      rowCount: 2,
      emptyCells: 1
    }
  ],
  slots: [
    { id: "w1", kind: "guide", label: "", sectionId: "s1", sectionTitle: "사업 개요", preview: "※ 사업명은 공고문과 같게 적습니다.", source: "text" },
    { id: "w2", kind: "blank", label: "검토 의견", sectionId: "s2", sectionTitle: "추진 배경", preview: "검토 의견: [입력]", source: "text" }
  ]
});

test("라벨·빈칸·날짜 자리표시 판정은 kordoc 규칙을 따른다", () => {
  assert.equal(isFormLabelCell("사업명"), true);
  assert.equal(isFormLabelCell("총 사업비"), true);
  assert.equal(isFormLabelCell("연락처:"), true);
  assert.equal(isFormLabelCell("Name"), true);
  assert.equal(isFormLabelCell("2027년"), false);
  assert.equal(isFormLabelCell("1억원"), false);
  assert.equal(isFormLabelCell("지역 청년이 참여합니다"), false);
  assert.equal(isFormLabelCell("성 명"), true);

  assert.equal(isBlankValueCell(""), true);
  assert.equal(isBlankValueCell("   "), true);
  assert.equal(isBlankValueCell("____"), true);
  assert.equal(isBlankValueCell("(   )"), true);
  assert.equal(isBlankValueCell("—"), true);
  assert.equal(isBlankValueCell("양양군"), false);

  assert.equal(isDatePlaceholderCell("년 월 일"), true);
  assert.equal(isDatePlaceholderCell("년 월 ~ 년 월"), true);
  assert.equal(isDatePlaceholderCell("9월 3일"), false);

  assert.equal(isSubLabelBeside(1, "성명", ""), true);
  assert.equal(isSubLabelBeside(1, "상호 또는 법인명칭", ""), false);
  assert.equal(isSubLabelBeside(2, "상호 또는 법인명칭", ""), true);
  assert.equal(isSubLabelBeside(1, "사업 내용", "이미 값"), false);

  assert.equal(isColumnHeaderRow(["구분", "내용"], ["", ""]), true);
  assert.equal(isColumnHeaderRow(["성명", "홍길동"], ["주소", "양양"]), false);
});

test("라벨은 콜론·공백을 걷어 비교하고 접두사 매칭은 60% 이상만 인정한다", () => {
  assert.equal(normalizeFormLabel(" 사 업 명 : "), "사업명");
  assert.equal(normalizeFormLabel("면적(m<sup>2</sup>)"), "면적m2");
  assert.equal(findMatchingFieldKey("사업명", new Set(["사업명", "수행기관"])), "사업명");
  assert.equal(findMatchingFieldKey("사업기간", new Set(["사업", "수행기관"])), undefined);
  assert.equal(findMatchingFieldKey("수행기관명", new Set(["수행기관"])), "수행기관");
  assert.equal(findMatchingFieldKey("대리인", new Set(["대리인성명"])), undefined);
});

test("문서에 글자로 남은 값 자리({{필드}}·[입력]·빈칸)를 찾는다", () => {
  assert.deepEqual(detectPlaceholders("사업명: {{사업명}}").map((hit) => hit.kind), ["mustache"]);
  assert.deepEqual(detectPlaceholders("검토 의견: [입력]").map((hit) => hit.kind), ["bracket"]);
  assert.equal(detectPlaceholders("검토 의견: [입력]")[0].label, "");
  assert.equal(detectPlaceholders("[붙임 1] 참고").length, 0);
  assert.equal(detectPlaceholders("사업명: ______")[0].kind, "blank");
  assert.equal(detectPlaceholders("년 월 ~ 년 월")[0].kind, "date");
  // "추진 기간: 년 월 ~ 년 월" 처럼 라벨이 붙은 줄은 인라인 라벨 분해가 값 자리를 잡는다.
  assert.equal(scanInlineFieldSegments("추진 기간: 년 월 ~ 년 월")[0].extLabel, "추진 기간");
});

test("인라인 라벨을 값 경계까지 나누고 빈 값 라벨도 돌려준다", () => {
  const segments = scanInlineFieldSegments("사업명: 양양 생활문화 / 기간: 2027. 3. ~ 11.");
  assert.deepEqual(segments.map((segment) => segment.label), ["사업명", "기간"]);
  assert.equal(segments[0].value, "양양 생활문화 /");
  assert.match(segments[1].value, /2027/);

  const empty = scanInlineFieldSegments("담당자:");
  assert.equal(empty.length, 1);
  assert.equal(empty[0].label, "담당자");
  assert.equal(empty[0].value, "");

  const spaced = scanInlineFieldSegments("성   명: 홍길동");
  assert.equal(spaced[0].label, "성명");
});

test("칸의 값 모양으로 타입을 추론한다", () => {
  assert.equal(fieldTypeOf("사업기간", ""), "date");
  assert.equal(fieldTypeOf("총사업비", ""), "amount");
  assert.equal(fieldTypeOf("담당자", "010-1234-5678"), "phone");
  assert.equal(fieldTypeOf("메일", "a@b.co"), "email");
  assert.equal(fieldTypeOf("주민등록번호", "900101-1234567"), "idnum");
  assert.equal(fieldTypeOf("사업명", "양양 생활문화"), "text");
});

test("표의 라벨|빈칸 쌍과 안내문 힌트를 칸으로 뽑는다", () => {
  const fields = extractFormFields(BASE_SCHEMA);
  assert.deepEqual(fields.map((field) => field.label), ["사업명", "수행기관", "사업기간", "총사업비", "지역 현황", "문제점", "검토 의견"]);
  const name = fields[0];
  assert.equal(name.empty, true);
  assert.equal(name.fillKey, "사업명");
  assert.equal(name.sectionTitle, "사업 개요");
  assert.equal(name.tableId, "t1");
  assert.equal(name.rowIndex, 0);
  assert.equal(name.columnIndex, 1);
  assert.match(name.hint, /공고문과 같게/);
  assert.equal(fields.find((field) => field.label === "문제점").empty, false);
  assert.equal(fields.find((field) => field.label === "검토 의견").origin, "text");
  // 머리 행("구분 | 내용")은 채우는 칸이 아니다.
  assert.equal(fields.some((field) => field.label === "구분"), false);
});

test("열 머리 표와 병합 라벨도 채울 칸으로 읽는다", () => {
  const schema = schemaWith({
    sections: [{ id: "s1", rawLevel: 1, level: 1, parentId: null, title: "추진 일정", order: 1, line: 1 }],
    tables: [
      {
        id: "t1",
        order: 1,
        sectionId: "s1",
        caption: "추진 일정",
        headers: ["단계", "기간", "내용"],
        rows: [["계획 수립", "", ""], ["실행", "", ""]],
        spans: [[[1, 1], [1, 1], [1, 1]], [[1, 1], [1, 1], [1, 1]]],
        columnCount: 3,
        rowCount: 2,
        emptyCells: 4
      }
    ],
    slots: []
  });
  const fields = extractFormFields(schema);
  assert.deepEqual(fields.map((field) => field.label), ["계획 수립 · 기간", "계획 수립 · 내용", "실행 · 기간", "실행 · 내용"]);
  // kordoc fill 키는 열 머리 이름이다 — 같은 키가 여러 칸이면 배열 값으로 순서대로 채운다.
  assert.equal(fields[0].fillKey, "기간");
  const fill = buildKordocFillValues({
    fields,
    values: { [fields[0].id]: "2027년 1월", [fields[2].id]: "2027년 3월~10월" }
  });
  assert.deepEqual(fill.values["기간"], ["2027년 1월", "2027년 3월~10월"]);
  assert.equal(fill.warnings.length, 1);
  assert.match(fill.warnings[0], /등장 순서/);
});

test("칸 값을 채우되 이미 적힌 글은 확인 전에는 건드리지 않는다", () => {
  const fields = extractFormFields(BASE_SCHEMA);
  const values = {
    [fields[0].id]: "양양 생활문화 혁신 지원사업",
    [fields[5].id]: "새로 쓴 문제점"
  };
  const kept = applyFieldValues(BASE_SCHEMA, values);
  assert.equal(kept.applied, 1);
  assert.equal(kept.schema.tables[0].rows[0][1], "양양 생활문화 혁신 지원사업");
  assert.equal(kept.schema.tables[1].rows[1][1], "청년이 떠나고 있습니다");
  assert.equal(kept.skipped.length, 1);

  const forced = applyFieldValues(BASE_SCHEMA, values, { force: true });
  assert.equal(forced.applied, 2);
  assert.equal(forced.schema.tables[1].rows[1][1], "새로 쓴 문제점");
  // 원본 스키마는 그대로 둔다.
  assert.equal(BASE_SCHEMA.tables[0].rows[0][1], "");
});

test("kordoc fill 값은 라벨 키로 묶고 빈 칸은 빼며 쉼 없는 JSON으로 만든다", () => {
  const fields = extractFormFields(BASE_SCHEMA);
  const values = { [fields[0].id]: "  양양 생활문화  ", [fields[2].id]: "2027. 3. ~ 11." };
  const fill = buildKordocFillValues({ fields, values });
  assert.deepEqual(fill.values, { "사업명": "양양 생활문화", "사업기간": "2027. 3. ~ 11." });
  assert.equal(fill.entries.length, 2);
  assert.match(fill.entries[0].where, /사업 개요/);
  assert.equal(fill.unmapped.length, fields.length - 2);

  const json = kordocFillJsonText(fill.values);
  assert.equal(JSON.parse(json)["사업명"], "양양 생활문화");

  const same = buildKordocFillValues({ fields: [fields[0], { ...fields[0], id: "x" }], values: { [fields[0].id]: "같은 값", x: "같은 값" } });
  assert.equal(same.values["사업명"], "같은 값");
  assert.equal(same.warnings.length, 0);
});

test("kordoc fill·patch 명령은 버전 고정·따옴표·-j 경유를 지킨다", () => {
  const fill = buildKordocFillCommand({ templateFile: "사업계획서 양식.hwpx", valuesFile: "채움값.json" });
  assert.equal(fill, `npx -y kordoc@${KORDOC_SPEC_VERSION} fill "사업계획서 양식.hwpx" -j "채움값.json" -o "사업계획서 양식-채움.hwpx"`);
  assert.equal(buildKordocFillCommand({ templateFile: "양식.docx" }), "");

  const patch = buildKordocPatchCommand({ templateFile: "양식.hwpx", editedFile: "채운문서.md" });
  assert.equal(patch, `npx -y kordoc@${KORDOC_SPEC_VERSION} patch "양식.hwpx" "채운문서.md" -o "양식-반영.hwpx"`);

  assert.equal(safeShellName('a/b:c*?"<>|`$d'), "a b c d");
  assert.equal(safeShellName("   ", "양식.hwpx"), "양식.hwpx");
});

test("브릿지 본문은 모드에 필요한 것만 담고 없으면 만들지 않는다", () => {
  const fill = buildKordocFillPayload({
    fileName: "양식.hwpx",
    fileBase64: "QUJD",
    values: { "사업명": "양양", "빈칸": "   " }
  });
  assert.equal(fill?.mode, "fill");
  assert.deepEqual(fill?.values, { "사업명": "양양" });
  assert.equal(fill?.outputName, "양식-채움.hwpx");

  assert.equal(buildKordocFillPayload({ fileName: "양식.hwpx", values: { a: "b" } }), null);
  assert.equal(buildKordocFillPayload({ fileName: "양식.hwpx", fileBase64: "QUJD", values: {} }), null);
  assert.equal(buildKordocFillPayload({ fileName: "양식.hwpx", fileBase64: "QUJD", mode: "patch" }), null);

  const patch = buildKordocFillPayload({ fileName: "양식.hwpx", fileBase64: "QUJD", mode: "patch", markdown: "# 문서" });
  assert.equal(patch?.mode, "patch");
  assert.equal(patch?.markdown, "# 문서");
  assert.equal(patch?.outputName, "양식-반영.hwpx");
});

test("HWPX의 1×1 틀·장 띠는 표가 아니라 문단·제목으로, 병합 칸은 좌표대로 읽는다", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2016/hwpapp">
  <hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>2027년 사업계획서</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/><hp:cellSpan colSpan="1" rowSpan="1"/></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
  <hp:p><hp:run><hp:tbl><hp:tr>
    <hp:tc><hp:subList><hp:p><hp:run><hp:t>Ⅰ</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/></hp:tc>
    <hp:tc><hp:subList><hp:p><hp:run><hp:t/></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/></hp:tc>
    <hp:tc><hp:subList><hp:p><hp:run><hp:t>사업 개요</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="2" rowAddr="0"/></hp:tc>
  </hp:tr></hp:tbl></hp:run></hp:p>
  <hp:p><hp:run><hp:tbl>
    <hp:tr>
      <hp:tc><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/></hp:tc>
      <hp:tc><hp:subList><hp:p><hp:run><hp:t>내용</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/></hp:tc>
    </hp:tr>
    <hp:tr>
      <hp:tc><hp:subList><hp:p><hp:run><hp:t>사업명</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="2"/></hp:tc>
      <hp:tc><hp:subList><hp:p><hp:run><hp:t/></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="1"/><hp:cellSpan colSpan="1" rowSpan="2"/></hp:tc>
    </hp:tr>
  </hp:tbl></hp:run></hp:p>
  <hp:p><hp:run><hp:t>검토 의견: [입력]</hp:t></hp:run></hp:p>
</hp:sec>`;
  const blocks = extractHwpxBlocks(xml);
  assert.deepEqual(blocks.map((block) => block.type), ["paragraph", "heading", "table", "paragraph"]);
  assert.equal(blocks[0].text, "2027년 사업계획서");
  assert.equal(blocks[1].title, "사업 개요");
  const table = blocks[2];
  assert.deepEqual(table.headers, ["구분", "내용"]);
  assert.deepEqual(table.rows, [["사업명", ""]]);
  assert.ok(table.spans, "병합 정보가 표에 담기지 않았습니다");
  assert.deepEqual(table.spans[0][0], [2, 1]);

  const schema = parseSampleTemplate({ blocks, fileName: "양식.hwpx", format: "hwpx" });
  assert.deepEqual(schema.sections.map((section) => section.title), ["사업 개요"]);
  assert.equal(schema.tables.length, 1);
  const fields = extractFormFields(schema);
  assert.equal(fields.some((field) => field.label === "사업명"), true);
  assert.equal(fields.some((field) => field.label === "검토 의견"), true);
});
