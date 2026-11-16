// 구글 시트·엑셀에서 복사한 지출 내역(TSV), CSV, Markdown 표(|)를 지출 원장 행으로 읽는다.
// 브라우저와 node 테스트에서 함께 쓰므로 mjs로 두고, 타입은 expenseImport.d.mts에 정의한다.
// 원칙: 읽지 못한 줄은 조용히 버리지 않고 warnings로 남긴다. 비목은 이름으로만 맞춰 보고,
// 맞지 않으면 비목 id를 비워 둔 채('비목 미지정') 금액은 잃지 않는다.

import { detectDelimiter } from "./budgetImport.mjs";
import { formatWon, parseAmount } from "./grantWorkflow.mjs";
import { normalizeDeadline } from "./projectWorkspace.mjs";

const MAX_ROWS = 600;
const MAX_CELL = 300;

/** 머리글 이름 → 지출 행 필드. 정산 시트마다 부르는 말이 달라 흔한 표기를 모두 받는다. */
export const EXPENSE_HEADER_ALIASES = {
  spentAt: ["사용일자", "사용일", "지출일", "지출일자", "일자", "날짜", "거래일", "date", "spentat"],
  vendor: ["거래처", "사용처", "가맹점", "상호", "업체", "vendor", "merchant", "payee"],
  description: ["적요", "내역", "사용내역", "지출내역", "내용", "품명", "description", "detail", "memo"],
  amount: ["금액", "지출액", "사용금액", "결제금액", "집행액", "amount", "total"],
  category: ["비목", "예산비목", "비목명", "구분", "항목", "분류", "category"],
  item: ["세목", "세부항목", "세부내역", "item"],
  status: ["상태", "집행상태", "지출상태", "status"],
  evidenceRef: ["증빙", "증빙번호", "증빙참조", "전표", "전표번호", "evidence", "receipt"],
  evidenceNote: ["비고", "참고", "메모", "note", "remark"],
  session: ["회차", "차수", "session"]
};

const TOTAL_WORDS = ["합계", "총계", "소계", "총합", "계"];
// '지출예정'이 '지출'로 먼저 읽히지 않도록 예정·계획을 완료보다 먼저 본다.
const STATUS_RULES = [
  { id: "pending", words: ["지출예정", "집행예정", "예정", "미지급", "pending"] },
  { id: "planned", words: ["계획만", "계획", "예상", "planned"] },
  { id: "paid", words: ["집행완료", "지출완료", "완료", "지출", "집행", "결제", "지급", "paid", "done", "o"] }
];

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/[\s()（）[\]{}·:：]/g, "")
    .replace(/원$/, "")
    .toLowerCase();
}

function cellText(value) {
  return String(value ?? "").replace(/\uFEFF/g, "").trim().slice(0, MAX_CELL);
}

/** 따옴표로 감싼 칸(쉼표·줄바꿈 포함)을 지키는 CSV 한 줄 파서. */
function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' && current.trim() === "") {
      quoted = true;
      current = "";
      continue;
    }
    if (char === ",") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

function splitRow(line, delimiter) {
  if (delimiter === "\t") return line.split("\t");
  if (delimiter === "|") {
    let trimmed = line.trim();
    if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
    if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
    return trimmed.split("|");
  }
  return parseCsvLine(line);
}

function isSeparatorRow(cells) {
  const filled = cells.filter((cell) => cell.trim());
  return filled.length > 0 && filled.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

/** 첫 줄이 머리글이면 열 이름으로 자리를 찾는다. 날짜·적요·금액 가운데 2개 이상을 알아봐야 머리글로 인정한다. */
export function mapExpenseHeader(cells) {
  const mapping = {};
  let hits = 0;
  cells.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    for (const [field, aliases] of Object.entries(EXPENSE_HEADER_ALIASES)) {
      if (mapping[field] !== undefined) continue;
      if (aliases.some((alias) => normalizeHeader(alias) === key)) {
        mapping[field] = index;
        hits += 1;
        return;
      }
    }
  });
  const needed = ["spentAt", "description", "amount"].filter((field) => mapping[field] !== undefined);
  return needed.length >= 2 && hits >= 2 ? mapping : null;
}

function positionalMapping(cellCount) {
  // 흔한 순서: 날짜 · 거래처 · 적요 · 금액 · 비목
  const mapping = { spentAt: 0, vendor: 1, description: 2, amount: 3, category: 4, item: 5, evidenceRef: 6 };
  if (cellCount >= 4) mapping.status = cellCount > 7 ? 7 : undefined;
  return mapping;
}

function pick(cells, index) {
  return index === undefined ? "" : cellText(cells[index]);
}

function isTotalRow(cells) {
  const first = cells.find((cell) => cellText(cell));
  if (!first) return false;
  const text = normalizeHeader(first);
  return TOTAL_WORDS.some((word) => text === word || text.startsWith(word));
}

