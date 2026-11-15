import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_STATUS_LABEL,
  buildDownloadPreflight,
  checkBudgetTotal,
  checkFieldValue,
  classifyFields,
  explainDownloadFailure,
  numberFromValue,
  preflightSummaryLine,
  summarizeFieldStatuses
} from "../../../src/lib/downloadPreflight.mjs";

/** 검토 표 테스트용 칸 — 실제 extractFormFields 결과와 같은 모양만 담는다. */
function field(id, label, over = {}) {
  return {
    id,
    label,
    key: label,
    fillKey: label,
    value: "",
    empty: true,
    type: "text",
    hint: "",
    sectionId: null,
    sectionTitle: "",
    origin: "table",
    context: "",
    ...over
  };
}

test("빈 값은 형식 검사에서 통과하고 필수 검사에서 따로 다룬다", () => {
  for (const type of ["date", "amount", "phone", "email"]) {
    const result = checkFieldValue(field("f", "칸", { type }), "");
    assert.equal(result.ok, true);
    assert.equal(result.level, "");
  }
});

test("날짜 형식 — 연·월이 보이면 통과, 숫자만 있으면 권장, 숫자가 없으면 막는다", () => {
  const target = field("f", "사업기간", { type: "date" });
  assert.equal(checkFieldValue(target, "2026-03-02").ok, true);
  assert.equal(checkFieldValue(target, "2026. 3. 2.").ok, true);
  assert.equal(checkFieldValue(target, "2026년 3월 ~ 2026년 12월").ok, true);
  assert.equal(checkFieldValue(target, "3월").ok, true);

  // 월이 보이면 통과 — "3월 초"처럼 일이 없는 기간도 양식에 적히는 값이다.
  assert.equal(checkFieldValue(target, "3월 초").ok, true);

  const odd = checkFieldValue(target, "3/2");
  assert.equal(odd.ok, false);
  assert.equal(odd.level, "warn");
  assert.match(odd.message, /연·월·일/);

  const wrong = checkFieldValue(target, "미정");
  assert.equal(wrong.ok, false);
  assert.equal(wrong.level, "block");
});

test("금액·인원 형식 — 숫자와 단위만 있으면 통과, 글자가 섞이면 권장", () => {
  const target = field("f", "총사업비", { type: "amount" });
  assert.equal(checkFieldValue(target, "1,200,000원").ok, true);
  assert.equal(checkFieldValue(target, "12명").ok, true);
  assert.equal(checkFieldValue(target, "3회").ok, true);
  assert.equal(checkFieldValue(target, "약 500,000원").ok, true);

  // 내역이 함께 적힌 금액은 그대로 둔다(양식 칸에 글로 들어가는 값이다).
  assert.equal(checkFieldValue(target, "총 4,800만원 (국비 3,360, 군비 960)").ok, true);
  assert.equal(checkFieldValue(target, "인건비 300,000원").ok, true);

  // 단위 없이 숫자만 떠 있으면 무엇인지 알려 준다.
  const mixed = checkFieldValue(target, "3,360 정도");
  assert.equal(mixed.ok, false);
  assert.equal(mixed.level, "warn");

  const none = checkFieldValue(target, "추후 협의");
  assert.equal(none.ok, false);
  assert.equal(none.level, "block");
});

test("전화·메일·주민번호·체크 칸 검사", () => {
  assert.equal(checkFieldValue(field("f", "연락처", { type: "phone" }), "010-1234-5678").ok, true);
  assert.equal(checkFieldValue(field("f", "연락처", { type: "phone" }), "010-123").ok, false);
  assert.equal(checkFieldValue(field("f", "메일", { type: "email" }), "a@b.co").ok, true);
  assert.equal(checkFieldValue(field("f", "메일", { type: "email" }), "a.b.co").ok, false);
  assert.equal(checkFieldValue(field("f", "주민등록번호", { type: "idnum" }), "830103-1234567").ok, true);
  assert.equal(checkFieldValue(field("f", "주민등록번호", { type: "idnum" }), "830103").ok, false);
  assert.equal(checkFieldValue(field("f", "참가 신청", { type: "checkbox" }), "☑ 신청").ok, true);
  assert.equal(checkFieldValue(field("f", "참가 신청", { type: "checkbox" }), "신청").ok, false);
});

