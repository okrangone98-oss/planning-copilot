import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSmartTextPrompt,
  collectSelectedValues,
  detectValueKinds,
  mapFreeTextToFields,
  mergeWithRuleMap,
  parseSmartTextResponse,
  scoreSegmentForField,
  splitFreeText,
  splitLabeledLine,
  splitSentences,
  summarizeSmartMap
} from "../../../src/lib/smartTextMapper.mjs";
import { extractFormFields } from "../../../src/lib/kordocFormSpec.mjs";
import { emptyTemplateSchema } from "../../../src/lib/sampleTemplateParser.mjs";

const FIELDS = extractFormFields(
  (() => {
    const schema = emptyTemplateSchema("연습양식.hwpx");
    schema.sections = [
      { id: "s1", rawLevel: 1, level: 1, parentId: null, title: "사업 개요", order: 1, line: 1 },
      { id: "s2", rawLevel: 1, level: 1, parentId: null, title: "추진 배경", order: 2, line: 8 },
      { id: "s3", rawLevel: 1, level: 1, parentId: null, title: "소요 예산", order: 3, line: 14 }
    ];
    schema.tables = [
      {
        id: "t1", order: 1, sectionId: "s1", caption: "사업 개요", headers: ["구분", "내용"],
        rows: [["사업명", ""], ["수행기관", ""], ["사업기간", ""], ["사업지역", ""], ["총사업비", ""]],
        columnCount: 2, rowCount: 5, emptyCells: 5
      },
      {
        id: "t2", order: 2, sectionId: "s2", caption: "추진 배경", headers: ["항목", "내용"],
        rows: [["지역 현황", ""], ["문제점", ""]],
        columnCount: 2, rowCount: 2, emptyCells: 2
      },
      {
        id: "t3", order: 3, sectionId: "s3", caption: "소요 예산", headers: ["비목", "산출 내역"],
        rows: [["인건비", ""], ["운영비", ""]],
        columnCount: 2, rowCount: 2, emptyCells: 2
      }
    ];
    schema.slots = [];
    return schema;
  })()
);

const MEMO = `사업명: 양양 생활문화 혁신 지원사업
수행기관: 양양군농촌활성화지원센터
사업기간: 2027년 3월 ~ 11월
사업지역: 강원 양양군 현남면 일대
총사업비: 총 4,800만원 (국비 3,360, 군비 960, 자부담 480)

지역에 빈집이 120채 있고 청년이 계속 떠나고 있습니다.

인건비: 강사비 250,000원 × 24회 = 6,000,000원
운영비: 재료비 100,000원 × 20회 = 2,000,000원`;

test("“라벨: 값” 줄은 쉼표에서 자르지 않고 다음 라벨 앞까지 값을 가진다", () => {
  assert.deepEqual(
    splitLabeledLine("총사업비: 총 4,800만원 (국비 3,360, 군비 960, 자부담 480)"),
    [{ label: "총사업비", value: "총 4,800만원 (국비 3,360, 군비 960, 자부담 480)" }]
  );
  assert.deepEqual(
    splitLabeledLine("사업명: A / 기간: 2027. 3. ~ 11."),
    [{ label: "사업명", value: "A /" }, { label: "기간", value: "2027. 3. ~ 11." }]
  );
  assert.deepEqual(splitLabeledLine("https://github.com/chrisryugj/kordoc"), []);
  assert.deepEqual(splitLabeledLine("회의는 14:00에 시작합니다"), []);
});

test("붙여넣은 글을 라벨·목록·문장 단위 조각으로 나눈다", () => {
  const segments = splitFreeText(MEMO);
  const kinds = segments.map((segment) => segment.kind);
  assert.equal(kinds[0], "labeled");
  assert.equal(segments[0].text, "양양 생활문화 혁신 지원사업");
  assert.ok(segments.some((segment) => segment.kind === "paragraph" && /빈집이 120채/.test(segment.text)));

  const bullets = splitFreeText("○ 청년 20명 모집\n○ 마을 작업실 3곳\n- 홍보물 제작");
  assert.deepEqual(bullets.map((segment) => segment.kind), ["bullet", "bullet", "bullet"]);
  assert.equal(bullets[0].text, "청년 20명 모집");

  const heading = splitFreeText("■ 사업 개요\n목표는 청년이 수익을 만드는 것입니다.");
  assert.equal(heading[0].kind, "heading");
  assert.equal(heading[0].sectionTitle, "사업 개요");
  assert.equal(heading[1].kind, "paragraph");

  assert.deepEqual(splitSentences("사업 이름은 A입니다. 담당 기관은 B센터입니다."), ["사업 이름은 A입니다.", "담당 기관은 B센터입니다."]);
});

test("값 모양(날짜·금액·인원·기관·문제)을 구분한다", () => {
  assert.deepEqual(detectValueKinds("2027년 3월 ~ 11월"), ["date"]);
  assert.ok(detectValueKinds("총 4,800만원").includes("amount"));
  assert.ok(detectValueKinds("청년 20명이 참여").includes("count"));
  assert.ok(detectValueKinds("양양군농촌활성화지원센터가 맡습니다").includes("org"));
  assert.ok(detectValueKinds("빈집이 늘고 청년이 떠나고 있습니다").includes("problem"));
  assert.deepEqual(detectValueKinds("그냥 문장"), []);
});