/** 2026-11-03 · 2026.11.3 · 2026/11/03 · 20261103 · 26.11.03 을 YYYY-MM-DD로 읽는다. */
export function normalizeSpentAt(value) {
  const raw = cellText(value).replace(/\s/g, "");
  if (!raw) return "";
  const direct = normalizeDeadline(raw.replace(/[./]/g, "-"));
  if (direct) return direct;
  const four = raw.match(/^(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})\.?$/);
  if (four) return normalizeDeadline(`${four[1]}-${four[2].padStart(2, "0")}-${four[3].padStart(2, "0")}`);
  const eight = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (eight) return normalizeDeadline(`${eight[1]}-${eight[2]}-${eight[3]}`);
  const short = raw.match(/^(\d{2})\D(\d{1,2})\D(\d{1,2})\.?$/);
  if (short) return normalizeDeadline(`20${short[1]}-${short[2].padStart(2, "0")}-${short[3].padStart(2, "0")}`);
  return "";
}

export function readExpenseStatus(value) {
  const text = normalizeHeader(value);
  if (!text) return "";
  for (const rule of STATUS_RULES) {
    if (
      rule.words.some((word) => {
        const target = normalizeHeader(word);
        // 한 글자 표기(O/X)는 글자 전체가 같을 때만 상태로 본다.
        return target.length === 1 ? text === target : text === target || text.includes(target);
      })
    ) {
      return rule.id;
    }
  }
  return "";
}

/**
 * 붙여넣은 표를 지출 행으로 읽는다.
 * @returns {{rows: Array<{spentAt:string,vendor:string,description:string,amount:number,category:string,item:string,status:string,evidenceRef:string,evidenceNote:string}>, hadHeader:boolean, delimiter:string, warnings:string[], totalAmount:number, rowCount:number}}
 */
export function parseExpenseTable(text, options = {}) {
  const maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : MAX_ROWS;
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = options.delimiter || detectDelimiter(raw);
  const warnings = [];
  const lines = raw.split("\n").filter((line) => line.trim());
  const rows = [];
  let hadHeader = false;
  let mapping = null;
  let totalAmount = 0;
  let statusGuessed = false;

  if (!lines.length) {
    return { rows, hadHeader, delimiter, warnings: ["붙여넣은 내용이 비어 있습니다."], totalAmount, rowCount: 0 };
  }

  lines.forEach((line, lineIndex) => {
    const cells = splitRow(line, delimiter).map(cellText);
    if (isSeparatorRow(cells)) return;
    if (cells.every((cell) => !cell)) return;

    if (!mapping && lineIndex === 0) {
      const header = mapExpenseHeader(cells);
      if (header) {
        mapping = header;
        hadHeader = true;
        return;
      }
    }
    if (!mapping) mapping = positionalMapping(cells.length);

    if (isTotalRow(cells)) {
      warnings.push(`${lineIndex + 1}번째 줄은 합계 행으로 보고 건너뛰었습니다.`);
      return;
    }
    if (rows.length >= maxRows) return;

    const spentAtRaw = pick(cells, mapping.spentAt);
    const vendor = pick(cells, mapping.vendor);
    const description = pick(cells, mapping.description);
    const amountRaw = pick(cells, mapping.amount);
    const category = pick(cells, mapping.category);
    const item = pick(cells, mapping.item);
    const statusRaw = pick(cells, mapping.status);
    const evidenceRef = pick(cells, mapping.evidenceRef);
    const evidenceNote = pick(cells, mapping.evidenceNote);

    const amount = parseAmount(amountRaw);
    if (!description && !vendor && !amount) {
      warnings.push(`${lineIndex + 1}번째 줄에 적요·거래처·금액이 없어 건너뛰었습니다.`);
      return;
    }
    if (!amount) {
      warnings.push(`${lineIndex + 1}번째 줄(${description || vendor})의 금액을 숫자로 읽지 못해 건너뛰었습니다.`);
      return;
    }
    let spentAt = "";
    if (spentAtRaw) {
      spentAt = normalizeSpentAt(spentAtRaw);
      if (!spentAt) warnings.push(`${lineIndex + 1}번째 줄의 날짜 '${spentAtRaw}'를 읽지 못해 지출일을 비워 두었습니다.`);
    }
    const status = readExpenseStatus(statusRaw) || "paid";
    if (!readExpenseStatus(statusRaw)) statusGuessed = true;

    rows.push({ spentAt, vendor, description, amount, category, item, status, evidenceRef, evidenceNote });
    totalAmount += amount;
  });

  if (!rows.length) {
    warnings.push("지출 행을 찾지 못했습니다. 첫 줄에 날짜·거래처·적요·금액 같은 머리글을 넣거나, 시트에서 표 전체를 복사해 붙여넣어 주세요.");
  }
  if (!hadHeader && rows.length) {
    warnings.push("머리글이 없어 날짜 → 거래처 → 적요 → 금액 → 비목 순서로 읽었습니다.");
  }
  if (statusGuessed && rows.length) {
    warnings.push("집행 상태를 읽지 못한 줄은 '집행 완료'로 넣었습니다. 필요하면 표에서 고쳐 주세요.");
  }

  return { rows, hadHeader, delimiter, warnings, totalAmount, rowCount: rows.length };
}

