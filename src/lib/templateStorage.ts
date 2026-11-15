import { emptyTemplateSchema, normalizeProfileKeepWhitespace } from "./sampleTemplateParser.mjs";
import type { TemplateProfile, TemplateSchema } from "./sampleTemplateParser.mjs";

const TEMPLATE_KEY = "planningCopilotTemplateSession";

/** 양식 채우기 작업도 사업별로 나눈다. id가 없으면 예전 단일 키를 쓴다. */
export function templateStorageKey(id?: string) {
  return id ? `${TEMPLATE_KEY}:${id}` : TEMPLATE_KEY;
}

export type TemplateSession = {
  schema: TemplateSchema | null;
  profile: TemplateProfile;
  result: string;
  updatedAt: string;
};

export function createEmptyTemplateSession(): TemplateSession {
  return { schema: null, profile: normalizeProfileKeepWhitespace({}), result: "", updatedAt: "" };
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
      updatedAt: session.updatedAt || new Date().toISOString()
    }));
  } catch {
    // 저장 공간이 부족해도 화면 작업은 이어 간다. 스키마는 메모리에 남아 있다.
  }
}
