import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProjectDataText,
  digestLoadedNote,
  mergeDigestIntoText,
  projectDataSignature,
  textSignature
} from "../../../src/lib/projectDataReuse.mjs";
import { attendanceReport, createEmptyProjectWork, expenseSummary, addSession, addExpense } from "../../../src/lib/projectOperations.mjs";
import { budgetSummary, formatWon } from "../../../src/lib/grantWorkflow.mjs";
import { buildReportDocument } from "../../../src/lib/reportHwpx.mjs";
import { mapFreeTextToFields } from "../../../src/lib/smartTextMapper.mjs";
import { extractFormFields } from "../../../src/lib/kordocFormSpec.mjs";
import { parseSampleTemplate } from "../../../src/lib/sampleTemplateParser.mjs";
import { PRACTICE_TEMPLATE_TEXT } from "../../../src/lib/practiceTemplate.mjs";

/* ── 공통 시험 자료 ─────────────────────────────────────────── */

function makePlan(overrides = {}) {
  return {
    schemaVersion: 1,
    presetId: "",
    presetName: "",
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
      { id: "r2", title: "운영 결과", hint: "", content: "· 회차: 전체 2회\n· 참석 연인원: 18명" }
    ],
    schedule: {
      applyDeadline: "",
      projectStart: "2026-03-01",
      projectEnd: "2026-11-30",
      settlementDeadline: "",
      reportDeadline: "2026-12-15",
      memo: ""
    },
    memo: "",
    updatedAt: "",
    ...overrides
  };
}

const PROJECT = {
  projectName: "관광두레",
  targetUsers: "양양 청년 10명",
  coreIdea: "마을 콘텐츠",
  problemSituation: "청년이 떠납니다.",
  fieldEvidence: "빈집 120채",
  activities: "기획 워크숍 4회",
  requirements: "관광두레 조례"
};

const META = { id: "p1", name: "관광두레", ownerName: "오대훈", year: "2026", goals: ["청년 10명 수익 창출"] };

/** 1회차: 정원·신청·참석이 모두 적힘 / 2회차: 인원 미입력 / 3회차: 적힌 0명 */
function makeWork(id = "p1") {
  let work = createEmptyProjectWork(id);
  work = addSession(work, {
    sequence: 1, title: "오리엔테이션", startAt: "2026-03-05T10:00", venue: "이음터",
    trackAttendance: true, capacity: 10, registered: 9, attended: 8, status: "done"
  }).work;
  work = addSession(work, {
    sequence: 2, title: "현장 답사", startAt: "2026-04-05T10:00", venue: "현남면",
    trackAttendance: true, capacity: 10, registered: null, attended: null, status: "planned"
  }).work;
  work = addSession(work, {
    sequence: 3, title: "중간 점검", startAt: "2026-05-05T10:00", venue: "",
    trackAttendance: true, capacity: 10, registered: 8, attended: 0, status: "done"
  }).work;
  work = addExpense(work, {
    budgetLineId: "b1", spentAt: "2026-03-06", vendor: "김강사", description: "강사비 1회",
    amount: 250000, status: "paid", evidenceChecked: true
  }).work;
  return work;
}

/* ── ① 사업 데이터 → 2단계 글 ────────────────────────────── */

test("사업 데이터를 2단계에서 읽을 수 있는 ‘라벨: 값’ 글로 만든다", () => {
  const digest = buildProjectDataText({ meta: META, plan: makePlan(), work: makeWork(), project: PROJECT });
  const text = digest.text;

  assert.match(text, /^■ 사업 개요/m);
  assert.match(text, /^사업명: 2026 양양 관광두레 플러스$/m);
  assert.match(text, /^수행기관: 양양군농촌활성화지원센터$/m);
  assert.match(text, /^사업기간: 2026\. 3\. 1\. ~ 2026\. 11\. 30\.$/m);
  assert.match(text, /^담당자: 오대훈$/m);
  // 예산 편성이 비목별 한 줄로 들어간다(집행·잔액까지 같은 계산에서).
  assert.match(text, /^인건비: 외래강사비 \(250,000원 × 4회\) 1,000,000원 · 집행 250,000원 · 잔액 750,000원$/m);
  assert.match(text, /^운영비: 재료비 \(100,000원 × 2회\) 200,000원 · 잔액 200,000원$/m);
  // 결과보고에 쓴 글도 같은 글로 옮겨진다.
  assert.match(text, /^■ 결과보고 · 추진 배경$/m);
  assert.match(text, /양양 청년의 마을 콘텐츠 기획 역량을 키웁니다\./);
  assert.equal(digest.counts.sessions, 3);
  assert.equal(digest.counts.reportSections, 2);
  assert.equal(digest.truncated, false);
});

