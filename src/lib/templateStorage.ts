import { emptyTemplateSchema, normalizeProfileKeepWhitespace } from "./sampleTemplateParser.mjs";
import type { TemplateProfile, TemplateSchema } from "./sampleTemplateParser.mjs";

const TEMPLATE_KEY = "planningCopilotTemplateSession";

/** 양식 채우기 작업도 사업별로 나눈다. id가 없으면 예전 단일 키를 쓴다. */
export function templateStorageKey(id?: string) {
  return id ? `${TEMPLATE_KEY}:${id}` : TEMPLATE_KEY;
}

/** 2단계에 사업 데이터를 마지막으로 불러온 기록 — 같은 블록만 새 값으로 바꾸고, 오래된 값인지 알려 준다. */
export type TemplateDigestSource = {
  loadedAt: string;
  /** 불러온 글의 지문(projectDataSignature) */
  signature: string;
  /** 붙여넣기 칸에 넣은 블록 그대로 */
  block: string;
  counts: Record<string, number>;
  /** 비어 있어 넣지 않은 항목 */
  missing: string[];
  truncated: boolean;
};

export type TemplateSession = {
  schema: TemplateSchema | null;
  profile: TemplateProfile;
  result: string;
  /** 자유 텍스트로 채운 칸 값 — 필드 id → 값 */
  fieldValues: Record<string, string>;
  /** 자유 텍스트 자동 배치에 붙여넣은 원문 */
  smartText: string;
  /** 사업 데이터에서 마지막으로 불러온 블록 — 사업을 바꾸면 사업별 키라 함께 나뉜다. */
  digest: TemplateDigestSource | null;
  updatedAt: string;
};

export function createEmptyTemplateSession(): TemplateSession {
  return {
    schema: null,
    profile: normalizeProfileKeepWhitespace({}),
    result: "",
    fieldValues: {},
    smartText: "",
    digest: null,
    updatedAt: ""
  };
}

/** 저장된 불러오기 기록을 믿지 않고 글자·숫자만 남긴다. */
export function sanitizeDigestSource(value: unknown): TemplateDigestSource | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const countsRaw = raw.counts && typeof raw.counts === "object" ? (raw.counts as Record<string, unknown>) : {};
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(countsRaw)) {
    const parsed = Number(count);
    if (Number.isFinite(parsed) && parsed >= 0) counts[text(key, 20)] = Math.round(parsed);
  }
  return {
    loadedAt: text(raw.loadedAt, 30),
    signature: text(raw.signature, 40),
    block: text(raw.block, 20000),
    counts,
    missing: Array.isArray(raw.missing) ? raw.missing.slice(0, 20).map((item) => text(item, 40)) : [],
    truncated: raw.truncated === true
  };
}

/** 저장된 칸 값을 믿지 않고 글자만 남긴다(필드 id·값 길이 제한). */
export function sanitizeFieldValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = text(key, 20);
    const raw_value = text(raw, 2000);
    if (id && raw_value.trim()) output[id] = raw_value;
  }
  return output;
}

