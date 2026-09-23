import { sourceRef } from "./contracts.mjs";

const SPREADSHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const SHEET_FIELDS = "sheets.properties.title,spreadsheetUrl";
const DEFAULT_SPREADSHEET_TITLE = "26 양터 전체사업 총괄표";
const HEADER_VARIANTS = {
  name: new Set(["사업명", "사업명칭", "프로젝트명", "사업", "프로젝트", "Project"]),
  deadline: new Set(["일정", "마감일", "마감", "기한", "일자", "기간", "행사일", "deadline"]),
  status: new Set(["상태", "진행상태", "사업상태", "진행", "status"])
};

export async function readProjectState({ driveApi, sheetsApi, spreadsheetId, spreadsheetTitle, sheetName, detectedAt } = {}) {
  const spreadsheet = await selectSpreadsheet({ driveApi, spreadsheetId, spreadsheetTitle });
  if (!spreadsheet) return [];

  const spreadsheets = sheetsApi?.spreadsheets;
  if (typeof spreadsheets?.get !== "function" || typeof spreadsheets?.values?.get !== "function") return [];

  let metadata;
  try {
    metadata = await spreadsheets.get({ spreadsheetId: spreadsheet.id, fields: SHEET_FIELDS });
  } catch {
    return [];
  }
  const sheets = metadata?.data?.sheets;
  if (!Array.isArray(sheets)) return [];

  const selectedSheet = sheetName
    ? sheets.find((sheet) => sheet?.properties?.title === sheetName)
    : sheets[0];
  const title = selectedSheet?.properties?.title;
  if (typeof title !== "string" || !title) return [];

  let valuesResponse;
  try {
    valuesResponse = await spreadsheets.values.get({
      spreadsheetId: spreadsheet.id,
      range: `'${title.replace(/'/g, "''")}'!A:ZZ`
    });
  } catch {
    return [];
  }

  const values = valuesResponse?.data?.values;
  if (!Array.isArray(values) || values.length < 2 || !Array.isArray(values[0])) return [];

  const columns = resolveColumns(values[0]);
  if (columns.name === undefined) return [];
  const sourceUrl = metadata?.data?.spreadsheetUrl || spreadsheet.url || `https://docs.google.com/spreadsheets/d/${spreadsheet.id}/edit`;

  return values.slice(1)
    .filter(Array.isArray)
    .map((row) => normalizeProjectRow(row, columns, spreadsheet.id, sourceUrl, detectedAt))
    .filter(Boolean);
}

async function selectSpreadsheet({ driveApi, spreadsheetId, spreadsheetTitle }) {
  if (typeof spreadsheetId === "string" && spreadsheetId) {
    return { id: spreadsheetId, url: "" };
  }
  const title = typeof spreadsheetTitle === "string" && spreadsheetTitle ? spreadsheetTitle : DEFAULT_SPREADSHEET_TITLE;
  if (typeof driveApi?.files?.list !== "function") return null;

  try {
    const response = await driveApi.files.list({
      q: `name = '${title.replace(/'/g, "\\'")}' and mimeType = '${SPREADSHEET_MIME_TYPE}' and trashed = false`,
      fields: "files(id,name,webViewLink)"
    });
    const file = response?.data?.files?.find((candidate) => typeof candidate?.id === "string" && candidate.id);
    return file ? { id: file.id, url: typeof file.webViewLink === "string" ? file.webViewLink : "" } : null;
  } catch {
    return null;
  }
}

function resolveColumns(headers) {
  return headers.reduce((columns, header, index) => {
    const key = normalizeHeader(header);
    for (const [field, variants] of Object.entries(HEADER_VARIANTS)) {
      if (columns[field] === undefined && variants.has(key)) columns[field] = index;
    }
    return columns;
  }, {});
}

function normalizeHeader(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s\-_/.]+/g, "").trim();
}

function normalizeProjectRow(row, columns, spreadsheetId, sourceUrl, detectedAt) {
  const name = cell(row, columns.name);
  if (!name) return null;

  const deadlineText = cell(row, columns.deadline);
  const statusText = cell(row, columns.status);
  const deadline = normalizeDeadline(deadlineText);
  return {
    name,
    deadlineText,
    deadline,
    statusText,
    source: sourceRef("sheets", spreadsheetId, sourceUrl, detectedAt)
  };
}

function cell(row, index) {
  return index === undefined || row[index] === undefined || row[index] === null ? "" : String(row[index]).trim();
}

function normalizeDeadline(value) {
  const text = String(value || "").trim();
  const koreanDate = text.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/);
  const isoDate = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const parts = koreanDate || isoDate;
  if (!parts) return undefined;

  const [, year, month, day] = parts;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