test("빈 사업이면 글을 만들지 않고, 0원·0명을 지어내지 않는다", () => {
  const digest = buildProjectDataText({ plan: null, work: createEmptyProjectWork("empty"), project: { projectName: "" } });
  assert.equal(digest.text, "");
  assert.deepEqual(digest.missing, []);
});

test("적힌 값이 사업명뿐이면 나머지는 빈칸으로 두고 missing에 남긴다", () => {
  const digest = buildProjectDataText({
    meta: { id: "p2", name: "관광두레" },
    plan: null,
    work: createEmptyProjectWork("p2"),
    project: { projectName: "관광두레" }
  });
  assert.match(digest.text, /^사업명: 관광두레$/m);
  assert.doesNotMatch(digest.text, /0원/);
  assert.doesNotMatch(digest.text, /0명/);
  for (const label of ["수행기관", "사업기간", "재원", "총사업비"]) {
    assert.ok(digest.missing.includes(label), `${label}이(가) missing에 있어야 한다`);
  }
});

/* ── ② 미입력 vs 0 보존 ──────────────────────────────────── */

test("회차 인원은 ‘적힌 0명’과 ‘아직 안 적음’을 구분해 적는다", () => {
  const work = makeWork();
  const digest = buildProjectDataText({ meta: META, plan: makePlan(), work, project: PROJECT });
  const text = digest.text;

  // 적힌 값만 더한다 — 정원 30(10+10+10), 신청 17(9+8), 참석 8(8+0)
  assert.match(text, /^참여인원: 정원 30명 · 신청 17명 · 참석 8명 \(신청 미입력 1회, 참석 미입력 1회는 합계에서 뺌\)$/m);
  // 사업 실적도 0명으로 단정하지 않고 뺀 회차를 밝힌다.
  assert.match(text, /^참석 연인원: 8명 \(완료 회차 8명\) · 참석을 적지 않은 1회차는 합계에서 뺌\(0명으로 세지 않음\)$/m);
  // 미입력 회차는 인원 없이 일정만, 적힌 0명 회차는 일정에 그대로 남는다.
  assert.match(text, /^추진일정: 1회차 2026\. 3\. 5\. 10:00 오리엔테이션 \(이음터\) 완료 \/ 2회차 2026\. 4\. 5\. 10:00 현장 답사 \(현남면\) 예정/m);

  const attendance = attendanceReport(work);
  assert.equal(attendance.attended, 8);
  assert.equal(attendance.missingCount, 1);
  assert.equal(attendance.complete, false);
});

test("지출 원장이 비어 있으면 집행·잔액을 0원으로 만들지 않는다", () => {
  let work = createEmptyProjectWork("p3");
  work = addSession(work, { sequence: 1, title: "1회차", startAt: "2026-03-05T10:00", trackAttendance: false, status: "planned" }).work;
  const digest = buildProjectDataText({ meta: { id: "p3", name: "사업" }, plan: makePlan(), work, project: {} });
  assert.doesNotMatch(digest.text, /집행 0원/);
  assert.doesNotMatch(digest.text, /^집행 현황/m);
  // 편성만 있으면 편성 금액과 잔액(=편성)은 적는다.
  assert.match(digest.text, /^인건비: .*잔액 1,000,000원$/m);
});

/* ── ③ 예산 편성 → 지출 → 결과보고 정합성 ───────────────────── */