test("칸 상태 — 자동 채움·직접 적은 값·빈칸·원본 유지·확인 필요를 구분한다", () => {
  const fields = [
    field("f1", "사업명"),
    field("f2", "수행기관"),
    field("f3", "사업기간", { type: "date" }),
    field("f4", "담당자"),
    field("f5", "추진 근거", { empty: false, value: "2026년 시행계획" })
  ];
  const values = { f1: "양양 목공 교실", f2: "양양군농촌활성화지원센터", f3: "다음 달", f4: "김말랑" };
  const rows = classifyFields({
    fields,
    values,
    autoFieldIds: ["f1", "f2"],
    lowConfidenceIds: ["f2"]
  });
  const byId = new Map(rows.map((row) => [row.fieldId, row]));

  assert.equal(byId.get("f1").status, "auto");
  assert.equal(byId.get("f1").statusLabel, "자동 채움");
  assert.equal(byId.get("f2").status, "check", "자동 배치 신뢰도가 낮으면 확인 대상");
  assert.equal(byId.get("f3").status, "check", "날짜 형식이 틀리면 확인 대상");
  assert.equal(byId.get("f4").status, "manual");
  assert.equal(byId.get("f5").status, "original");
  assert.equal(FIELD_STATUS_LABEL.required, "빈칸 · 필수");

  const counts = summarizeFieldStatuses([
    ...rows,
    classifyFields({ fields: [field("f6", "예산 집행액 ※", { type: "amount" })], values: {} })[0]
  ]);
  assert.equal(counts.total, 6);
  assert.equal(counts.auto, 1);
  assert.equal(counts.required, 1);
  assert.equal(counts.filled, 4);
});

test("필수 표시가 있는 빈칸은 내려받기 전 확인 대상이고, 두 번째 누르면 통과한다", () => {
  const fields = [field("f1", "사업명 ※"), field("f2", "총사업비(필수)", { type: "amount" }), field("f3", "담당자")];
  const preflight = buildDownloadPreflight({ fields, values: { f3: "김말랑" }, hasFile: true });
  assert.equal(preflight.canDownload, false);
  assert.equal(preflight.counts.block, 1);
  const item = preflight.items.find((entry) => entry.id === "required-blank");
  assert.ok(item);
  assert.match(item.title, /필수 표시\(※\)가 있는 빈칸 2개/);
  assert.match(item.detail, /사업명/);
  assert.match(preflight.gateMessage, /한 번 더 누르면/);
  assert.match(preflight.headline, /내려받기 전에 확인할 것 1건/);
});

test("값이 하나도 없거나 칸을 못 찾으면 이유와 다음 할 일을 준다", () => {
  const empty = buildDownloadPreflight({ fields: [], values: {}, hasFile: true });
  assert.equal(empty.canDownload, false);
  assert.equal(empty.items[0].id, "no-fields");
  assert.match(empty.items[0].fix, /붙여넣기/);

  const noValues = buildDownloadPreflight({ fields: [field("f1", "사업명")], values: {}, hasFile: true });
  assert.equal(noValues.canDownload, false);
  assert.ok(noValues.items.some((item) => item.id === "no-values"));
  assert.match(noValues.items.find((item) => item.id === "no-values").fix, /새로고침해도/);
});

test("양식 파일이 없으면 파일을 만들 수 없다고 알리고 값을 잃지 않는다고 말한다", () => {
  const preflight = buildDownloadPreflight({ fields: [field("f1", "사업명")], values: { f1: "양양 목공 교실" }, hasFile: false });
  const item = preflight.items.find((entry) => entry.id === "no-file");
  assert.ok(item);
  assert.equal(item.level, "block");
  assert.match(item.fix, /지금 적은 값은 그대로 남습니다/);
});

