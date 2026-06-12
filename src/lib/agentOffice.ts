import { agentRoles, getAgentRole } from "../data/agentRoles";
import type { AgentDraft, AgentId, AgentTask, MorningReport, OfficeResult } from "../types";

type OfficeMode = "simulation" | "llm";

type OfficeRunOptions = {
  createdAt?: string;
  mode?: OfficeMode;
};

const workAgentIds: AgentId[] = ["local-planning", "research", "content", "admin-doc", "email-draft"];

const agentTriggerKeywords: Record<AgentId, string[]> = {
  chief: ["명령", "분배", "보고"],
  "local-planning": ["기획", "사업", "공모", "계획", "성과", "예산", "프로그램"],
  research: ["조사", "자료", "사례", "정책", "트렌드", "시장", "공모"],
  content: ["콘텐츠", "블로그", "홍보", "인스타", "릴스", "뉴스레터", "카드뉴스"],
  "admin-doc": ["공문", "행정", "보고서", "회의록", "안내문", "결과보고"],
  "email-draft": ["메일", "이메일", "섭외", "제안", "협조", "연락"],
  review: ["검토", "수정", "확인", "품질"]
};

const fallbackCommand = "다음 주 의기양양 두레동아리 홍보 콘텐츠 기획해줘";

export function runOffice(command: string, options: OfficeRunOptions = {}): OfficeResult {
  const normalizedCommand = normalizeCommand(command);
  const createdAt = options.createdAt || new Date().toISOString();
  const mode = options.mode || "simulation";
  const assignedAgents = prioritizeAgents(normalizedCommand);
  const tasks = createTasks(normalizedCommand, assignedAgents);
  const drafts = createDrafts(normalizedCommand, tasks, mode);
  const report: MorningReport = {
    command: normalizedCommand,
    createdAt,
    highlights: createHighlights(normalizedCommand, assignedAgents),
    drafts: drafts.filter((draft) => draft.agentId !== "chief"),
    nextActions: createNextActions(normalizedCommand),
    markdown: ""
  };

  report.markdown = createReportMarkdown({ tasks, drafts, report });

  return { tasks, drafts, report };
}

export function callLLM(prompt: string): string {
  // 향후 Claude API를 붙일 때 이 함수 내부만 교체하면, UI와 Actions 파이프라인은 그대로 재사용할 수 있다.
  return `[simulation: future-llm-extension-point] ${prompt.slice(0, 120)}`;
}

export function createReportMarkdown(result: OfficeResult): string {
  const { report, drafts } = result;
  const visibleDrafts = drafts.filter((draft) => draft.agentId !== "chief");
  const summaries = visibleDrafts.map((draft) => `### ${roleName(draft.agentId)}\n${summarizeDraft(draft.content)}\n\n검토: ${statusLabel(draft.reviewStatus)}${draft.reviewNote ? ` / ${draft.reviewNote}` : ""}`);

  return `# AI 사무국 아침 보고\n\n> 공개 저장소 주의: 민감한 개인정보, 내부 예산 실수치, 미공개 사업정보는 보고서에 입력하지 마세요.\n\n- 명령: ${report.command}\n- 생성시각: ${report.createdAt}\n- 실행모드: simulation\n\n## 오늘의 핵심 3가지\n\n${report.highlights.map((item) => `- ${item}`).join("\n")}\n\n## 에이전트별 산출물 요약\n\n${summaries.join("\n\n")}\n\n## 다음 액션 체크리스트\n\n${report.nextActions.map((item) => `- [ ] ${item}`).join("\n")}\n`;
}

export function slugifyCommand(command: string): string {
  const slug = normalizeCommand(command)
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "agent-office-report";
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ") || fallbackCommand;
}

function prioritizeAgents(command: string): AgentId[] {
  // 모든 실무 에이전트를 실행하되, 명령에 가까운 역할을 먼저 보여 주면 결과 해석이 쉬워진다.
  return [...workAgentIds].sort((left, right) => scoreAgent(right, command) - scoreAgent(left, command));
}

function scoreAgent(agentId: AgentId, command: string): number {
  return agentTriggerKeywords[agentId].reduce((score, keyword) => score + (command.includes(keyword) ? 1 : 0), 0);
}

function createTasks(command: string, assignedAgents: AgentId[]): AgentTask[] {
  const chiefTask: AgentTask = {
    id: "task-chief",
    agentId: "chief",
    title: "명령 해석과 업무 분해",
    input: `${command}를 실행 가능한 사무국 업무로 나눈다.`,
    dependsOn: []
  };

  const agentTasks = assignedAgents.map((agentId, index) => ({
    id: `task-${index + 1}`,
    agentId,
    title: taskTitle(agentId),
    input: taskInput(agentId, command),
    dependsOn: [chiefTask.id]
  }));

  return [
    chiefTask,
    ...agentTasks,
    {
      id: "task-review",
      agentId: "review",
      title: "검수와 최종 보완",
      input: "역할 에이전트 산출물의 누락, 모순, 안전 기준을 검토한다.",
      dependsOn: agentTasks.map((task) => task.id)
    }
  ];
}