test("불러온 예산·집행·잔액이 지출 원장 계산과 결과보고 HWPX 내용에 그대로 맞는다", () => {
  const plan = makePlan();
  const work = makeWork();
  const digest = buildProjectDataText({ meta: META, plan, work, project: PROJECT });
  const ledger = expenseSummary(work, plan);
  const budget = budgetSummary(plan);

  assert.equal(ledger.total.plan, budget.total);
  assert.match(
    digest.text,
    new RegExp(`^집행 현황: 편성 ${formatWon(ledger.total.plan)} / 집행 ${formatWon(ledger.total.spent)} / 잔액 ${formatWon(ledger.total.balance)}`, "m")
  );

  // 결과보고 문서의 요약도 같은 계산 함수에서 나온 값이다.
  const document = buildReportDocument({ plan, project: PROJECT, work });
  const budgetRow = document.summary.find((row) => row.label === "예산");
  assert.ok(budgetRow, "결과보고 요약에 예산 줄이 있어야 한다");
  assert.match(budgetRow.value, new RegExp(`편성 ${formatWon(ledger.total.plan)}`));
  assert.match(budgetRow.value, new RegExp(`집행 ${formatWon(ledger.total.spent)}`));
  assert.match(budgetRow.value, new RegExp(`잔액 ${formatWon(ledger.total.balance)}`));

  const attendanceRow = document.summary.find((row) => row.label === "참석 연인원");
  assert.ok(attendanceRow);
  assert.match(attendanceRow.value, /8명/);
  assert.match(attendanceRow.value, /참석을 적지 않은 1회차는 합계에서 뺌/);
});

test("결과보고 쪽지(자동 집계)와 불러오기 글이 같은 회차·증빙 수치를 쓴다", () => {
  const work = makeWork();
  const ledger = expenseSummary(work, makePlan());
  const digest = buildProjectDataText({ meta: META, plan: makePlan(), work, project: PROJECT });
  assert.match(digest.text, new RegExp(`^증빙: 대상 ${ledger.evidence.total}건 중 ${ledger.evidence.checked}건 확인`, "m"));
  assert.equal(ledger.evidence.missing, 0);
});

/* ── ④ 붙여넣기 글 합치기(덮어쓰기 금지) ─────────────────────── */

test("붙여넣은 글이 없으면 그대로 넣는다", () => {
  const merged = mergeDigestIntoText({ existing: "", block: "사업명: A" });
  assert.deepEqual(merged, { text: "사업명: A", mode: "empty", needsConfirm: false, changed: true });
});

test("직접 쓴 글이 있으면 지우지 않고 뒤에 붙이며 확인을 받는다", () => {
  const merged = mergeDigestIntoText({ existing: "카톡에서 복사한 메모", block: "사업명: A" });
  assert.equal(merged.text, "카톡에서 복사한 메모\n\n사업명: A");
  assert.equal(merged.mode, "append");
  assert.equal(merged.needsConfirm, true);
});

test("앞서 불러온 블록은 중복으로 쌓이지 않고 최신 값으로 바뀐다", () => {
  const first = "사업명: A\n총사업비: 100원";
  const second = "사업명: A\n총사업비: 200원";
  const once = mergeDigestIntoText({ existing: "내 메모", block: first });
  const again = mergeDigestIntoText({ existing: once.text, block: second, previousBlock: first });
  assert.equal(again.text, "내 메모\n\n사업명: A\n총사업비: 200원");
  assert.equal(again.mode, "refresh");
  assert.equal(again.needsConfirm, false);
  assert.equal((again.text.match(/사업명/g) ?? []).length, 1);
});

test("블록 뒤에 사용자가 글을 덧붙였으면 블록만 바꾸지 않고 이어 붙이기로 넘긴다", () => {
  const block = "사업명: A";
  const merged = mergeDigestIntoText({ existing: `${block}\n내가 덧붙인 글`, block: "사업명: B", previousBlock: block });
  assert.equal(merged.mode, "append");
  assert.equal(merged.needsConfirm, true);
  assert.match(merged.text, /내가 덧붙인 글/);
});

/* ── ⑤ 사업 간 격리 ───────────────────────────────────────── */

test("사업이 다르면 불러오는 글과 지문이 다르다 — 한 사업 값이 다른 사업으로 새지 않는다", () => {
  const a = buildProjectDataText({ meta: META, plan: makePlan(), work: makeWork("p1"), project: PROJECT });
  const b = buildProjectDataText({
    meta: { id: "p2", name: "다른 사업", ownerName: "" },
    plan: makePlan({ programName: "2027 마을 활동가 양성", agency: "다른 기관" }),
    work: createEmptyProjectWork("p2"),
    project: { projectName: "다른 사업" }
  });
  assert.notEqual(textSignature(a.text), textSignature(b.text));
  assert.doesNotMatch(b.text, /양양군농촌활성화지원센터/);
  assert.doesNotMatch(b.text, /오리엔테이션/);
  assert.match(b.text, /^사업명: 2027 마을 활동가 양성$/m);
  assert.equal(projectDataSignature({ meta: META, plan: makePlan(), work: makeWork("p1"), project: PROJECT }), textSignature(a.text));
});