function text(value: unknown, limit = 400) {
  return String(value ?? "").slice(0, limit);
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 저장된 스키마를 믿지 않고 모양을 다시 확인한다. 표·슬롯 수는 화면에 그릴 수 있는 만큼만 남긴다. */
export function sanitizeTemplateSchema(value: unknown): TemplateSchema | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<TemplateSchema>;
  if (!Array.isArray(raw.sections) || !Array.isArray(raw.tables) || !Array.isArray(raw.slots)) return null;

  const schema = emptyTemplateSchema(text(raw.fileName, 200));
  schema.format = text(raw.format, 20) || schema.format;
  schema.title = text(raw.title, 200);
  schema.charCount = number(raw.charCount);
  schema.warnings = Array.isArray(raw.warnings) ? raw.warnings.slice(0, 8).map((item) => text(item, 300)) : [];

  schema.sections = raw.sections.slice(0, 200).map((section, index) => ({
    id: text(section?.id, 20) || `s${index + 1}`,
    rawLevel: Math.max(1, Math.min(number(section?.rawLevel, 1), 6)),
    level: Math.max(1, Math.min(number(section?.level, 1), 6)),
    parentId: section?.parentId ? text(section.parentId, 20) : null,
    title: text(section?.title, 120),
    order: number(section?.order, index + 1),
    line: number(section?.line)
  }));

  schema.tables = raw.tables.slice(0, 60).map((table, index) => {
    const headers = Array.isArray(table?.headers) ? table.headers.slice(0, 12).map((header) => text(header, 60)) : [];
    const rows = Array.isArray(table?.rows)
      ? table.rows.slice(0, 60).map((row) => (Array.isArray(row) ? row.slice(0, 12).map((cell) => text(cell, 300)) : []))
      : [];
    return {
      id: text(table?.id, 20) || `t${index + 1}`,
      order: number(table?.order, index + 1),
      sectionId: table?.sectionId ? text(table.sectionId, 20) : null,
      caption: text(table?.caption, 120),
      headers,
      rows,
      columnCount: headers.length,
      rowCount: number(table?.rowCount, rows.length),
      emptyCells: number(table?.emptyCells)
    };
  });

  schema.slots = raw.slots.slice(0, 300).map((slot, index) => ({
    id: text(slot?.id, 20) || `w${index + 1}`,
    kind: ["blank", "label", "guide", "item", "table-cell"].includes(String(slot?.kind)) ? (slot!.kind as TemplateSchema["slots"][number]["kind"]) : "item",
    label: text(slot?.label, 120),
    sectionId: slot?.sectionId ? text(slot.sectionId, 20) : null,
    sectionTitle: text(slot?.sectionTitle, 120),
    preview: slot?.preview ? text(slot.preview, 140) : undefined,
    tableId: slot?.tableId ? text(slot.tableId, 20) : undefined,
    rowIndex: slot?.rowIndex === undefined ? undefined : number(slot.rowIndex),
    columnIndex: slot?.columnIndex === undefined ? undefined : number(slot.columnIndex),
    source: slot?.source === "table" ? "table" : "text"
  }));

  schema.counts = {
    sections: schema.sections.length,
    tables: schema.tables.length,
    slots: schema.slots.length,
    emptyCells: schema.tables.reduce((sum, table) => sum + table.emptyCells, 0),
    blanks: number(raw.counts?.blanks),
    guides: number(raw.counts?.guides)
  };

  return schema;
}

export function loadTemplateSession(id?: string): TemplateSession {
  try {
    // 사업별 키에 아직 없으면 예전 단일 키에서 한 번 읽어 준다. (기존 작업 보존)
    const raw = localStorage.getItem(templateStorageKey(id)) ?? (id ? localStorage.getItem(TEMPLATE_KEY) : null);
    const parsed = JSON.parse(raw || "{}");
    return {
      schema: sanitizeTemplateSchema(parsed.schema),
      profile: normalizeProfileKeepWhitespace(parsed.profile),
      result: typeof parsed.result === "string" ? parsed.result.slice(0, 200000) : "",
      fieldValues: sanitizeFieldValues(parsed.fieldValues),
      smartText: typeof parsed.smartText === "string" ? parsed.smartText.slice(0, 20000) : "",
      digest: sanitizeDigestSource(parsed.digest),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : ""
    };
  } catch {
    return createEmptyTemplateSession();
  }
}

export function saveTemplateSession(session: TemplateSession, id?: string) {
  try {
    localStorage.setItem(templateStorageKey(id), JSON.stringify({
      schema: session.schema,
      profile: normalizeProfileKeepWhitespace(session.profile),
      result: session.result.slice(0, 200000),
      fieldValues: sanitizeFieldValues(session.fieldValues),
      smartText: String(session.smartText ?? "").slice(0, 20000),
      digest: session.digest
        ? {
            loadedAt: text(session.digest.loadedAt, 30),
            signature: text(session.digest.signature, 40),
            block: text(session.digest.block, 20000),
            counts: session.digest.counts || {},
            missing: Array.isArray(session.digest.missing) ? session.digest.missing.slice(0, 20) : [],
            truncated: session.digest.truncated === true
          }
        : null,
      updatedAt: session.updatedAt || new Date().toISOString()
    }));
  } catch {
    // 저장 공간이 부족해도 화면 작업은 이어 간다. 스키마는 메모리에 남아 있다.
  }
}
