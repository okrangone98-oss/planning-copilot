export type SectionId =
  | "agentOffice"
  | "notice"
  | "cowork"
  | "ragRoom"
  | "aiBridge"
  | "visuals"
  | "integrations"
  | "driveBackup"
  | "sample"
  | "idea"
  | "problem"
  | "logic"
  | "metrics"
  | "execution"
  | "blueprint"
  | "draft";


export type AgentId =
  | "chief"
  | "local-planning"
  | "research"
  | "content"
  | "admin-doc"
  | "email-draft"
  | "review";

export type AgentRole = {
  id: AgentId;
  name: string;
  role: string;
  goal: string;
  constraints: string[];
  outputFormat: string;
  promptTemplate: string;
};

export type AgentTask = {
  id: string;
  agentId: AgentId;
  title: string;
  input: string;
  dependsOn: string[];
};

export type AgentDraft = {
  taskId: string;
  agentId: AgentId;
  content: string;
  reviewStatus: "approved" | "revised" | "rejected";
  reviewNote?: string;
  mode: "simulation" | "llm";
};

export type MorningReport = {
  command: string;
  createdAt: string;
  highlights: string[];
  drafts: AgentDraft[];
  nextActions: string[];
  markdown: string;
};

export type PromptPackage = {
  rolePrompts: Array<{
    agentId: AgentId;
    title: string;
    prompt: string;
  }>;
  unifiedPrompt: string;
  usageGuide: string[];
};

export type OfficeResult = {
  tasks: AgentTask[];
  drafts: AgentDraft[];
  report: MorningReport;
  promptPackage: PromptPackage;
};

export type KnowledgeDoc = {
  id: string;
  title: string;
  type: string;
  text: string;
  createdAt: string;
};

export type ProjectData = {
  projectName: string;
  noticeText: string;
  policyGoal: string;
  evaluationFocus: string;
  requirements: string;
  advantageSignals: string;
  agentMemo: string;
  nextQuestions: string;
  writingStrategy: string;
  missingEvidence: string;
  ragQuery: string;
  ragResults: string;
  modelPrompt: string;
  modelResponse: string;
  aiSynthesis: string;
  visualMermaid: string;
  jiraUrl: string;
  notionUrl: string;
  spreadsheetUrl: string;
  driveFolderUrl: string;
  integrationMemo: string;
  sampleSource: string;
  sampleStructure: string;
  sampleSignals: string;
  sampleAdaptation: string;
  coreIdea: string;
  targetUsers: string;
  fieldEvidence: string;
  founderInsight: string;
  problemSituation: string;
  rootCauses: string;
  existingLimits: string;
  whyNow: string;
  inputs: string;
  activities: string;
  outputs: string;
  shortOutcomes: string;
  longOutcomes: string;
  milestones: string;
  teamSystem: string;
  budgetPlan: string;
  riskPlan: string;
  metricsTable: string[][];
  blueprintTable: string[][];
  draftOutput: string;
};

export type ArchiveData = {
  version: number;
  exportedAt: string;
  app: "planning-copilot";
  project: ProjectData;
  knowledgeDocs: KnowledgeDoc[];
};

export const textFields: Array<keyof ProjectData> = [
  "projectName",
  "noticeText",
  "policyGoal",
  "evaluationFocus",
  "requirements",
  "advantageSignals",
  "agentMemo",
  "nextQuestions",
  "writingStrategy",
  "missingEvidence",
  "ragQuery",
  "ragResults",
  "modelPrompt",
  "modelResponse",
  "aiSynthesis",
  "visualMermaid",
  "sampleSource",
  "sampleStructure",
  "sampleSignals",
  "sampleAdaptation",
  "coreIdea",
  "targetUsers",
  "fieldEvidence",
  "founderInsight",
  "problemSituation",
  "rootCauses",
  "existingLimits",
  "whyNow",
  "inputs",
  "activities",
  "outputs",
  "shortOutcomes",
  "longOutcomes",
  "milestones",
  "teamSystem",
  "budgetPlan",
  "riskPlan",
  "draftOutput"
];

export const emptyProject: ProjectData = {
  projectName: "",
  noticeText: "",
  policyGoal: "",
  evaluationFocus: "",
  requirements: "",
  advantageSignals: "",
  agentMemo: "",
  nextQuestions: "",
  writingStrategy: "",
  missingEvidence: "",
  ragQuery: "",
  ragResults: "",
  modelPrompt: "",
  modelResponse: "",
  aiSynthesis: "",
  visualMermaid: "",
  jiraUrl: "",
  notionUrl: "",
  spreadsheetUrl: "",
  driveFolderUrl: "",
  integrationMemo: "",
  sampleSource: "",
  sampleStructure: "",
  sampleSignals: "",
  sampleAdaptation: "",
  coreIdea: "",
  targetUsers: "",
  fieldEvidence: "",
  founderInsight: "",
  problemSituation: "",
  rootCauses: "",
  existingLimits: "",
  whyNow: "",
  inputs: "",
  activities: "",
  outputs: "",
  shortOutcomes: "",
  longOutcomes: "",
  milestones: "",
  teamSystem: "",
  budgetPlan: "",
  riskPlan: "",
  metricsTable: [["", "", "", ""]],
  blueprintTable: [["", "", "", "", ""]],
  draftOutput: ""
};