function createDrafts(command: string, tasks: AgentTask[], mode: OfficeMode): AgentDraft[] {
  return tasks.map((task) => ({
    taskId: task.id,
    agentId: task.agentId,
    content: draftContent(task.agentId, command),
    reviewStatus: task.agentId === "review" ? "approved" : "revised",
    reviewNote: reviewNote(task.agentId),
    mode
  }));
}

function createHighlights(command: string, assignedAgents: AgentId[]): string[] {
  return [
    `명령 "${command}"를 ${assignedAgents.length}개 실무 역할과 1개 검수 단계로 나눴습니다.`,
    `가장 먼저 볼 담당은 ${roleName(assignedAgents[0])}이며, 이후 산출물을 사무국 보고서로 통합합니다.`,
    "메일 발송, SNS 게시, 공문 제출은 자동 실행하지 않고 초안 생성까지만 처리합니다."
  ];
}

function createNextActions(command: string): string[] {
  return [
    `${command}에 실제로 쓸 문단을 고르고 불필요한 초안을 지운다.`,
    "수신자명, 일정, 예산, 기관명 같은 자리표시자를 실제 정보로 확인한다.",
    "외부 발송이나 게시가 필요하면 사용자가 직접 검토 후 수동 실행한다."
  ];
}

function taskTitle(agentId: AgentId): string {
  switch (agentId) {
    case "local-planning":
      return "사업기획 초안 작성";
    case "research":
      return "자료조사와 사례 정리";
    case "content":
      return "콘텐츠 초안 작성";
    case "admin-doc":
      return "행정문서 골격 작성";
    case "email-draft":
      return "메일 초안 작성";
    default:
      return "역할 업무";
  }
}

function taskInput(agentId: AgentId, command: string): string {
  switch (agentId) {
    case "local-planning":
      return `${command}의 목적, 대상, 일정, 예산 골격, 성과지표를 잡는다.`;
    case "research":
      return `${command}와 관련된 정책, 사례, 키워드, 참고 링크 후보를 정리한다.`;
    case "content":
      return `${command}를 블로그, SNS, 릴스 초안으로 바꾼다.`;
    case "admin-doc":
      return `${command} 관련 공문 또는 추진계획 문서 골격을 작성한다.`;
    case "email-draft":
      return `${command} 관련 협조 또는 섭외 메일 초안을 작성한다.`;
    default:
      return command;
  }
}

