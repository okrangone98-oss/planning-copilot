export const MATERIALS_ACCEPT: string;
export const PHOTO_ACCEPT: string;
export const MATERIALS_HINT: string;
export const PHOTO_HINT: string;

export type AttendanceMaterial = {
  kind: "attendance";
  total: number | null;
  rows: number;
  line: string;
  perSession: string[];
  warnings: string[];
  hadHeader: boolean;
  delimiter: string;
};

export type ExpenseMaterial = {
  kind: "expense";
  total: number | null;
  rows: number;
  line: string;
  byCategory: Array<{ category: string; amount: number }>;
  dates: { min: string; max: string };
  warnings: string[];
  hadHeader: boolean;
  delimiter: string;
};

export type SpreadsheetMaterial = AttendanceMaterial | ExpenseMaterial;

export type PhotoCaption = {
  fileName: string;
  date: string;
  title: string;
  caption: string;
};

export type PhotoCaptions = {
  lines: PhotoCaption[];
  text: string;
  warnings: string[];
};

export function parseAttendanceMaterial(text?: string, options?: { delimiter?: string }): AttendanceMaterial;
export function parseExpenseMaterial(text?: string, options?: { delimiter?: string }): ExpenseMaterial;
export function parseSpreadsheetMaterial(text?: string, options?: { delimiter?: string }): SpreadsheetMaterial;
export function materialsToText(results?: Array<{ line?: string }> | null, options?: { title?: string }): string;
export function dateFromPhotoName(name?: string | null): string;
export function titleFromPhotoName(name?: string | null): string;
export function photoCaptions(
  photos?: Array<{ name?: string; lastModified?: number } | string> | null
): PhotoCaptions;
export function summarizeMaterials(input?: {
  plan?: { counts?: { total?: number } } | null;
  spreadsheet?: { kind?: string; rows?: number } | null;
  photos?: { lines?: unknown[] } | null;
}): { counts: { plan: number; attendance: number; expense: number; photos: number }; total: number };
