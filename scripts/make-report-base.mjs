// 결과보고 .hwpx 내려받기의 바탕이 되는 최소 HWPX 템플릿을 만든다.
//
// 왜 연습 양식에서 뜨나: HWPX 의 서식(글꼴·문단 모양·표 테두리)은 Contents/header.xml 이 정한다.
// header.xml 을 새로 손으로 쓰면 한글에서 열 때 서식 참조가 어긋날 수 있어,
// 이미 한글에서 열리는 연습 양식의 header.xml 을 그대로 쓰고 본문만 비운다.
// 결과: mimetype · version.xml · META-INF/container.xml · Contents/content.hpf · header.xml · section0.xml(secPr 만)
//
// 다시 만들 때: node scripts/make-report-base.mjs

import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { parseHwpxXml } from "../src/lib/browserHwpxFiller.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "public/practice/plan-practice-form.hwpx");
const TARGET_DIR = path.join(ROOT, "public/hwpx");
const TARGET = path.join(TARGET_DIR, "report-base.hwpx");

/** 문서 첫 문단의 secPr·ctrl(쪽 설정)만 남기고 나머지 본문을 걷어 낸다. */
export function stripSectionBody(xml) {
  const source = String(xml ?? "");
  const root = parseHwpxXml(source);
  const findFirst = (node, local) => {
    for (const child of node.children || []) {
      if (child.type === "text") continue;
      if (child.local === local) return child;
      const found = findFirst(child, local);
      if (found) return found;
    }
    return undefined;
  };
  const paragraph = findFirst(root, "p");
  if (!paragraph) throw new Error("본문 첫 문단을 찾지 못했습니다.");
  const secPr = (paragraph.children || []).find((child) => child.type !== "text" && child.local === "secpr")
    || findFirst(paragraph, "secpr");
  if (!secPr) throw new Error("쪽 설정(secPr)을 찾지 못했습니다.");
  const run = secPr.parent;
  // run 안에서 secPr·ctrl 까지만 남긴다(표지 상자·본문은 버린다).
  let cut = secPr.end;
  for (const child of run.children || []) {
    if (child.type === "text") continue;
    if (child.local === "ctrl" && child.end > cut) cut = child.end;
  }
  const openTag = source.slice(paragraph.start, paragraph.openEnd);
  const runOpen = source.slice(run.start, run.openEnd);
  const body = source.slice(run.openEnd, cut);
  const sec = (root.children || []).find((child) => child.type !== "text" && child.local === "sec");
  const head = source.slice(0, sec ? sec.openEnd : source.indexOf("<hs:sec"));
  return `${head}${openTag}${runOpen}${body}</hp:run></hp:p>\n</hs:sec>\n`;
}

async function main() {
  const bytes = await fs.readFile(SOURCE);
  const zip = await JSZip.loadAsync(bytes);
  const sectionXml = await zip.file("Contents/section0.xml").async("text");
  const stripped = stripSectionBody(sectionXml);

  const out = new JSZip();
  out.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  for (const name of ["version.xml", "META-INF/container.xml", "Contents/content.hpf", "Contents/header.xml"]) {
    out.file(name, await zip.file(name).async("uint8array"), { binary: true });
  }
  out.file("Contents/section0.xml", stripped);

  await fs.mkdir(TARGET_DIR, { recursive: true });
  const buffer = await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await fs.writeFile(TARGET, buffer);
  console.log(`wrote ${path.relative(ROOT, TARGET)} (${buffer.length} bytes, section0.xml ${stripped.length} bytes)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await main();
}
