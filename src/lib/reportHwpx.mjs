// 결과보고·초안 화면에서 바로 내려받는 .hwpx 문서 생성 — 브라우저에서만 돈다.
//
// 바탕은 public/hwpx/report-base.hwpx(최소 HWPX 템플릿: 쪽 설정만 있고 본문은 빈 문서)이고,
// 그 위에 제목·요약 표·섹션·예산 표 문단을 이어 붙여 Contents/section0.xml 을 만든다.
// 서식(글꼴·문단 모양·표 테두리)은 템플릿의 Contents/header.xml 을 그대로 참조하므로,
// 만든 파일은 한글에서 열었을 때 템플릿과 같은 서식을 쓴다.

import { budgetSummary, formatWon } from "./grantWorkflow.mjs";
import { attendanceReport, expenseSummary } from "./projectOperations.mjs";
import { escapeXmlText } from "./browserHwpxFiller.mjs";

export const REPORT_TEMPLATE_FILE = "report-base.hwpx";

/** 연습 양식과 같은 방식(document.baseURI 기준)으로 템플릿 주소를 만든다. */
export function reportTemplateUrl(baseUri) {
  const base = String(baseUri ?? "").trim() || "http://localhost/";
  try {
    return new URL(`hwpx/${REPORT_TEMPLATE_FILE}`, base).toString();
  } catch {
    return `hwpx/${REPORT_TEMPLATE_FILE}`;
  }
}

/* ────────────────────────── 문서 내용 ────────────────────────── */

function text(value, limit = 2000) {
  return String(value ?? "").replace(/\u0000/g, "").slice(0, limit).trim();
}

