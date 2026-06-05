type ExtractedText = {
  text: string;
  warning?: string;
};

const textLikeExtensions = [".txt", ".md", ".csv", ".html", ".htm", ".json", ".xml"];

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

function stripXml(value: string) {
  return decodeEntities(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

async function readTextFile(file: File): Promise<ExtractedText> {
  const text = (await file.text()).trim();
  if (!text || text.includes("\u0000")) {
    return {
      text: "",
      warning: "텍스트를 읽지 못했습니다. 문서 내용을 복사해 붙여넣어 주세요."
    };
  }
  return { text };
}

async function readDocx(file: File): Promise<ExtractedText> {
  const mammoth = (await import("mammoth/mammoth.browser")).default;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return {
    text: result.value.trim(),
    warning: result.messages.length ? "DOCX 일부 서식은 제외하고 본문 텍스트만 가져왔습니다." : undefined
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
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pages.push(`--- ${pageNumber}쪽 ---\n${text}`);
  }

  return {
    text: pages.join("\n\n").trim(),
    warning: "PDF는 본문 텍스트만 가져옵니다. 스캔 이미지 PDF는 별도 OCR이 필요합니다."
  };
}

async function readHwpx(file: File): Promise<ExtractedText> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sectionFiles = Object.values(zip.files)
    .filter((entry) => !entry.dir && /Contents\/section\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const files = sectionFiles.length
    ? sectionFiles
    : Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml"));

  const chunks: string[] = [];
  for (const entry of files) {
    const xml = await entry.async("text");
    const text = stripXml(xml);
    if (text.length > 20) chunks.push(text);
  }

  return {
    text: chunks.join("\n\n").trim(),
    warning: "HWPX는 본문 XML에서 텍스트를 가져옵니다. 표와 각주는 일부 순서가 달라질 수 있습니다."
  };
}

export async function extractTextFromFile(file: File): Promise<ExtractedText> {
  const extension = extensionOf(file);

  if (textLikeExtensions.includes(extension)) return readTextFile(file);
  if (extension === ".docx") return readDocx(file);
  if (extension === ".pdf") return readPdf(file);
  if (extension === ".hwpx") return readHwpx(file);

  return {
    text: "",
    warning: "지원하는 파일은 PDF, DOCX, HWPX, TXT, MD, CSV, HTML, JSON, XML입니다."
  };
}
