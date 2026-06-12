import { emptyProject, type ArchiveData, type KnowledgeDoc, type ProjectData } from "../types";

const STORAGE_KEY = "planningCopilotProject";
const KNOWLEDGE_KEY = "planningCopilotKnowledgeDocs";
const DRIVE_ENDPOINT_KEY = "planningCopilotDriveEndpoint";

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