function dateText(value) {
  const raw = text(value, 20);
  if (!raw) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.` : raw;
}

function periodText(schedule) {
  const start = dateText(schedule?.projectStart);
  const end = dateText(schedule?.projectEnd);
  if (start && end) return `${start} ~ ${end}`;
  return start || end || "";
}

function numberCell(value) {
  const number = Math.round(Number(value) || 0);
  return number ? String(number).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "";
}

/** 본문 글을 줄 단위 블록으로 나눈다. 항목 기호로 시작하는 줄은 불릿으로 둔다. */
export function contentBlocks(content) {
  const lines = String(content ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const bullet = /^\s*([-·•○□▪▫※▶▷◦]|\d+[).]|[①-⑳])\s*/.exec(line);
    blocks.push({ type: bullet ? "bullet" : "paragraph", text: bullet ? line.trim() : line.trim() });
  }
  return blocks;
}

/**
 * 결과보고 문서의 내용 모델. 화면(GrantReportView)과 같은 계산 함수를 써서 숫자가 어긋나지 않는다.
 * @returns {{title:string, subtitle:string, metaRows:Array<{label:string,value:string}>, sections:Array<{title:string, blocks:Array}>, summary:Array<{label:string,value:string}>, budget:{headers:string[], rows:string[][]}|null, footer:string}}
 */
export function buildReportDocument({ plan, project, work, generatedAt } = {}) {
  const reportSections = Array.isArray(plan?.reportSections) ? plan.reportSections : [];
  const budget = budgetSummary(plan);
  const attendance = attendanceReport(work);
  const ledger = expenseSummary(work, plan);
  const title = text(plan?.programName, 120) || text(project?.projectName, 120) || "결과보고";
  const schedule = plan?.schedule || {};

  const metaRows = [
    { label: "사업명", value: title },
    { label: "수행기관", value: text(plan?.agency, 120) },
    { label: "회계연도", value: text(plan?.fundingYear, 10) },
    { label: "사업기간", value: periodText(schedule) },
    { label: "결과보고 마감", value: dateText(schedule.reportDeadline) },
    { label: "재원", value: text(plan?.fundingSource, 120) },
    { label: "총사업비", value: budget.total ? formatWon(budget.total) : "" }
  ].filter((row) => row.value);

  const sections = reportSections.map((section) => {
    const blocks = contentBlocks(section.content);
    return {
      title: text(section.title, 120) || "제목 없음",
      blocks: blocks.length ? blocks : [{ type: "note", text: "아직 쓰지 않았습니다. 제출 전에 내용을 채워 주세요." }]
    };
  });

  const summary = [];
  if (work && attendance.sessionTotal) {
    summary.push({ label: "회차", value: `전체 ${attendance.sessionTotal}회 · 집계 대상 ${attendance.tracked}회 · 완료 ${attendance.doneSessions}회` });
    summary.push({
      label: "참석 연인원",
      value: attendance.tracked ? `${attendance.attended}명 (완료 회차 ${attendance.attendedDone}명)` : "인원을 기록한 회차가 없습니다(0명이 아니라 집계 제외)"
    });
  }
  if (work && (ledger.expenseCount || ledger.total.plan)) {
    summary.push({
      label: "예산",
      value: `편성 ${formatWon(ledger.total.plan)} / 집행 ${formatWon(ledger.total.spent)} / 잔액 ${formatWon(ledger.total.balance)}${ledger.total.plan ? ` (집행률 ${ledger.total.rate}%)` : ""}`
    });
    summary.push({
      label: "증빙",
      value: `대상 ${ledger.evidence.total}건 중 ${ledger.evidence.checked}건 확인${ledger.evidence.missing ? ` · 미확인 ${ledger.evidence.missing}건(${formatWon(ledger.evidence.missingAmount)})` : ""}`
    });
  }

  const hasExpense = ledger.expenseCount > 0;
  const basisById = new Map((Array.isArray(plan?.budgetLines) ? plan.budgetLines : []).map((line) => [String(line?.id ?? ""), text(line?.basis, 80)]));
  const budgetRows = [];
  for (const bucket of ledger.rows || []) {
    for (const line of bucket.lines || []) {
      budgetRows.push([
        text(bucket.category, 40),
        text(line.item, 60),
        text(line.basis, 80) || basisById.get(String(line.id ?? "")) || (line.plan ? `${formatWon(line.plan)} 편성` : ""),
        line.plan ? numberCell(line.plan) : "",
        hasExpense ? numberCell(line.spent || 0) : ""
      ]);
    }
  }
  const budgetTable = budgetRows.length
    ? {
        headers: hasExpense ? ["비목", "세목", "산출 근거", "계획(원)", "집행(원)"] : ["비목", "세목", "산출 근거", "계획(원)"],
        rows: budgetRows,
        total: hasExpense
          ? ["합계", "", "", numberCell(ledger.total.plan), numberCell(ledger.total.spent)]
          : ["합계", "", "", numberCell(budget.total)]
      }
    : null;

  const stamp = generatedAt ? new Date(generatedAt) : new Date();
  const stampText = Number.isNaN(stamp.getTime())
    ? ""
    : `${stamp.getFullYear()}. ${stamp.getMonth() + 1}. ${stamp.getDate()}.`;

  return {
    title,
    subtitle: "결과보고",
    metaRows,
    sections,
    summary,
    budget: budgetTable,
    footer: `이 문서는 계획·회차·지출 원장에 적힌 값으로 만든 초안입니다. ${stampText ? `${stampText} 작성. ` : ""}기관 양식 순서와 다를 수 있으니 제출 전 증빙·출석부와 대조해 주세요.`
  };
}

/* ────────────────────────── HWPX 문단·표 ────────────────────────── */

const TITLE_STYLE = { paraPr: "9", charPr: "19" };
const SUBTITLE_STYLE = { paraPr: "8", charPr: "21" };
const HEADING_STYLE = { paraPr: "14", charPr: "22" };
const BODY_STYLE = { paraPr: "10", charPr: "17" };
const CELL_HEAD_STYLE = { paraPr: "9", charPr: "18" };
const NOTE_STYLE = { paraPr: "10", charPr: "11" };

function paragraphXml(contentXml, style) {
  return `<hp:p paraPrIDRef="${style.paraPr}" styleIDRef="0"><hp:run charPrIDRef="${style.charPr}">${contentXml}</hp:run></hp:p>`;
}

function textParagraph(value, style = BODY_STYLE) {
  return paragraphXml(`<hp:t>${escapeXmlText(value)}</hp:t>`, style);
}

function cellXml({ text: value, rowIndex, colIndex, width, height, header }) {
  const style = header ? "10" : "12";
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const paragraphs = lines
    .map((line) => paragraphXml(`<hp:t>${escapeXmlText(line)}</hp:t>`, header ? CELL_HEAD_STYLE : BODY_STYLE))
    .join("");
  return `<hp:tc name="" header="${header ? 1 : 0}" hasMargin="0" protect="0" editable="1" dirty="0" borderFillIDRef="${style}">`
    + `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${paragraphs}</hp:subList>`
    + `<hp:cellAddr colAddr="${colIndex}" rowAddr="${rowIndex}"/><hp:cellSpan colSpan="1" rowSpan="1"/>`
    + `<hp:cellSz width="${width}" height="${height}"/><hp:cellMargin left="141" right="141" top="141" bottom="141"/></hp:tc>`;
}

/**
 * 문서 폭 안에 들어가는 표 하나. 열 너비는 글자 수를 보고 나눈다(최소 8%, 합계 100%).
 */
export function tableXml({ headers, rows, total, width = 48757, rowHeight = 1100, tableId = "1200001" }) {
  const columnCount = headers.length;
  const weights = headers.map((header, column) => {
    const values = [header, ...rows.map((row) => row[column] || "")];
    const longest = values.reduce((max, cell) => Math.max(max, String(cell ?? "").length), 4);
    return Math.min(48, Math.max(8, Math.round((longest / Math.max(1, columnCount * 6)) * 18)));
  });
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => Math.max(1800, Math.round((weight / weightSum) * width)));

  const bodyRows = rows.slice();
  if (total) bodyRows.push(total);
  const rowCount = bodyRows.length + 1;
  const rowsXml = [
    `<hp:tr>${headers.map((header, column) => cellXml({
      text: header,
      rowIndex: 0,
      colIndex: column,
      width: widths[column],
      height: rowHeight,
      header: true
    })).join("")}</hp:tr>`,
    ...bodyRows.map((row, index) => `<hp:tr>${headers.map((_, column) => cellXml({
      text: row[column] ?? "",
      rowIndex: index + 1,
      colIndex: column,
      width: widths[column],
      height: rowHeight,
      header: false
    })).join("")}</hp:tr>`)
  ].join("");

  const table = `<hp:tbl id="${tableId}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1" rowCnt="${rowCount}" colCnt="${columnCount}" cellSpacing="0" borderFillIDRef="1" noAdjust="1">`
    + `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${rowHeight * rowCount}" heightRelTo="ABSOLUTE" protect="0"/>`
    + `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>`
    + `<hp:outMargin left="0" right="0" top="0" bottom="200"/><hp:inMargin left="140" right="140" top="140" bottom="140"/>`
    + `${rowsXml}</hp:tbl>`;
  return paragraphXml(table, BODY_STYLE);
}

