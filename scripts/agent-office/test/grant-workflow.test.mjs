import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyPreset,
  budgetSummary,
  checklistSummary,
  createEmptyGrantPlan,
  dDayLabel,
  daysUntil,
  emptyBudgetLine,
  formatWon,
  groupChecklist,
  hasGrantWork,
  lineAmount,
  parseAmount,
  parseQuantity,
  pendingFollowUps,
  reportSummary,
  sanitizeGrantPlan,
  splitFunding
} from "../../../src/lib/grantWorkflow.mjs";

const presets = JSON.parse(await readFile(new URL("../../../src/data/grantPresets.json", import.meta.url), "utf8")).presets;
const standard = presets.find((preset) => preset.id === "national-subsidy-standard");

test("금액·수량 표기를 숫자로 읽는다", () => {
  assert.equal(parseAmount("250,000원"), 250000);
  assert.equal(parseAmount("25만원"), 250000);
  assert.equal(parseAmount(3200), 3200);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseQuantity("8회"), 8);
  assert.equal(parseQuantity("2.5"), 2.5);
  assert.equal(parseQuantity(""), 0);
  assert.equal(formatWon(1234567), "1,234,567원");
  assert.equal(lineAmount({ unitCost: "250,000원", quantity: "8회" }), 2000000);
});

test("예산 합계·비목 비중·재원 구성을 계산한다", () => {
  const plan = {
    ...createEmptyGrantPlan(),
    subsidyRate: "70",
    localRate: "20",
    selfRate: "10",
    budgetLines: [
      { ...emptyBudgetLine("a"), category: "인건비", item: "강사비", unitCost: "250000", quantity: "8" },
      { ...emptyBudgetLine("b"), category: "운영비", item: "재료비", unitCost: "30000", quantity: "40" }
    ]
  };
  const summary = budgetSummary(plan);
  assert.equal(summary.total, 3200000);
  assert.equal(summary.lineCount, 2);
  assert.deepEqual(summary.byCategory.map((entry) => [entry.category, entry.total]), [["인건비", 2000000], ["운영비", 1200000]]);
  assert.equal(summary.byCategory[0].share, 62.5);
  assert.equal(summary.funding.subsidy, 2240000);
  assert.equal(summary.funding.local, 640000);
  assert.equal(summary.funding.self, 320000);
  assert.equal(summary.funding.rateMismatch, false);
});

test("비율 합이 100이 아니면 자부담을 잔액으로 두고 표시한다", () => {
  const funding = splitFunding(1000000, { subsidyRate: "80", localRate: "0", selfRate: "0" });
  assert.equal(funding.subsidy, 800000);
  assert.equal(funding.self, 200000);
  assert.equal(funding.rateMismatch, true);
  assert.equal(funding.rateSum, 80);
});

test("프리셋을 적용하면 구조가 채워지고 같은 항목의 진행 상태가 유지된다", () => {
  const applied = applyPreset(standard, createEmptyGrantPlan());
  assert.equal(applied.presetId, standard.id);
  assert.equal(applied.budgetLines.length, standard.budgetLines.length);
  assert.equal(applied.checklist.length, standard.checklist.length);
  assert.equal(applied.reportSections.length, standard.reportSections.length);
  assert.equal(applied.programName, standard.name);
  assert.equal(applied.fundingYear, "");

  const worked = {
    ...applied,
    programName: "2026 양양 두레동아리",
    fundingYear: "2026",
    schedule: { ...applied.schedule, reportDeadline: "2026-12-10" },
    budgetLines: applied.budgetLines.map((line, index) => (index === 0 ? { ...line, unitCost: "300000" } : line)),
    checklist: applied.checklist.map((item, index) => (index === 0 ? { ...item, checked: true, note: "교부 결정서 사무국 보관" } : item)),
    reportSections: applied.reportSections.map((section, index) => (index === 0 ? { ...section, content: "지역 활력 저하" } : section))
  };

  const reapplied = applyPreset(standard, worked);
  assert.equal(reapplied.checklist[0].checked, true);
  assert.equal(reapplied.checklist[0].note, "교부 결정서 사무국 보관");
  assert.equal(reapplied.reportSections[0].content, "지역 활력 저하");
  assert.equal(reapplied.programName, "2026 양양 두레동아리");
  assert.equal(reapplied.fundingYear, "2026");
  assert.equal(reapplied.schedule.reportDeadline, "2026-12-10");
  // 금액은 프리셋 기준으로 다시 잡는다.
  assert.equal(reapplied.budgetLines[0].unitCost, standard.budgetLines[0].unitCost);

  const contest = presets.find((preset) => preset.id === "contest-grant");
  const switched = applyPreset(contest, reapplied);
  assert.equal(switched.presetId, contest.id);
  // 같은 비목·세목이 없으면 새 구조만 남고, 다른 항목의 상태는 섞이지 않는다.
  assert.equal(switched.checklist.some((item) => item.note === "교부 결정서 사무국 보관"), false);
  assert.equal(switched.programName, "2026 양양 두레동아리");
});

test("프리셋 JSON은 실무에 필요한 항목을 갖추고 id가 겹치지 않는다", () => {
  assert.ok(presets.length >= 3);
  const ids = new Set();
  presets.forEach((preset) => {
    assert.ok(preset.id && !ids.has(preset.id));
    ids.add(preset.id);
    assert.ok(preset.name.length > 0);
    assert.ok(preset.budgetLines.length >= 5);
    assert.ok(preset.checklist.length >= 10);
    assert.ok(preset.reportSections.length >= 5);
    const rateSum = Number(preset.subsidyRate) + Number(preset.localRate) + Number(preset.selfRate);
    assert.equal(rateSum, 100, `${preset.id} 재원 비율 합이 100이어야 한다`);
    preset.budgetLines.forEach((line) => {
      assert.ok(line.category && line.item && line.unitCost && line.quantity && line.basis);
      assert.ok(parseAmount(line.unitCost) > 0);
    });
    preset.checklist.forEach((item) => {
      assert.ok(item.group && item.label && typeof item.required === "boolean");
    });
  });
  const titles = standard.reportSections.map((section) => section.title);
  assert.ok(titles.includes("추진배경"));
  assert.ok(titles.includes("예산집행결과"));
});