function draftContent(agentId: AgentId, command: string): string {
  switch (agentId) {
    case "chief":
      return `## 업무 분해 메모\n\n- 기준 명령: ${command}\n- 처리 흐름: 명령 해석 → 기획 → 리서치 → 콘텐츠 → 행정문서 → 메일 → 검수\n- 운영 원칙: AI는 팀처럼 초안을 만들고, 사용자는 방향과 최종 실행을 판단한다.`;
    case "local-planning":
      return `## 기획 개요\n\n### 목적\n${command}를 지역 현장에서 실행 가능한 작은 프로젝트로 정리하고, 홍보와 참여로 이어지는 구조를 만든다.\n\n### 대상\n- 1차: 참여 동아리, 지역 주민, 센터 관계자\n- 2차: 향후 협력기관, 콘텐츠 구독자, 공모사업 평가자\n\n### 실행 골격\n1. 준비: 대상과 메시지 확정\n2. 실행: 홍보 콘텐츠 배포와 참여자 모집\n3. 기록: 현장 반응, 사진, 후기 수집\n4. 확장: 결과보고와 다음 회차 개선안 작성\n\n### 예산·성과 메모\n- 예산: 디자인, 인쇄, 촬영, 운영비 항목 확인 필요\n- 성과: 참여자 수, 문의 수, 콘텐츠 반응, 협력 제안 수`;
    case "research":
      return `## 리서치 노트\n\n### 조사 질문\n- ${command}와 연결되는 지역 동아리, 생활문화, 주민참여 사례는 무엇인가?\n- 유사 홍보 콘텐츠에서 반응이 좋았던 메시지는 무엇인가?\n- 공모사업이나 센터 보고서에 근거로 쓸 수 있는 정책 키워드는 무엇인가?\n\n### 참고 링크 후보\n- [확인 필요] 지자체 생활문화 또는 공동체 지원사업 페이지\n- [확인 필요] 지역 동아리 홍보 우수사례 기사\n- [확인 필요] 농촌활성화 또는 주민참여 정책 자료\n\n### 핵심 인사이트\n- 홍보는 활동 소개보다 참여자가 얻는 변화 장면을 먼저 보여줄 때 설득력이 높다.\n- 조사 자료는 블로그 근거, 공문 추진배경, 메일 설득 문장으로 재사용할 수 있다.`;
    case "content":
      return `## 콘텐츠 초안\n\n### 블로그 제목\n${command}: 지역에서 함께 움직이는 작은 기획 만들기\n\n### 블로그 도입\n지역의 좋은 활동은 이미 존재하지만, 사람들에게 닿는 문장과 장면이 부족해서 조용히 지나가는 경우가 많습니다. 이번 기획은 ${command}를 더 쉽게 이해하고 참여할 수 있도록 정리하는 작업입니다.\n\n### 인스타 문구\n다음 주, 의기양양 두레동아리의 이야기를 더 많은 사람에게 전하려고 합니다. 활동의 의미, 참여 포인트, 현장의 온도를 짧고 선명하게 담아볼게요. #파책남 #로컬기획 #의기양양두레동아리\n\n### 릴스 스크립트\n"지역 활동을 홍보할 때는 설명보다 장면이 먼저입니다. 누가 모이고, 무엇이 달라지고, 다음에 어떻게 참여할 수 있는지. 이 세 가지만 선명해도 홍보는 훨씬 쉬워집니다."`;
    case "admin-doc":
      return `## 행정문서 초안\n\n### 제목\n${command} 추진계획(안)\n\n### 추진배경\n지역 활동 참여 확대와 센터 사업 홍보 강화를 위하여 ${command}를 추진하고자 함.\n\n### 주요내용\n- 홍보 대상 및 핵심 메시지 정리\n- 블로그·SNS 게시용 콘텐츠 초안 작성\n- 참여자 모집 또는 안내 문구 작성\n- 추진 결과 및 반응 기록\n\n### 협조요청\n관련 부서에서는 추진 일정, 홍보 채널, 검토 필요 자료 확인에 협조하여 주시기 바람.`;
    case "email-draft":
      return `## 메일 초안\n\n제목: ${command} 관련 자료 확인 및 협조 요청드립니다\n\n안녕하세요, [수신자명]님.\n\n[기관/센터명]에서 ${command}를 준비하고 있어 홍보에 필요한 기본 정보와 확인 자료를 요청드립니다. 현재는 초안 작성 단계이며, 실제 게시 전 최종 문구와 일정은 다시 확인하겠습니다.\n\n가능하시다면 아래 내용을 회신 부탁드립니다.\n- 활동 소개에서 꼭 들어가야 할 내용\n- 공개 가능한 사진 또는 자료 여부\n- 홍보 가능한 일정과 채널\n\n감사합니다.\n[보내는 사람]\n\n발송 전 체크: 수신자명, 기관명, 일정, 첨부자료, 공개 가능 여부 확인 필요`;
    case "review":
      return `## 검수 의견\n\n- 논리: 기획, 조사, 콘텐츠, 행정문서, 메일 초안이 같은 명령을 기준으로 연결되어 있음.\n- 누락: 실제 일정, 예산, 담당자, 공개 가능한 사진 여부는 확인 필요함.\n- 문체: 콘텐츠는 친근하게, 행정문서는 '~함' 문체로 분리되어 있음.\n- 안전: 자동 메일 발송, SNS 자동 게시, 공문 자동 제출은 포함하지 않았음. 개인정보와 내부 예산 실수치는 입력 금지.`;
    default:
      return callLLM(command);
  }
}

function reviewNote(agentId: AgentId): string {
  switch (agentId) {
    case "email-draft":
      return "자동 발송 금지, 사용자 수동 확인 필요";
    case "admin-doc":
      return "기관명, 담당자, 일정 확인 후 보완 필요";
    case "review":
      return "최종 보고서 반영 가능";
    case "chief":
      return "업무 분배 기준";
    default:
      return "실무 초안으로 사용 가능, 사실관계 확인 필요";
  }
}

function summarizeDraft(content: string): string {
  const plainLines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("##") && !line.startsWith("###"));
  return plainLines.slice(0, 4).join("\n");
}

function roleName(agentId: AgentId): string {
  return getAgentRole(agentId)?.name || agentId;
}

function statusLabel(status: AgentDraft["reviewStatus"]): string {
  switch (status) {
    case "approved":
      return "승인";
    case "revised":
      return "수정 권고";
    case "rejected":
      return "반려";
  }
}

export function roleSummary(agentId: AgentId): string {
  const role = agentRoles.find((item) => item.id === agentId);
  return role ? `${role.name} · ${role.role}` : agentId;
}
