import type { ProjectData } from "../types";
import { projectSearchQuery, searchKnowledgeDocs, formatKnowledgeResults } from "./analysis";
import type { KnowledgeDoc } from "../types";

function compactSection(title: string, value: string) {
  return `## ${title}\n${value && value.trim() ? value.trim() : "아직 입력하지 않음"}`;
}

export function buildModelPrompt(project: ProjectData, docs: KnowledgeDoc[]) {
  const ragResults = project.ragResults || formatKnowledgeResults(searchKnowledgeDocs(docs, projectSearchQuery(project)));
  return `당신은 정부지원사업 사업계획서 전문 공동기획자입니다. 아래 자료를 평가자 관점으로 분석하고, 사용자의 아이디어가 사라지지 않도록 사업계획서로 발전시켜 주세요.

답변은 반드시 다음 형식으로 작성해 주세요.

1. 공고 해석
- 이 공고가 실제로 원하는 것
- 가장 중요한 평가 신호
- 탈락 위험이 있는 빈틈

2. 공동기획 질문
- 사용자에게 추가로 물어봐야 할 질문 10개
- 각 질문이 필요한 이유

3. 사업계획서 전략
- 문제정의 방향
- 추진전략 방향
- 수행역량 강조 방식
- 성과지표와 파급효과 설계

4. 바로 쓸 수 있는 문장
- 사업 필요성 문장 3개
- 차별성 문장 3개
- 기대효과 문장 3개

5. 보완 자료 체크리스트
- 제출 전 모아야 할 근거자료
- 예산, 성과, 협력 관련 증빙

주의사항:
- 공고문에 없는 사실은 단정하지 마세요.
- 사용자의 아이디어를 일반적인 문장으로 희석하지 마세요.
- 결과는 한국어 사업계획서 문체로 작성하세요.

${compactSection("공고문", project.noticeText)}

${compactSection("내 사례에서 찾은 참고 내용", ragResults)}

${compactSection("정책 목적", project.policyGoal)}

${compactSection("평가 포인트", project.evaluationFocus)}

${compactSection("필수 조건", project.requirements)}

${compactSection("차별화 기회", project.advantageSignals)}

${compactSection("사용자의 핵심 아이디어", project.coreIdea)}

${compactSection("대상자", project.targetUsers)}

${compactSection("현장 근거", project.fieldEvidence)}

${compactSection("작성자의 고유 관점", project.founderInsight)}

${compactSection("현재 문제정의", [project.problemSituation, project.rootCauses, project.existingLimits, project.whyNow].filter(Boolean).join("\n"))}

${compactSection("현재 실행설계", [project.milestones, project.teamSystem, project.budgetPlan, project.riskPlan].filter(Boolean).join("\n"))}`;
}

export function absorbModelResponse(response: string) {
  return [
    "AI 답변 요약",
    response.slice(0, 4000),
    "",
    "반영 기준",
    "- 공고문과 충돌하는 내용은 제외한다.",
    "- 사용자의 현장 경험과 고유 관점이 드러나는 문장을 우선 반영한다.",
    "- 평가항목, 배점, 제출양식과 직접 연결되는 내용부터 초안에 적용한다."
  ].join("\n");
}