test("라벨이 붙은 메모를 빈 칸에 1:1로 배치한다", () => {
  const result = mapFreeTextToFields({ fields: FIELDS, text: MEMO });
  const byLabel = new Map(result.rows.map((row) => [row.label, row]));
  assert.equal(byLabel.get("사업명")?.proposed, "양양 생활문화 혁신 지원사업");
  assert.equal(byLabel.get("수행기관")?.proposed, "양양군농촌활성화지원센터");
  assert.equal(byLabel.get("사업기간")?.proposed, "2027년 3월 ~ 11월");
  assert.equal(byLabel.get("사업지역")?.proposed, "강원 양양군 현남면 일대");
  assert.match(byLabel.get("총사업비")?.proposed || "", /4,800만원/);
  assert.match(byLabel.get("인건비")?.proposed || "", /강사비/);
  assert.equal(byLabel.get("사업명")?.checked, true);
  assert.equal(byLabel.get("사업명")?.conflict, false);
  // 같은 라벨이면 다른 칸을 건드리지 않는다.
  assert.equal(byLabel.get("수행기관")?.proposed.includes("마을회"), false);
});

test("날짜·금액·기관명 패턴만 있어도 라벨 없이 알맞은 칸을 찾는다", () => {
  const text = "2027년 3월부터 11월까지 진행합니다.\n총 4,800만원 예산입니다.\n양양군농촌활성화지원센터가 맡습니다.";
  const result = mapFreeTextToFields({ fields: FIELDS, text });
  const labels = result.rows.map((row) => row.label);
  assert.ok(labels.includes("사업기간"), labels.join(","));
  assert.ok(labels.includes("총사업비"), labels.join(","));
  assert.ok(labels.includes("수행기관"), labels.join(","));

  const segment = splitFreeText("2027년 3월 ~ 11월")[0];
  const dateField = FIELDS.find((field) => field.label === "사업기간");
  const nameField = FIELDS.find((field) => field.label === "사업명");
  assert.ok(scoreSegmentForField(segment, dateField).score > scoreSegmentForField(segment, nameField).score);
});

test("이미 글이 있는 칸은 기본으로 체크하지 않고 유지한다", () => {
  const schema = emptyTemplateSchema("x.hwpx");
  schema.sections = [{ id: "s1", rawLevel: 1, level: 1, parentId: null, title: "사업 개요", order: 1, line: 1 }];
  schema.tables = [{
    id: "t1", order: 1, sectionId: "s1", caption: "사업 개요", headers: ["구분", "내용"],
    rows: [["사업명", "기존 사업명"]], columnCount: 2, rowCount: 1, emptyCells: 0
  }];
  schema.slots = [];
  const fields = extractFormFields(schema);
  const result = mapFreeTextToFields({ fields, text: "사업명: 새 사업명" });
  const row = result.rows[0];
  assert.equal(row.fieldId, fields[0].id);
  assert.equal(row.current, "기존 사업명");
  assert.equal(row.conflict, true);
  assert.equal(row.checked, false);
  assert.equal(row.mode, "replace");

  const summary = summarizeSmartMap(result);
  assert.equal(summary.filling, 0);
  assert.equal(summary.keeping, 1);

  const keep = collectSelectedValues(result.rows, []);
  assert.equal(keep.count, 0);
  assert.deepEqual(keep.kept, [fields[0].id]);

  const replace = collectSelectedValues(result.rows, [fields[0].id]);
  assert.equal(replace.values[fields[0].id], "새 사업명");
  assert.equal(replace.replaced, 1);
});

test("AI 응답 JSON을 읽고, 깨지면 null로 규칙 폴백을 알린다", () => {
  const ok = parseSmartTextResponse(
    "설명입니다.\n```json\n{\"assignments\":[{\"fieldId\":\"f1\",\"text\":\"양양 생활문화\",\"reason\":\"사업명\"},{\"label\":\"총사업비\",\"text\":\"4,800만원\"}],\"unassigned\":[\"인사말\"]}\n```",
    { fields: FIELDS }
  );
  assert.ok(ok);
  assert.equal(ok.rows.length, 2);
  assert.equal(ok.rows[0].source, "ai");
  assert.equal(ok.rows.find((row) => row.label === "총사업비")?.proposed, "4,800만원");
  assert.equal(ok.leftovers.length, 1);

  assert.equal(parseSmartTextResponse("그냥 텍스트입니다", { fields: FIELDS }), null);
  assert.equal(parseSmartTextResponse("{\"assignments\":[]}", { fields: FIELDS }), null);
  assert.equal(parseSmartTextResponse("{\"assignments\":[{\"fieldId\":\"없는칸\",\"text\":\"x\"}]}", { fields: FIELDS }), null);

  const merged = mergeWithRuleMap(ok, mapFreeTextToFields({ fields: FIELDS, text: MEMO }));
  assert.ok(merged.rows.length > ok.rows.length);
  assert.equal(merged.rows.filter((row) => row.source === "ai").length, 2);
});

test("AI 프롬프트는 칸 번호·이름과 원문, JSON 출력 규칙을 담는다", () => {
  const prompt = buildSmartTextPrompt({ fields: FIELDS, text: MEMO });
  assert.match(prompt, /- f1 · 사업명/);
  assert.match(prompt, /구역 ‘사업 개요’/);
  assert.match(prompt, /"fieldId":"f1"/);
  assert.match(prompt, /원문에 없는 사실·수치·기관명을 만들지 마세요/);
  assert.match(prompt, /양양 생활문화 혁신 지원사업/);
});

test("선택한 칸만 값으로 모으고 요약한다", () => {
  const result = mapFreeTextToFields({ fields: FIELDS, text: MEMO });
  const all = new Set(result.rows.map((row) => row.fieldId));
  const picked = collectSelectedValues(result.rows, all);
  assert.equal(picked.count, result.rows.length);
  const summary = summarizeSmartMap(result, all);
  assert.equal(summary.filling, result.rows.length);
  assert.equal(summary.fields, FIELDS.length);

  const none = collectSelectedValues(result.rows, new Set());
  assert.equal(none.count, 0);
});
