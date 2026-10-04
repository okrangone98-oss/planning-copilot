import { emptyProject, type ApprovalItem, type ArchiveData, type KnowledgeDoc, type ModelSettings, type OfficeResult, type ProjectData, type ProjectMemoryEntry } from "../types";
import { defaultModelSettings } from "./modelRouter";
import { sanitizeModelSettings } from "./modelSafety.mjs";

const STORAGE_KEY = "planningCopilotProject";
const KNOWLEDGE_KEY = "planningCopilotKnowledgeDocs";
const DRIVE_ENDPOINT_KEY = "planningCopilotDriveEndpoint";
const OFFICE_SESSION_KEY = "planningCopilotOfficeSession";
const MODEL_SETTINGS_KEY = "planningCopilotModelSettings";
const APPROVAL_ITEMS_KEY = "planningCopilotApprovalItems";
const PROJECT_MEMORY_KEY = "planningCopilotProjectMemory";

export function loadProject(): ProjectData {
  try {
    return { ...emptyProject, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return emptyProject;
  }
}

export function saveProject(project: ProjectData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

export function clearProject() {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadKnowledgeDocs(): KnowledgeDoc[] {
  try {
    return JSON.parse(localStorage.getItem(KNOWLEDGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveKnowledgeDocs(docs: KnowledgeDoc[]) {
  localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(docs));
}

export function createArchive(project: ProjectData, knowledgeDocs: KnowledgeDoc[], approvalItems: ApprovalItem[] = [], memoryEntries: ProjectMemoryEntry[] = []): ArchiveData {
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    app: "planning-copilot",
    project,
    knowledgeDocs,
    approvalItems,
    memoryEntries
  };
}

export function saveDriveEndpoint(endpoint: string) {
  localStorage.setItem(DRIVE_ENDPOINT_KEY, endpoint);
}

export function loadDriveEndpoint() {
  return localStorage.getItem(DRIVE_ENDPOINT_KEY) || "";
}

export function loadOfficeSession(): { command: string; result: OfficeResult | null } {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFICE_SESSION_KEY) || "{}");
    return {
      command: typeof parsed.command === "string" ? parsed.command : "",
      result: parsed.result && Array.isArray(parsed.result.tasks) ? parsed.result : null
    };
  } catch {
    return { command: "", result: null };
  }
}

export function saveOfficeSession(command: string, result: OfficeResult | null) {
  // 사무국 결과는 다시 GPT 질문이나 초안 조립으로 이어지므로, 새로고침해도 흐름이 끊기지 않게 보관한다.
  localStorage.setItem(OFFICE_SESSION_KEY, JSON.stringify({ command, result }));
}


export function loadModelSettings(): ModelSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(MODEL_SETTINGS_KEY) || "{}");
    return sanitizeModelSettings(saved, defaultModelSettings);
  } catch {
    return { ...defaultModelSettings };
  }
}

export function saveModelSettings(settings: ModelSettings) {
  // 구버전 브라우저 설정에 있던 클라우드 비밀키를 다시 보존하지 않도록 허용 목록만 저장한다.
  localStorage.setItem(MODEL_SETTINGS_KEY, JSON.stringify(sanitizeModelSettings(settings, defaultModelSettings)));
}

export function loadApprovalItems(): ApprovalItem[] {
  try {
    return JSON.parse(localStorage.getItem(APPROVAL_ITEMS_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveApprovalItems(items: ApprovalItem[]) {
  localStorage.setItem(APPROVAL_ITEMS_KEY, JSON.stringify(items));
}

export function loadProjectMemory(): ProjectMemoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(PROJECT_MEMORY_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveProjectMemory(entries: ProjectMemoryEntry[]) {
  localStorage.setItem(PROJECT_MEMORY_KEY, JSON.stringify(entries));
}

export function downloadTextFile(content: string, fileName: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function safeFileName(value: string, fallback: string) {
  return (value || fallback).replace(/[\\/:*?"<>|]/g, "_");
}
