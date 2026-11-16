import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_DRAFT_MAX_TARGETS,
  buildLeftoverDraftPrompt,
  collectDraftValues,
  parseLeftoverDraftResponse,
  selectLeftoverTargets,
  summarizeDraftResult
} from "../../../src/lib/carryoverAiDraft.mjs";

/** kordoc 가 읽은 칸 모양 — 테스트에 필요한 값만 둔다. */
function field(over = {}) {
  return {
    id: "f1",
    label: "추진 실적",
    key: "추진실적",
    fillKey: "추진 실적",
    value: "",
    empty: true,
    type: "text",
    hint: "",
    sectionId: null,
    sectionTitle: "1. 사업 개요",
    origin: "table",
    context: "",
    ...over
  };
}

test("AI에 보낼 칸은 작년 값이 남은 칸 → 빈 칸 순서로, 문서 제목 칸은 뺀다", () => {
  const fields = [
    field({ id: "f1", label: "사업명", value: "2025년 마을활력 결과보고서", empty: false, rewrite: true }),
    field({ id: "f2", label: "추진 기간", value: "2025. 3. 2. ~ 2025. 12. 20." }),
    field({ id: "f3", label: "참여 인원" }),
    field({ id: "f4", label: "성과 요약" }),
    field({ id: "f5", label: "향후 계획", value: "이미 올해 값으로 채움" })
  ];
  const targets = selectLeftoverTargets({
    fields,
    values: { f4: "사용자가 직접 적은 값" },
    leftover: { rows: [{ fieldId: "f2", previous: "2025. 3. 2. ~ 2025. 12. 20.", reason: "바꾼 값에 아직 전년도 연도가 들어 있습니다" }] }
  });

  assert.deepEqual(targets.map((target) => target.fieldId), ["f2", "f3"]);
  assert.equal(targets[0].kind, "leftover");
  assert.equal(targets[0].previous, "2025. 3. 2. ~ 2025. 12. 20.");
  assert.equal(targets[1].kind, "empty");
  assert.equal(targets[1].label, "참여 인원");
});

test("한 번에 보내는 칸 수를 제한하고, 같은 칸을 두 번 넣지 않는다", () => {
  const fields = Array.from({ length: AI_DRAFT_MAX_TARGETS + 6 }, (_, index) => field({ id: `f${index}`, label: `칸 ${index}` }));
  const targets = selectLeftoverTargets({ fields, leftover: { rows: [{ fieldId: "f0", previous: "1,200,000원" }] } });
  assert.equal(targets.length, AI_DRAFT_MAX_TARGETS);
  assert.equal(new Set(targets.map((target) => target.fieldId)).size, targets.length);
  assert.equal(targets[0].fieldId, "f0");
});

test("프롬프트는 남은 칸 이름표와 올해 자료만 담고, 자료에 없는 값을 만들지 말라고 못박는다", () => {
  const targets = [
    { fieldId: "f2", label: "추진 기간", sectionTitle: "1. 사업 개요", type: "text", where: "", previous: "2025. 3. 2.", reason: "잔존", kind: "leftover" },
    { fieldId: "f3", label: "참여 인원", sectionTitle: "", type: "amount", where: "", previous: "", reason: "빈 칸", kind: "empty" }
  ];
  const prompt = buildLeftoverDraftPrompt({
    targets,
    fields: [field({ id: "f3", label: "참여 인원" })],
    values: {},
    planLines: [
      { kind: "label", label: "사업명", value: "2026년 마을활력" },
      { kind: "label", label: "총사업비", value: "30,000,000원" }
    ],
    materialLine: "출석 128명 · 6회",
    smartText: "프로그램은 6회 운영했고 주민 20명이 기획에 참여했습니다.",
    currentYear: 2026,
    sourceYear: 2025
  });

  assert.match(prompt, /f2 · ‘추진 기간’/);
  assert.match(prompt, /f3 · ‘참여 인원’/);
  assert.match(prompt, /지금 적힌 값: 2025\. 3\. 2\./);
  assert.match(prompt, /2026년 결과보고서/);
  assert.match(prompt, /2025년 값이 남아 있습니다/);
  assert.match(prompt, /자료에 없는 숫자·금액·인원·기관명·사업명을 만들지 마세요/);
  assert.match(prompt, /자리표시자/);
  assert.match(prompt, /2026년 마을활력/);
  assert.match(prompt, /출석 128명/);
  assert.match(prompt, /주민 20명이 기획에/);
  assert.match(prompt, /"drafts"/);
  // 문서 전체(양식 원문)를 보내지 않는다 — 프롬프트는 남은 칸과 자료 요약으로 끝난다.
  assert.equal(prompt.includes("이미 올해 값으로 채움"), false);
});

