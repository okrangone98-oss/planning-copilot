import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildNotionPasteMarkdown, buildWorkbrainFileName, buildWorkbrainMarkdown, WORKSPACE_LINKS } from "../../../src/lib/davidWorkbrainExport.mjs";
import { applyPreset, budgetSummary, createEmptyGrantPlan } from "../../../src/lib/grantWorkflow.mjs";

const presets = JSON.parse(await readFile(new URL("../../../src/data/grantPresets.json", import.meta.url), "utf8")).presets;
const standard = presets.find((preset) => preset.id === "national-subsidy-standard");
const now = new Date("2026-11-15T09:00:00+09:00");

function preparedPlan() {
  const plan = applyPreset(standard, createEmptyGrantPlan());
  plan.programName = "2026 양양 두레동아리 활동지원";
  plan.fundingYear = "2026";
  plan.schedule.reportDeadline = "2026-11-20";
  plan.schedule.settlementDeadline = "2027-02-28";
  plan.checklist[0].checked = true;
  plan.reportSections[0].content = "지역 활동가의 활동 기반이 얇아 동아리 운영이 한 해로 끊긴다.";
  return plan;
}

test("david-workbrain 폴더에 그대로 넣을 수 있는 frontmatter를 만든다", () => {
  const markdown = buildWorkbrainMarkdown({ plan: preparedPlan(), project: {}, options: { targetFolder: "01_회사_사업" }, now });
  assert.match(markdown, /^---\n/);
  const frontmatter = markdown.slice(4, markdown.indexOf("\n---\n", 4));
  ["type: project", "resource: planning_copilot", "domain: company", "agent_ready: true", "sensitive_handling:", "tags: [", "timestamp:", "exported_by: planning-copilot"].forEach((line) => {
    assert.ok(frontmatter.includes(line), `${line} 누락`);
  });
  assert.match(frontmatter, /source_path: "01_회사_사업\/2026-양양-두레동아리-활동지원_예산정산결과보고_2026-11-15\.md"/);
  assert.match(frontmatter, /budget_total: 24180000/);
  assert.match(frontmatter, /deadline: "2026-11-20"/);
  assert.match(markdown, /# 2026 양양 두레동아리 활동지원/);
});

test("메타데이터·일정·예산·체크리스트·후속 할 일 섹션이 한 문서에 들어간다", () => {
  const plan = preparedPlan();
  const markdown = buildWorkbrainMarkdown({ plan, project: { draftOutput: "# 초안\n내용", jiraUrl: "https://jira.example/1" }, options: { includeDraft: true }, now });
  ["## 1. 메타데이터", "## 2. 추진 일정·마감일 요약", "## 3. 예산 편성표", "## 4. 정산 증빙 체크리스트", "## 5. 결과보고서 초안", "## 6. 사업계획서 초안", "## 7. 후속 할 일", "## 8. 연결"].forEach((heading) => {
    assert.ok(markdown.includes(heading), `${heading} 누락`);
  });
  assert.match(markdown, /결과보고 마감 \| 2026-11-20 \| D-5/);
  assert.match(markdown, /- \[x\] 보조금 교부 결정서 사본/);
  assert.match(markdown, /- \[ \] 확정 사업계획서와 사업비 집행계획/);
  assert.match(markdown, /지역 활동가의 활동 기반이 얇아/);
  assert.match(markdown, /합계 \| - \| - \| - \| 24,180,000원/);
  const summary = budgetSummary(plan);
  assert.equal(summary.total, 24180000);
  assert.ok(markdown.includes("my-workbench: https://okrangone98-oss.github.io/my-workbench/"));
  assert.ok(markdown.includes("Jira: https://jira.example/1"));
  assert.match(markdown, /- \[ \] \[증빙\]/);
});

test("포함 범위를 끄면 해당 섹션이 빠진다", () => {
  const markdown = buildWorkbrainMarkdown({
    plan: preparedPlan(),
    project: {},
    options: { includeBudget: false, includeChecklist: false, includeReport: false, includeFollowUps: false },
    now
  });
  assert.equal(markdown.includes("## 3. 예산 편성표"), false);
  assert.equal(markdown.includes("정산 증빙 체크리스트"), false);
  assert.equal(markdown.includes("결과보고서 초안"), false);
  assert.equal(markdown.includes("후속 할 일"), false);
  assert.ok(markdown.includes("## 3. 연결"));
});

test("원본 증빙이나 API 키 같은 값은 문서에 담지 않는다", () => {
  const plan = preparedPlan();
  plan.apiKey = "tl-should-not-survive";
  plan.budgetLines[0].secret = "tl-should-not-survive";
  const markdown = buildWorkbrainMarkdown({ plan, project: {}, options: { includeDraft: false }, now });
  assert.equal(markdown.includes("should-not-survive"), false);
});

test("파일 이름은 사업명과 작성일로 만든다", () => {
  assert.equal(
    buildWorkbrainFileName({ programName: "2026 양양 두레동아리/활동지원" }, now),
    "2026-양양-두레동아리-활동지원_예산정산결과보고_2026-11-15.md"
  );
  assert.equal(buildWorkbrainFileName({}, now), "국고보조사업_예산정산결과보고_2026-11-15.md");
});

test("Notion 붙여넣기용으로는 frontmatter를 코드블록으로 옮긴다", () => {
  const markdown = buildWorkbrainMarkdown({ plan: preparedPlan(), project: {}, now });
  const pasted = buildNotionPasteMarkdown(markdown);
  assert.equal(pasted.startsWith("---"), false);
  assert.match(pasted, /```yaml\n/);
  assert.match(pasted, /## 속성\(YAML frontmatter\)/);
});

test("워크스페이스 링크는 my-workbench와 david-workbrain을 함께 안내한다", () => {
  assert.deepEqual(WORKSPACE_LINKS.map((link) => link.url), [
    "https://okrangone98-oss.github.io/my-workbench/",
    "https://github.com/okrangone98-oss/david-workbrain"
  ]);
});