test("체크리스트 진행률과 남은 필수 항목을 계산한다", () => {
  const plan = applyPreset(standard, createEmptyGrantPlan());
  plan.checklist[0].checked = true;
  const summary = checklistSummary(plan);
  assert.equal(summary.done, 1);
  assert.equal(summary.percent, Math.round((1 / plan.checklist.length) * 100));
  assert.equal(summary.requiredMissing.length, summary.requiredTotal - (plan.checklist[0].required ? 1 : 0));
  const groups = groupChecklist(plan);
  assert.equal(groups[0].title, plan.checklist[0].group);
  assert.equal(groups.reduce((count, group) => count + group.items.length, 0), plan.checklist.length);
});

test("저장값은 허용 목록으로만 복원하고 알 수 없는 필드는 버린다", () => {
  const saved = {
    schemaVersion: 3,
    presetId: "national-subsidy-standard",
    programName: "  두레동아리  ",
    fundingYear: "2026년",
    subsidyRate: "70%",
    apiKey: "tl-should-not-survive",
    budgetLines: [{ id: "x", category: "인건비", item: "강사비", unitCost: "250000", quantity: "8", basis: "8회", note: "", token: "nope" }],
    checklist: [{ id: "c", group: "기본", label: "교부 결정서", required: true, checked: true, apiKey: "nope" }],
    reportSections: [{ id: "r", title: "추진배경", content: "내용" }],
    schedule: { reportDeadline: "2026-12-10", extra: "x" },
    unknown: { nested: true }
  };
  const plan = sanitizeGrantPlan(saved);
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes("should-not-survive"), false);
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal(serialized.includes("token"), false);
  assert.equal(serialized.includes("nested"), false);
  assert.equal(plan.programName, "두레동아리");
  assert.equal(plan.fundingYear, "2026");
  assert.equal(plan.subsidyRate, "70");
  assert.equal(plan.budgetLines.length, 1);
  assert.equal(plan.checklist[0].checked, true);
  assert.equal(plan.schedule.reportDeadline, "2026-12-10");
  assert.equal("extra" in plan.schedule, false);
});

test("빈 값·잘못된 값도 화면에서 쓸 수 있는 기본형으로 돌려준다", () => {
  const plan = sanitizeGrantPlan(null);
  assert.equal(plan.presetId, "");
  assert.deepEqual(plan.budgetLines, []);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(hasGrantWork(plan), false);
  assert.equal(budgetSummary(plan).total, 0);
  assert.equal(reportSummary(plan).percent, 0);
});

test("마감일 D-day와 후속 할 일을 만든다", () => {
  const now = new Date("2026-11-15T09:00:00+09:00");
  assert.equal(daysUntil("2026-11-18", now), 3);
  assert.equal(daysUntil("2026-11-15", now), 0);
  assert.equal(daysUntil("2026-11-10", now), -5);
  assert.equal(daysUntil("11/18", now), null);
  assert.equal(dDayLabel("2026-11-18", now), "D-3");
  assert.equal(dDayLabel("2026-11-15", now), "D-day");
  assert.equal(dDayLabel("2026-11-10", now), "D+5 (지남)");

  const plan = applyPreset(standard, createEmptyGrantPlan());
  plan.schedule.reportDeadline = "2026-11-20";
  plan.schedule.settlementDeadline = "2027-03-01";
  const followUps = pendingFollowUps(plan, now);
  assert.equal(followUps[0].kind, "일정");
  assert.match(followUps[0].label, /결과보고 마감/);
  assert.ok(followUps.some((item) => item.kind === "증빙"));
  assert.ok(followUps.some((item) => item.kind === "보고서"));
});

test("사업 흐름 4단계 진행률을 같은 순서로 계산한다", async () => {
  const { GRANT_STEPS, grantProgress } = await import("../../../src/lib/grantWorkflow.mjs");
  assert.deepEqual(GRANT_STEPS.map((step) => step.id), ["budget", "checklist", "report", "export"]);

  const empty = grantProgress(createEmptyGrantPlan());
  assert.equal(empty.overall, 0);
  assert.equal(empty.steps.length, 4);
  assert.ok(empty.steps.every((step) => step.percent === 0));

  const plan = applyPreset(standard, createEmptyGrantPlan());
  const applied = grantProgress(plan);
  // 프리셋은 비목·세목·단가·수량을 모두 채우므로 예산 단계는 100%다.
  assert.equal(applied.steps[0].percent, 100);
  assert.ok(applied.total > 0);
  assert.equal(applied.steps[1].percent, 0);

  plan.checklist = plan.checklist.map((item, index) => ({ ...item, checked: index < 5 }));
  plan.reportSections = plan.reportSections.map((section, index) => (index === 0 ? { ...section, content: "초안" } : section));
  const worked = grantProgress(plan);
  assert.ok(worked.steps[1].percent > 0);
  assert.ok(worked.steps[2].percent > 0);
  assert.equal(worked.steps[3].percent, worked.overall);
  assert.ok(worked.overall > 0 && worked.overall < 100);

  // 빈 행만 늘리면 예산 진행률이 오르지 않는다.
  plan.budgetLines = [...plan.budgetLines, emptyBudgetLine("blank-1")];
  assert.ok(grantProgress(plan).steps[0].percent < 100);
});