test("AI 응답은 남은 칸만 받아들이고, 가림 표시·이상한 칸은 버린다", () => {
  const targets = [
    { fieldId: "f2", label: "추진 기간", sectionTitle: "", kind: "leftover", previous: "2025. 3. 2.", type: "text", where: "", reason: "" },
    { fieldId: "f3", label: "참여 인원", sectionTitle: "", kind: "empty", previous: "", type: "amount", where: "", reason: "" }
  ];
  const raw = [
    "```json",
    JSON.stringify({
      drafts: [
        { fieldId: "f2", value: "2026. 3. 2. ~ 2026. 12. 18.", reason: "추진계획서 기간" },
        { fieldId: "f9", value: "목록에 없는 칸", reason: "무시" },
        { fieldId: "f3", value: "[연락처_1]", reason: "가림 표시가 남음" }
      ]
    }),
    "```"
  ].join("\n");
  const parsed = parseLeftoverDraftResponse(raw, { targets, currentYear: 2026 });

  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].fieldId, "f2");
  assert.equal(parsed.rows[0].value, "2026. 3. 2. ~ 2026. 12. 18.");
  assert.equal(parsed.rows[0].yearRisk, false);
  assert.equal(parsed.counts.masked, 1);
  assert.equal(parsed.counts.rejected, 1);
});

test("올해보다 앞선 연도가 든 제안은 버리지 않고 ‘연도 확인 필요’로 표시한다", () => {
  const targets = [{ fieldId: "f2", label: "추진 기간", sectionTitle: "", kind: "empty", previous: "", type: "text", where: "", reason: "" }];
  const parsed = parseLeftoverDraftResponse(
    '{"drafts":[{"fieldId":"f2","value":"2025년 3월 ~ 2025년 12월"}]}',
    { targets, currentYear: 2026, sourceYear: 2025 }
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].yearRisk, true);
  assert.deepEqual(parsed.rows[0].riskYears, [2025]);
});

test("JSON이 아니거나 빈 응답이면 초안 없이 돌려준다", () => {
  const targets = [{ fieldId: "f1", label: "칸", sectionTitle: "", kind: "empty", previous: "", type: "text", where: "", reason: "" }];
  for (const raw of ["", "죄송하지만 도와드릴 수 없습니다.", "{}", '{"drafts":[]}', '{"drafts":[{"fieldId":"f1","value":""}]}']) {
    const parsed = parseLeftoverDraftResponse(raw, { targets, currentYear: 2026 });
    assert.equal(parsed.rows.length, 0, raw);
  }
  // 필드 이름을 조금 다르게 줘도(rows·배열) 읽는다.
  assert.equal(parseLeftoverDraftResponse('[{"id":"f1","text":"제안"}]', { targets, currentYear: 2026 }).rows.length, 1);
});

test("체크한 제안만 값이 되고, 값 길이는 상한에서 잘린다", () => {
  const rows = [
    { fieldId: "f1", label: "칸1", sectionTitle: "", kind: "empty", previous: "", value: "값1", reason: "", yearRisk: false, riskYears: [] },
    { fieldId: "f2", label: "칸2", sectionTitle: "", kind: "empty", previous: "", value: "값2", reason: "", yearRisk: false, riskYears: [] }
  ];
  assert.deepEqual(collectDraftValues(rows, new Set(["f2"])), { values: { f2: "값2" }, count: 1 });
  assert.deepEqual(collectDraftValues(rows, ["f1", "f2"]).count, 2);
  assert.equal(collectDraftValues(rows, new Set()).count, 0);

  const long = [{ ...rows[0], value: "가".repeat(500) }];
  const { values } = collectDraftValues(long, new Set(["f1"]));
  assert.equal(values.f1.length, 260);
});

test("화면 요약은 고른 칸·연도 위험·버린 건수를 센다", () => {
  const result = {
    rows: [
      { fieldId: "f1", yearRisk: false },
      { fieldId: "f2", yearRisk: true }
    ],
    counts: { received: 4, kept: 2, rejected: 1, masked: 1 }
  };
  assert.deepEqual(summarizeDraftResult(result, new Set(["f1"])), { total: 2, selected: 1, risky: 1, masked: 1, rejected: 1 });
  assert.equal(summarizeDraftResult(null).total, 0);
});