test("같은 이름의 칸에 값이 다르면 순서대로 들어간다는 것을 알린다", () => {
  const fields = [field("f1", "성명"), field("f2", "성명"), field("f3", "소속")];
  const preflight = buildDownloadPreflight({ fields, values: { f1: "김말랑", f2: "이몽룡", f3: "양양군" }, hasFile: true });
  const item = preflight.items.find((entry) => entry.id === "duplicate-label");
  assert.ok(item);
  assert.equal(item.level, "warn");
  assert.match(item.detail, /성명/);
});

test("미배치 글과 자동 배치 신뢰도가 낮은 칸을 따로 표시한다", () => {
  const fields = [field("f1", "사업명"), field("f2", "추진 내용")];
  const preflight = buildDownloadPreflight({
    fields,
    values: { f1: "양양 목공 교실", f2: "주민 12명과 함께 합니다" },
    autoFieldIds: ["f1", "f2"],
    lowConfidenceIds: ["f2"],
    leftovers: [{ id: "l1", text: "이 문장은 어느 칸에도 맞지 않았습니다" }],
    hasFile: true
  });
  assert.ok(preflight.items.some((item) => item.id === "leftovers" && item.level === "warn"));
  const low = preflight.items.find((item) => item.id === "low-confidence");
  assert.ok(low);
  assert.equal(low.level, "manual");
  assert.equal(preflight.canDownload, true, "사람이 보는 항목은 다운로드를 막지 않는다");
});

test("예산 총액과 비목 합계 — 맞음·불일치·일부 비어 있음·판단 불가를 나눈다", () => {
  const make = (values) =>
    classifyFields({
      fields: [
        field("t", "총사업비", { type: "amount" }),
        field("a", "인건비"),
        field("b", "운영비"),
        field("c", "홍보비")
      ],
      values
    });

  assert.equal(checkBudgetTotal({ rows: make({}) }).status, "none");
  assert.equal(checkBudgetTotal({ rows: make({ t: "1,000,000원" }) }).status, "none");
  assert.equal(checkBudgetTotal({ rows: make({ t: "1,000,000원", a: "600,000원", b: "400,000원", c: "0원" }) }).status, "match");

  const mismatch = checkBudgetTotal({ rows: make({ t: "1,000,000원", a: "600,000원", b: "300,000원", c: "0원" }) });
  assert.equal(mismatch.status, "mismatch");
  assert.match(mismatch.detail, /차액 100,000원/);

  const partial = checkBudgetTotal({ rows: make({ t: "1,000,000원", a: "600,000원" }) });
  assert.equal(partial.status, "partial");
  assert.match(partial.detail, /비어 있는 비목 2개/);

  const preflight = buildDownloadPreflight({
    fields: [field("t", "총사업비", { type: "amount" }), field("a", "인건비"), field("b", "운영비")],
    values: { t: "1,000,000원", a: "600,000원", b: "300,000원" },
    hasFile: true
  });
  assert.ok(preflight.items.some((item) => item.id === "budget-mismatch" && item.level === "warn"));
  assert.equal(preflight.canDownload, true);
});

test("출석은 미입력과 0명을 구분해 알린다", () => {
  const fields = [field("f1", "출석 인원", { type: "amount" }), field("f2", "사업명")];
  const blank = buildDownloadPreflight({ fields, values: { f2: "양양 목공 교실" }, hasFile: true });
  const blankItem = blank.items.find((item) => item.id === "attendance-blank");
  assert.ok(blankItem);
  assert.match(blankItem.fix, /0명이면 0을 적어/);

  const zero = buildDownloadPreflight({ fields, values: { f1: "0", f2: "양양 목공 교실" }, hasFile: true });
  assert.ok(zero.items.some((item) => item.id === "attendance-zero" && item.level === "manual"));
  assert.equal(zero.canDownload, true);
});

