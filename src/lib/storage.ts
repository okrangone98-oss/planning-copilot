import { emptyProject, type ArchiveData, type KnowledgeDoc, type OfficeResult, type ProjectData } from "../types";

const STORAGE_KEY = "planningCopilotProject";
const KNOWLEDGE_KEY = "planningCopilotKnowledgeDocs";
const DRIVE_ENDPOINT_KEY = "planningCopilotDriveEndpoint";
const OFFICE_SESSION_KEY = "planningCopilotOfficeSession";

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

export function createArchive(project: ProjectData, knowledgeDocs: KnowledgeDoc[]): ArchiveData {
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    app: "planning-copilot",
    project,
    knowledgeDocs
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