function normalizeName(value) {
  return String(value ?? "").replace(/\s/g, "").toLowerCase();
}

/**
 * 비목 이름으로 계획 행 하나를 찾는다. 같은 이름이 여럿이면 첫 행을 쓰고,
 * 찾지 못하면 null(비목 미지정)을 돌려준다. 금액은 맞지 않아도 잃지 않는다.
 */
export function resolveBudgetLine(row, budgetLines) {
  const lines = Array.isArray(budgetLines) ? budgetLines : [];
  const category = normalizeName(row?.category);
  const item = normalizeName(row?.item);
  if (!category && !item) return null;
  if (category && item) {
    const exact = lines.find((line) => normalizeName(line?.category) === category && normalizeName(line?.item) === item);
    if (exact) return exact;
  }
  if (category) {
    const byCategory = lines.find((line) => normalizeName(line?.category) === category);
    if (byCategory) return byCategory;
    const containsCategory = lines.find((line) => {
      const lineCategory = normalizeName(line?.category);
      const lineItem = normalizeName(line?.item);
      return lineCategory && (lineCategory.includes(category) || category.includes(lineCategory))
        || lineItem && (lineItem.includes(category) || category.includes(lineItem));
    });
    if (containsCategory) return containsCategory;
  }
  if (item) {
    const byItem = lines.find((line) => {
      const lineItem = normalizeName(line?.item);
      return lineItem && (lineItem === item || lineItem.includes(item) || item.includes(lineItem));
    });
    if (byItem) return byItem;
  }
  return null;
}

/**
 * 읽은 행을 저장할 지출 입력값으로 바꾼다. 비목 이름은 계획 행 id로 바꿔 두고,
 * 맞지 않은 줄은 unmatched로 세어 화면에서 '비목 미지정'으로 보이게 한다.
 */
export function toExpenseInputs(rows, budgetLines) {
  const inputs = [];
  const unmatched = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const line = resolveBudgetLine(row, budgetLines);
    inputs.push({
      budgetLineId: line?.id || "",
      spentAt: row.spentAt,
      vendor: row.vendor,
      description: row.description || row.vendor || "지출",
      amount: row.amount,
      status: row.status,
      evidenceRef: row.evidenceRef,
      evidenceNote: row.evidenceNote,
      evidenceChecked: false
    });
    if (!line) unmatched.push({ description: row.description || row.vendor, amount: row.amount });
  }
  return { inputs, unmatched };
}

/** 지출 원장을 다시 시트로 옮길 때 쓰는 TSV(머리글 포함). 비목은 계획 행의 비목 이름으로 적는다. */
export function expensesToTsv(expenses, budgetLines) {
  const header = ["사용일자", "거래처", "적요", "금액", "비목", "상태", "증빙", "비고"];
  const lines = Array.isArray(budgetLines) ? budgetLines : [];
  const body = (Array.isArray(expenses) ? expenses : []).map((expense) => {
    const line = lines.find((item) => item?.id && item.id === expense.budgetLineId);
    return [
      expense.spentAt,
      expense.vendor,
      expense.description,
      expense.amount,
      line?.category || (expense.budgetLineId ? `비목 ${expense.budgetLineId}` : ""),
      expense.status === "paid" ? "집행 완료" : expense.status === "pending" ? "지출 예정" : "계획만",
      expense.evidenceRef,
      expense.evidenceNote
    ];
  });
  return [header, ...body]
    .map((row) => row.map((value) => String(value ?? "").replace(/[\t\n]/g, " ")).join("\t"))
    .join("\n");
}

export const EXPENSE_IMPORT_SAMPLE = [
  ["사용일자", "거래처", "적요", "금액", "비목", "상태", "증빙"],
  ["2026-11-03", "양양문구", "회차 준비물(포스트잇·마커)", "48,000", "운영비", "집행 완료", "카드전표 11/03"],
  ["2026-11-07", "이음터 카페", "1회차 간담회 다과", "120,000", "운영비", "집행 완료", ""],
  ["2026-11-12", "두레 강사", "2회차 강사비", "250,000", "인건비", "지출 예정", ""]
].map((row) => row.join("\t")).join("\n");

/** 합계 한 줄만 보여 줄 때 쓰는 표기. 화면과 테스트가 같은 숫자를 보게 한다. */
export function formatExpenseTotal(amount) {
  return formatWon(amount);
}
