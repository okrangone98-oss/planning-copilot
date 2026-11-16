import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficeContext, buildOfficeModelPrompt } from "../../../src/lib/agentOfficePrompt.mjs";

test("office context includes selected project fields and at most three matched sources", () => {
  const context = buildOfficeContext(
    { projectName: "두레동아리", noticeText: "공고문 내용", jiraUrl: "https://private.example/task", integrationMemo: "비공개" },
    Array.from({ length: 4 }, (_, index) => ({ title: `사례 ${index + 1}`, type: "사례", chunk: `자료 ${index + 1}` }))
  );

  assert.match(context.text, /두레동아리/);
  assert.match(context.text, /공고문 내용/);
  assert.doesNotMatch(context.text, /private\.example|비공개/);
  assert.equal(context.sourceLabels.filter((label) => label.startsWith("저장 자료:")).length, 3);
});

test("office context labels truncation and prompt asks for evidence-grounded output", () => {
  const context = buildOfficeContext({ noticeText: "가".repeat(4000) }, [{ title: "공식자료", chunk: "지원 대상은 지역 주민이다." }]);
  const prompt = buildOfficeModelPrompt({
    command: "사업 초안을 작성해줘",
    tasks: [{ agentId: "research", title: "조사", input: "사례를 확인" }],
    context
  });

  assert.equal(context.truncated, true);
  assert.ok(context.characterCount <= 12000);
  assert.match(prompt, /\[자료: 자료 이름\]/);
  assert.match(prompt, /\[확인 필요\]/);
  assert.match(prompt, /병렬로 실행한 결과가 아닙니다/);
});

test("long grant text keeps the idea, schedule, and budget in the bounded context", () => {
  const context = buildOfficeContext({
    noticeText: "공고".repeat(5000),
    policyGoal: "정책".repeat(1000),
    evaluationFocus: "평가".repeat(1000),
    requirements: "요건".repeat(1000),
    advantageSignals: "강점".repeat(1000),
    coreIdea: "주민 워크숍 운영",
    milestones: "11월 첫째 주 실행",
    budgetPlan: "강사비와 운영비 확인"
  }, [{ title: "긴 사례 제목".repeat(500), type: "사례".repeat(500), chunk: "자료".repeat(5000) }]);
  assert.match(context.text, /주민 워크숍 운영/);
  assert.match(context.text, /11월 첫째 주 실행/);
  assert.match(context.text, /강사비와 운영비 확인/);
  assert.equal(context.characterCount, context.text.length);
  assert.ok(context.characterCount <= 12000);
});