test("사업 데이터를 고치면 지문이 달라져 ‘최신 값으로 다시 불러오기’를 알 수 있다", () => {
  const before = projectDataSignature({ meta: META, plan: makePlan(), work: makeWork(), project: PROJECT });
  const after = projectDataSignature({
    meta: META,
    plan: makePlan({ budgetLines: [{ id: "b1", category: "인건비", item: "외래강사비", unitCost: "300000", quantity: "4", basis: "300,000원 × 4회", note: "" }] }),
    work: makeWork(),
    project: PROJECT
  });
  assert.notEqual(before, after);
});

/* ── ⑥ 양식 칸으로 배치 ───────────────────────────────────── */

test("불러온 글은 양식 칸 이름과 맞는 칸에 높은 점수로 배치된다", () => {
  const schema = parseSampleTemplate({ text: PRACTICE_TEMPLATE_TEXT, blocks: [], fileName: "연습양식.md", format: "markdown" });
  const fields = extractFormFields(schema);
  const digest = buildProjectDataText({ meta: META, plan: makePlan(), work: makeWork(), project: PROJECT });
  const mapped = mapFreeTextToFields({ fields, text: digest.text });

  const byLabel = new Map(mapped.rows.map((row) => [row.label, row]));
  assert.equal(byLabel.get("사업명")?.proposed, "2026 양양 관광두레 플러스");
  assert.equal(byLabel.get("수행기관")?.proposed, "양양군농촌활성화지원센터");
  assert.match(byLabel.get("총사업비")?.proposed ?? "", new RegExp(formatWon(budgetSummary(makePlan()).total).replace(/[()]/g, "\\$&")));
  assert.match(byLabel.get("지역 현황")?.proposed ?? "", /빈집 120채/);
  assert.match(byLabel.get("인건비")?.proposed ?? "", /외래강사비/);
  // 여러 곳의 글이 한 칸에 모이면 점수가 높아도 사람이 확인하도록 표시된다.
  for (const row of mapped.rows) {
    if (row.segments.length > 1) assert.equal(row.merged, true, `${row.label}은(는) merged 여야 한다`);
  }
});

test("날짜·금액 칸은 값 하나만 받는다 — 겹치는 일정·마감 값은 배치 못한 글로 남긴다", () => {
  const schema = parseSampleTemplate({ text: PRACTICE_TEMPLATE_TEXT, blocks: [], fileName: "연습양식.md", format: "markdown" });
  const fields = extractFormFields(schema);
  const digest = buildProjectDataText({ meta: META, plan: makePlan(), work: makeWork(), project: PROJECT });
  const mapped = mapFreeTextToFields({ fields, text: digest.text });
  const byLabel = new Map(mapped.rows.map((row) => [row.label, row]));

  // 사업기간(날짜)·총사업비(금액) 칸은 두 줄이 되지 않는다.
  assert.equal(byLabel.get("사업기간").proposed, "2026. 3. 1. ~ 2026. 11. 30.");
  const money = byLabel.get("총사업비").proposed;
  assert.doesNotMatch(money, /\n/);
  assert.match(money, /^1,200,000원/);
  // 결과보고 마감은 날짜 칸에 섞이지 않고 ‘평가·보고’ 같은 다른 칸에 낮은 점수(확인 필요)로 가거나 남는다.
  const deadlineJoined = mapped.rows.some((row) => /2026\. 12\. 15\./.test(row.proposed));
  const deadlineLeft = mapped.leftovers.some((item) => /2026\. 12\. 15\./.test(item.text));
  assert.ok(deadlineJoined || deadlineLeft, "마감 날짜가 어디에도 남지 않았습니다");
  assert.doesNotMatch(mapped.rows.find((row) => row.label === "사업기간").proposed, /12\. 15/);
});

test("불러오기 설명에는 불러온 시각·항목 수·비어 있는 항목이 담긴다", () => {
  const digest = buildProjectDataText({ meta: META, plan: makePlan(), work: makeWork(), project: PROJECT });
  const note = digestLoadedNote({ loadedAt: "2026-11-16T01:54:00.000Z", counts: digest.counts, missing: digest.missing });
  assert.match(note, /이 사업에서 불러옴/);
  assert.match(note, /회차 3개/);
  assert.match(note, /지출 1건/);
});
