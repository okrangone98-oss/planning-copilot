import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import mammoth from "mammoth";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stripXml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.trim();
}

async function readHwpx(filePath) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const sectionFiles = Object.values(zip.files)
    .filter((entry) => !entry.dir && /Contents\/section\d+\.xml$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const files = sectionFiles.length
    ? sectionFiles
    : Object.values(zip.files).filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml"));

  const chunks = [];
  for (const entry of files) {
    const text = stripXml(await entry.async("text"));
    if (text.length > 20) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}

async function readPdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const pdf = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return pages.join("\n\n").trim();
}

const samples = [
  ["docx", "양양잇다_사업계획서_원본.docx", readDocx],
  ["hwpx", "공고_2026_325_생활문화혁신지원.hwpx", readHwpx],
  ["pdf", "양양잇다_생활문화혁신지원_사업계획서_초안.pdf", readPdf]
];

for (const [kind, name, reader] of samples) {
  const filePath = path.join(root, name);
  try {
    const text = await reader(filePath);
    console.log(`${kind}: ${text.length} chars`);
    console.log(text.slice(0, 120).replace(/\s+/g, " "));
  } catch (error) {
    console.log(`${kind}: failed`);
    console.log(error.message);
  }
}
