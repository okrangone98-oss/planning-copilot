import type { GrantPlan } from "../types";

export type ReportBlock = { type: "paragraph" | "bullet" | "note"; text: string };

export type ReportMetaRow = { label: string; value: string };

export type ReportSection = { title: string; blocks: ReportBlock[] };

export type ReportBudgetTable = {
  headers: string[];
  rows: string[][];
  total?: string[];
};

export type ReportDocument = {
  title: string;
  subtitle: string;
  metaRows: ReportMetaRow[];
  sections: ReportSection[];
  summary: ReportMetaRow[];
  budget: ReportBudgetTable | null;
  footer: string;
};

export type ReportSource = {
  plan?: Partial<GrantPlan> | null;
  project?: { projectName?: string } | null;
  work?: unknown;
  generatedAt?: string | Date;
};

export const REPORT_TEMPLATE_FILE: string;

export function reportTemplateUrl(baseUri: string): string;
export function contentBlocks(content: string): ReportBlock[];
export function buildReportDocument(source?: ReportSource): ReportDocument;
export function renderReportBodyXml(document: ReportDocument): string;
export function tableXml(options: {
  headers: string[];
  rows: string[][];
  total?: string[];
  width?: number;
  rowHeight?: number;
  tableId?: string;
}): string;
export function buildReportHwpxBytes(options: {
  baseBytes: Uint8Array | ArrayBuffer;
  document: ReportDocument;
  jszip?: unknown;
}): Promise<{
  bytes: Uint8Array;
  sectionXml: string;
  preview: { text: string; chars: number; removedImages: string[]; written: boolean };
}>;
export function reportFileName(options?: { plan?: Partial<GrantPlan> | null; project?: { projectName?: string } | null; fallback?: string }): string;