const SECTION_MARKERS = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ", "Ⅺ", "Ⅻ"];

/**
 * 문서 모델을 HWPX 본문 문단으로 만든다. 템플릿의 secPr 문단 뒤에 그대로 붙이면 한 장의 문서가 된다.
 */
export function renderReportBodyXml(document) {
  const paragraphs = [];
  paragraphs.push(textParagraph(document.title, TITLE_STYLE));
  paragraphs.push(textParagraph(document.subtitle, SUBTITLE_STYLE));

  if (document.metaRows?.length) {
    paragraphs.push(tableXml({
      headers: ["구분", "내용"],
      rows: document.metaRows.map((row) => [row.label, row.value]),
      tableId: "1200001"
    }));
  }

  if (document.summary?.length) {
    paragraphs.push(textParagraph(`${SECTION_MARKERS[0]}. 사업 개요`, HEADING_STYLE));
    for (const row of document.summary) paragraphs.push(textParagraph(`${row.label}: ${row.value}`));
  }

  let markerIndex = document.summary?.length ? 1 : 0;
  for (const section of document.sections || []) {
    const marker = SECTION_MARKERS[markerIndex] || `${markerIndex + 1}.`;
    markerIndex += 1;
    paragraphs.push(textParagraph(`${marker}. ${section.title}`, HEADING_STYLE));
    for (const block of section.blocks || []) {
      const style = block.type === "note" ? NOTE_STYLE : BODY_STYLE;
      paragraphs.push(textParagraph(block.text, style));
    }
  }

  if (document.budget) {
    const marker = SECTION_MARKERS[markerIndex] || `${markerIndex + 1}.`;
    paragraphs.push(textParagraph(`${marker}. 예산 편성·집행`, HEADING_STYLE));
    paragraphs.push(tableXml({
      headers: document.budget.headers,
      rows: document.budget.rows,
      total: document.budget.total,
      tableId: "1200002"
    }));
  }

  if (document.footer) paragraphs.push(textParagraph(document.footer, NOTE_STYLE));
  return paragraphs.join("\n");
}

/**
 * 템플릿 .hwpx 바이트의 본문 뒤에 문서를 붙여 새 .hwpx 바이트를 만든다.
 * 템플릿의 mimetype·header.xml·content.hpf 는 그대로 두고 section0.xml 만 다시 쓴다.
 */
export async function buildReportHwpxBytes({ baseBytes, document, jszip } = {}) {
  const input = baseBytes instanceof Uint8Array ? baseBytes : new Uint8Array(baseBytes || []);
  if (!input.length) throw new Error("결과보고 템플릿을 불러오지 못했습니다. 잠시 뒤에 다시 시도해 주세요.");
  const JSZip = jszip || (await import("jszip")).default;
  const zip = await JSZip.loadAsync(input);
  const entry = zip.file("Contents/section0.xml");
  if (!entry) throw new Error("결과보고 템플릿에 본문(Contents/section0.xml)이 없습니다.");
  const base = await entry.async("text");
  const closeAt = base.lastIndexOf("</hs:sec>");
  if (closeAt < 0) throw new Error("결과보고 템플릿의 본문 구조를 읽지 못했습니다.");
  const sectionXml = `${base.slice(0, closeAt)}${renderReportBodyXml(document)}\n${base.slice(closeAt)}`;

  const output = new JSZip();
  const mimeEntry = zip.file("mimetype");
  if (mimeEntry) output.file("mimetype", await mimeEntry.async("uint8array"), { compression: "STORE" });
  for (const name of Object.keys(zip.files)) {
    const file = zip.files[name];
    if (file.dir) {
      output.folder(name.replace(/\/$/, ""));
      continue;
    }
    if (name === "mimetype") continue;
    if (name === "Contents/section0.xml") {
      output.file(name, sectionXml);
      continue;
    }
    output.file(name, await file.async("uint8array"), { binary: true });
  }
  const bytes = await output.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { bytes, sectionXml };
}

/** 내려받을 파일 이름 — "2026 양양 관광두레 플러스-결과보고.hwpx" */
export function reportFileName({ plan, project, fallback = "결과보고" } = {}) {
  const base = text(plan?.programName, 60) || text(project?.projectName, 60) || fallback;
  const cleaned = base.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return `${cleaned || fallback}-결과보고.hwpx`;
}
