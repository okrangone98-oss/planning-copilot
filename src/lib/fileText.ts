import {
  HWP_BINARY_GUIDANCE,
  UNSUPPORTED_FORMAT_GUIDANCE,
  blocksToText,
  documentFormatOf,
  extractDocxHtmlBlocks,
  parseTextBlocks,
  readHwpxBlocks,
  type SampleBlock
} from "./sampleTemplateParser.mjs";
import { readXlsxWorkbook } from "./xlsxTable.mjs";

export type ExtractedDocument = {
  text: string;
  blocks: SampleBlock[];
  format: string;
  warning?: string;
};

type ExtractedText = {
  text: string;
  warning?: string;
};

const textLikeExtensions = [".txt", ".md", ".markdown", ".csv", ".html", ".htm", ".json", ".xml"];

function extensionOf(file: File) {
  const name = file.name.toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function decodeEntities(value: string) {
  const element = document.createElement("textarea");
  element.innerHTML = value;
  return element.value;
}

/** CSV는 표로 읽는다. 쉼표 구분을 Markdown 표 모양으로 바꿔 구조 파서가 열·행을 잡게 한다. */
function csvToPipeText(text: string) {
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.replace(/^"|"$/g, "").split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((cell) => cell.replace(/^"|"$/g, "").trim()));
  if (!rows.length) return "";
  return rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
}

async function readTextFile(file: File, extension: string): Promise<ExtractedText> {
  const text = (await file.text()).trim();
  if (!text || text.includes("\u0000")) {
    return {
      text: "",
      warning: "텍스트를 읽지 못했습니다. 문서 내용을 복사해 붙여넣어 주세요."
    };
  }
  if (extension === ".csv") return { text: csvToPipeText(text) };
  if (extension === ".html" || extension === ".htm") {
    // 저장된 HTML 공고문은 태그가 그대로 들어오므로 글자만 남긴다.
    return { text: decodeEntities(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, "\n")) };
  }
  return { text };
}

async function readDocx(file: File): Promise<ExtractedText> {
  const mammoth = (await import("mammoth/mammoth.browser")).default;
  // 브라우저 빌드의 타입 선언에는 convertToHtml이 빠져 있어, 표·제목 구조를 살리는 경로만 따로 선언한다.
  const converter = mammoth as unknown as {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: Array<unknown> }>;
  };
  const arrayBuffer = await file.arrayBuffer();
  try {
    // 평문이 아니라 HTML로 받아 제목·표 구조를 살린다.
    const result = await converter.convertToHtml({ arrayBuffer });
    const blocks = extractDocxHtmlBlocks(result.value || "");
    if (blocks.length) {
      return {
        text: blocksToText(blocks),
        warning: result.messages.length ? "DOCX 일부 서식은 제외하고 본문·표 구조만 가져왔습니다." : undefined
      };
    }
  } catch {
    // HTML 변환에 실패하면 평문 추출로 되돌아간다.
  }
  const raw = await mammoth.extractRawText({ arrayBuffer });
  return {
    text: raw.value.trim(),
    warning: raw.messages.length ? "DOCX 일부 서식은 제외하고 본문 텍스트만 가져왔습니다." : undefined
  };
}

async function readPdf(file: File): Promise<ExtractedText> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map<number, string[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      // 같은 높이(y)의 글자를 한 줄로 묶어 표의 열이 한 줄에 남게 한다.
      const y = Math.round(Number(item.transform?.[5] ?? 0) / 2) * 2;
      const row = rows.get(y) || [];
      row.push(item.str);
      rows.set(y, row);
    }
    const ordered = Array.from(rows.entries()).sort((a, b) => b[0] - a[0]).map(([, cells]) => cells.join(" "));
    pages.push(`--- ${pageNumber}쪽 ---\n${ordered.join("\n")}`);
  }

  return {
    text: pages.join("\n\n").trim(),
    warning: "PDF는 글자만 읽습니다. 표 구조까지 정확히 옮기려면 HWPX·DOCX로 올려 주세요. 스캔 이미지 PDF는 별도 OCR이 필요합니다."
  };
}

async function readHwpx(file: File): Promise<ExtractedText> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const blocks = await readHwpxBlocks(zip);
  return {
    text: blocksToText(blocks),
    warning: "HWPX는 문단과 표 구조를 읽습니다. 병합된 칸은 첫 칸 위치에만 담깁니다."
  };
}

/** 엑셀(.xlsx)은 첫 시트의 표를 Markdown 표 모양으로 바꿔 구조 파서가 열·행을 잡게 한다. */
async function readXlsx(file: File): Promise<ExtractedText> {
  const { rows, name, names } = await readXlsxWorkbook(await file.arrayBuffer(), { sheetIndex: 0 });
  const table = rows.map((row) => `| ${row.map((cell) => String(cell ?? "").replace(/\|/g, "/")).join(" | ")} |`).join("\n");
  return {
    text: table,
    warning: names.length > 1 ? `엑셀 시트 ${names.length}개 중 ‘${name}’ 시트만 읽었습니다. 다른 시트는 예산 관리표의 ‘엑셀·시트 불러오기’에서 고를 수 있습니다.` : undefined
  };
}

/** 문서 전체를 구조 블록까지 포함해 읽는다. 양식 채우기는 blocks를, 기존 흐름은 text를 쓴다. */
export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const format = documentFormatOf(file.name);
  const extension = extensionOf(file);

  if (format === "hwp") return { text: "", blocks: [], format, warning: HWP_BINARY_GUIDANCE };
  if (extension === ".xlsx") {
    const extracted_ = await readXlsx(file);
    const text_ = extracted_.text.trim();
    return { text: text_, blocks: parseTextBlocks(text_), format: "xlsx", warning: extracted_.warning };
  }
  if (extension === ".xls") {
    return { text: "", blocks: [], format: "xls", warning: "예전 엑셀 파일(.xls)은 읽지 못합니다. 엑셀에서 ‘다른 이름으로 저장 → .xlsx 또는 .csv’로 저장해 올려 주세요." };
  }

  let extracted: ExtractedText;
  if (textLikeExtensions.includes(extension)) extracted = await readTextFile(file, extension);
  else if (format === "docx") extracted = await readDocx(file);
  else if (format === "pdf") extracted = await readPdf(file);
  else if (format === "hwpx") extracted = await readHwpx(file);
  else return { text: "", blocks: [], format, warning: UNSUPPORTED_FORMAT_GUIDANCE };

  const text = extracted.text.trim();
  const blocks = parseTextBlocks(text);
  if (!text) return { text: "", blocks: [], format, warning: extracted.warning || "문서에서 글자를 찾지 못했습니다. 내용을 복사해 붙여넣어 주세요." };
  return { text, blocks, format, warning: extracted.warning };
}

export async function extractTextFromFile(file: File): Promise<ExtractedText> {
  const { text, warning } = await extractDocument(file);
  return { text, warning };
}
