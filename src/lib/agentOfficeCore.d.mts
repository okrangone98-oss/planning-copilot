import type { AgentId, OfficeResult } from "../types";

export type OfficeMode = "simulation" | "llm";
export type OfficeRunOptions = {
  createdAt?: string;
  mode?: OfficeMode;
};

export function runOfficeCore(command: string, options?: OfficeRunOptions): OfficeResult;
export function callLLM(prompt: string): string;
export function createReportMarkdown(result: OfficeResult): string;
export function slugifyCommand(command: string): string;
export function roleSummary(agentId: AgentId): string;
