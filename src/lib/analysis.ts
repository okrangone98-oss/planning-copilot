import type { KnowledgeDoc, ProjectData } from "../types";

export function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。])\s+|(?=\d+\s*[.)]\s)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 8);
}

export function findSentences(text: string, keywords: string[], limit = 5) {
  return splitSentences(text)
    .filter((sentence) => keywords.some((keyword) => sentence.includes(keyword)))
    .slice(0, limit)
    .join("\n");
}

export function analyzeNotice(project: ProjectData): Partial<ProjectData> {
  const text = project.noticeText;
  const dates = text.match(/\d{4}[.\-/년]\s?\d{1,2}([.\-/월]\s?\d{0,2})?|마감|접수|신청기간/g) || [];
  const amounts = text.match(/\d+\s?(억|만원|천원|%|개사|명|건)|최대\s?\d+\s?(억|만원|천원)/g) || [];
  const scores = text.match(/[^.\n]*(평가|배점|추진전략|수행역량|파급효과|성과)[^.\n]*/g) || [];

  const requirements = [
    findSentences(text, ["신청", "접수", "제출", "서류", "자격", "대상", "제외", "필수"], 7),
    dates.length ? `주요 일정/조건: ${[...new Set(dates)].slice(0, 8).join(", ")}` : "",
    amounts.length ? `숫자 조건: ${[...new Set(amounts)].slice(0, 8).join(", ")}` : ""
  ].filter(Boolean).join("\n");

  return {
    policyGoal: findSentences(text, ["목적", "취지", "지원", "해결", "혁신", "성장", "확산"], 4) || "공고문의 정책 목적을 추가 확인해야 합니다.",
    evaluationFocus: [
      findSentences(text, ["평가", "배점", "추진전략", "수행역량", "파급효과", "성과"], 6),
      [...new Set(scores.map((item) => item.trim()))].slice(0, 6).join("\n")
    ].filter(Boolean).join("\n") || "평가항목과 배점을 추가 확인해야 합니다.",
    requirements: requirements || "자격, 제출서류, 마감일을 추가 확인해야 합니다.",
    advantageSignals: findSentences(text, ["우대", "가점", "추천", "협력", "성과", "확산", "브랜드", "지역"], 5) || "우대조건과 차별화 신호를 추가 확인해야 합니다."
  };
}

export function generateCoaching(project: ProjectData): Partial<ProjectData> {
  const scoreHint = project.evaluationFocus || "평가 포인트";
  const policyHint = project.policyGoal || "정책 목적";
  const ideaHint = project.coreIdea || "사용자의 핵심 아이디어";
  return {
    agentMemo: [
      `이 공고는 ${policyHint}에 맞춰 답해야 합니다.`,
      `작성의 중심은 ${scoreHint}에 대응하는 근거를 만드는 것입니다.`,
      `아이디어는 '${ideaHint}' 자체보다 왜 필요하고, 어떻게 실행하며, 어떤 성과로 증명하는지가 중요합니다.`
    ].join("\n"),
    nextQuestions: [
      "1. 이 사업의 대상자는 누구이며, 지금 가장 크게 겪는 불편은 무엇인가요?",
      "2. 그 불편이 개인 문제가 아니라 지역, 시장, 정책 문제라는 근거는 무엇인가요?",
      "3. 기존 사업이나 서비스는 왜 충분하지 않았나요?",
      "4. 공고의 가장 중요한 평가항목에 대응하는 실행계획은 무엇인가요?",
      "5. 신청자가 이미 보유한 경험, 협력망, 자원, 실적은 무엇인가요?",
      "6. 3개월, 6개월, 종료 시점에 무엇이 달라졌다고 증명할 수 있나요?"
    ].join("\n"),
    writingStrategy: [
      "문제정의: 대상자의 불편과 정책 목적을 한 문단 안에서 연결합니다.",
      "실행계획: 활동 목록보다 일정, 역할, 예산 근거를 먼저 보여줍니다.",
      "추진역량: 사람, 경험, 협력망, 보유자원을 역할별로 배치합니다.",
      "성과관리: 참여자 수, 만족도, 후속 참여, 확산 가능성처럼 측정 가능한 지표로 씁니다."
    ].join("\n"),
    missingEvidence: [
      "대상자 인터뷰 또는 실제 불편 사례",
      "시장 규모, 지역 데이터, 검색량, 기존 수요 자료",
      "시제품, 사진, 운영 흐름, 사용자 여정 자료",
      "협력기관, 공급업체, 전문가, 지역 파트너의 역할 증빙",
      "예산 산출 근거와 견적 자료",
      "성과지표별 측정 방법과 증빙 자료"
    ].join("\n")
  };
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function termVector(text: string) {
  return tokenize(text).reduce<Record<string, number>>((vector, token) => {
    vector[token] = (vector[token] || 0) + 1;
    return vector;
  }, {});
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  Object.keys(a).forEach((key) => {
    normA += a[key] * a[key];
    if (b[key]) dot += a[key] * b[key];
  });
  Object.keys(b).forEach((key) => {
    normB += b[key] * b[key];
  });
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function chunkText(text: string, size = 900, overlap = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const chunk = clean.slice(start, start + size).trim();
    if (chunk.length > 80) chunks.push(chunk);
  }
  return chunks;
}

export function projectSearchQuery(project: ProjectData) {
  return [
    project.ragQuery,
    project.noticeText,
    project.evaluationFocus,
    project.policyGoal,
    project.coreIdea,
    project.problemSituation,
    project.writingStrategy
  ].filter(Boolean).join("\n");
}

export function searchKnowledgeDocs(docs: KnowledgeDoc[], query: string, limit = 6) {
  const queryVector = termVector(query);
  const scored: Array<KnowledgeDoc & { chunk: string; chunkIndex: number; score: number }> = [];
  docs.forEach((doc) => {
    chunkText(doc.text).forEach((chunk, index) => {
      const score = cosineSimilarity(queryVector, termVector(`${doc.title} ${doc.type} ${chunk}`));
      if (score > 0) scored.push({ ...doc, chunk, chunkIndex: index + 1, score });
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function formatKnowledgeResults(results: ReturnType<typeof searchKnowledgeDocs>) {
  if (!results.length) return "관련 사례를 찾지 못했습니다. 좋은 사업계획서나 비슷한 공고를 더 추가해 주세요.";
  return results
    .map((result, index) => {
      const score = Math.round(result.score * 1000) / 1000;
      return `### 참고 ${index + 1}. ${result.title} (${result.type || "문서"}, 유사도 ${score})\n${result.chunk}`;
    })
    .join("\n\n");
}