test("결과보고서는 실적·출석 칸이 비면 불완전하다고 표시한다", () => {
  const fields = [field("f1", "추진 실적"), field("f2", "출석 인원", { type: "amount" }), field("f3", "사업명")];
  const preflight = buildDownloadPreflight({
    fields,
    values: { f3: "2026 양양 관광두레" },
    title: "2026년 사업 결과보고서",
    hasFile: true
  });
  const item = preflight.items.find((entry) => entry.id === "report-incomplete");
  assert.ok(item);
  assert.equal(item.level, "manual");
  assert.match(item.detail, /추진 실적/);
  assert.match(item.fix, /미입력인지 0명인지/);
});

test("병합된 칸이 있는 표는 값 위치를 사람이 보라고 남긴다", () => {
  const preflight = buildDownloadPreflight({
    fields: [field("f1", "사업명")],
    values: { f1: "양양 목공 교실" },
    schema: { tables: [{ caption: "지정서", spans: [[[1, 2]]] }] },
    hasFile: true
  });
  const item = preflight.items.find((entry) => entry.id === "merged-cells");
  assert.ok(item);
  assert.equal(item.level, "manual");
  assert.match(item.fix, /한글에서 열어/);
});

test("값 요약 — 채운 칸 수와 확인 건수를 한 줄로 만든다", () => {
  const preflight = buildDownloadPreflight({
    fields: [field("f1", "사업명 ※"), field("f2", "담당자")],
    values: { f2: "김말랑" },
    hasFile: true
  });
  const line = preflightSummaryLine(preflight);
  assert.match(line, /채운 칸 1\/2/);
  assert.match(line, /꼭 확인 1건/);
  assert.equal(preflightSummaryLine(null), "");
});

test("한 칸에 값이 두 줄 들어가면 형식보다 먼저 막고, 글자가 섞인 한 줄은 권장에 그친다", () => {
  const fields = [field("f1", "참여 인원", { type: "amount" }), field("f2", "사업명")];
  const merged = checkFieldValue(fields[0], "60명\n0명");
  assert.equal(merged.ok, false);
  assert.equal(merged.level, "block");
  assert.match(merged.message, /두 줄 이상/);

  const mixed = buildDownloadPreflight({
    fields,
    values: { f1: "4,800 (국비 3,360, 군비 960)", f2: "양양 목공 교실" },
    hasFile: true
  });
  const item = mixed.items.find((entry) => entry.id === "invalid-format");
  assert.ok(item);
  assert.equal(item.level, "warn", "숫자가 있는 한 줄짜리 값은 막지 않는다");
  assert.equal(mixed.canDownload, true);
});

test("다운로드 실패 이유를 쉬운 한국어와 다음 할 일로 바꾼다", () => {
  const zip = explainDownloadFailure(new Error("Can't find end of central directory : is this a zip file?"));
  assert.match(zip.title, /\.hwpx 형식이 아닙니다/);
  assert.match(zip.fix, /다른 이름으로 저장 → HWPX/);

  const section = explainDownloadFailure(new Error("section0.xml not found"));
  assert.match(section.title, /본문을 찾지 못했습니다/);

  const memory = explainDownloadFailure(new Error("Array buffer allocation failed"));
  assert.match(memory.title, /브라우저가 처리하지 못했습니다/);

  const other = explainDownloadFailure(new Error("boom"));
  assert.equal(other.title, "파일을 만들지 못했습니다");
  assert.match(other.fix, /입력한 값은 그대로 남아 있습니다/);

  const empty = explainDownloadFailure(new Error(""));
  assert.equal(empty.detail, "");
});

test("값에서 숫자만 뽑아낸다 — 단위가 붙어도, 없어도", () => {
  assert.equal(numberFromValue("1,200,000원"), 1200000);
  assert.equal(numberFromValue("12명"), 12);
  assert.equal(numberFromValue("0"), 0);
  assert.equal(numberFromValue("추후 협의"), null);
  assert.equal(numberFromValue("2026-03-02"), null);
  assert.equal(numberFromValue(""), null);
});
