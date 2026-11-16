import type { ProjectData } from "../types";
import { buildMermaid } from "./visuals";

function bullets(text: string) {
  if (!text) return "- 보완 필요";
  return text
    .split(/\n|\. /)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item.replace(/\.$/, "")}`)
    .join("\n");
}

function tableToMarkdown(title: string, headers: string[], rows: string[][]) {
  const cleanRows = rows.filter((row) => row.some(Boolean));
  if (!cleanRows.length) return `## ${title}\n\n보완 필요`;
  const headerLine = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = cleanRows.map((row) => `| ${row.map((cell) => cell || "보완 필요").join(" | ")} |`).join("\n");
  return `## ${title}\n\n${headerLine}\n${divider}\n${body}`;
}

export function generateDraftText(project: ProjectData) {
  const title = project.projectName || "사업계획서 초안";
  return `# ${title}

## 1. 공고 해석

### 정책 목적
${bullets(project.policyGoal)}

### 평가 포인트
${bullets(project.evaluationFocus)}

### 필수 조건과 차별화 기회
${bullets([project.requirements, project.advantageSignals].filter(Boolean).join("\n"))}

## 2. 공동기획 질문과 작성 전략

### 분석 메모
${bullets(project.agentMemo)}

### 다음 질문
${bullets(project.nextQuestions)}

### 작성 전략과 부족한 근거
${bullets([project.writingStrategy, project.missingEvidence].filter(Boolean).join("\n"))}

## 3. 외부 작업공간 연결

- Jira: ${project.jiraUrl || "연결 전"}
- Notion: ${project.notionUrl || "연결 전"}
- Google Sheet: ${project.spreadsheetUrl || "연결 전"}
- Google Drive: ${project.driveFolderUrl || "연결 전"}

${bullets(project.integrationMemo)}

## 4. AI 답변 반영 메모

${bullets(project.aiSynthesis)}

## 5. 샘플 분해에서 가져올 구조

### 참고 문서/출처
${bullets(project.sampleSource)}

### 좋은 구조와 평가 신호
${bullets([project.sampleStructure, project.sampleSignals].filter(Boolean).join("\n"))}

### 우리 사업에 적용할 방식
${bullets(project.sampleAdaptation)}

## 6. 사업 아이디어

### 핵심 아이디어
${bullets(project.coreIdea)}

### 대상자와 현장 근거
${bullets([project.targetUsers, project.fieldEvidence].filter(Boolean).join("\n"))}

### 작성자의 고유 관점
${bullets(project.founderInsight)}

## 7. 문제정의

### 문제 상황
${bullets(project.problemSituation)}

### 원인과 기존 해결책의 한계
${bullets([project.rootCauses, project.existingLimits].filter(Boolean).join("\n"))}

### 지금 필요한 이유
${bullets(project.whyNow)}

## 8. 논리모형

| 구분 | 내용 |
| --- | --- |
| 투입 | ${project.inputs || "보완 필요"} |
| 활동 | ${project.activities || "보완 필요"} |
| 산출 | ${project.outputs || "보완 필요"} |
| 단기성과 | ${project.shortOutcomes || "보완 필요"} |
| 중장기성과 | ${project.longOutcomes || "보완 필요"} |

## 9. 시각자료 초안

\`\`\`mermaid
${project.visualMermaid || buildMermaid(project)}
\`\`\`

${tableToMarkdown("10. 성과지표", ["구분", "지표명", "목표값", "측정 방법"], project.metricsTable || [])}

## 11. 실행설계

### 추진 단계
${bullets(project.milestones)}

### 추진 체계
${bullets(project.teamSystem)}

### 예산 설계
${bullets(project.budgetPlan)}

### 위험 대응
${bullets(project.riskPlan)}

${tableToMarkdown("12. 서비스 블루프린트", ["단계", "사용자 행동", "접점", "운영 방식", "실패 가능성"], project.blueprintTable || [])}

## 13. 제출 전 보완 질문

- 공고의 실제 평가표에서 가장 높은 배점 항목은 무엇인가?
- 대상자의 문제를 증명할 정량 또는 정성 근거는 충분한가?
- 신청자의 고유한 실행 경험은 문장 안에 드러나는가?
- 성과지표의 측정 시점과 증빙 자료는 명확한가?
`;
}
