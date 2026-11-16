// 구글 시트·엑셀에서 복사한 표(TSV), CSV, Markdown 표(|)를 예산 편성 행으로 읽는다.
// 브라우저와 node 테스트에서 함께 쓰므로 mjs로 두고, 타입은 budgetImport.d.mts에서 정의한다.
// 원칙: 읽지 못한 줄은 조용히 버리지 않고 warnings로 남긴다. 금액은 단가×수량으로만 계산한다.

import { emptyBudgetLine, formatWon, lineAmount, parseAmount, parseQuantity } from "./grantWorkflow.mjs";

const MAX_ROWS = 300;
const MAX_CELL = 300;

/** 머리글 이름 → 예산 행 필드. 표마다 부르는 말이 달라 흔한 표기를 모두 받는다. */
export const HEADER_ALIASES = {
  category: ["비목", "비목명", "예산비목", "구분", "항목", "분류", "category"],
  item: ["세목", "세목명", "내역", "상세", "세부항목", "세부내역", "품명", "지출내역", "item", "detail"],
  unitCost: ["단가", "단가원", "단가금액", "단위단가", "unitcost", "unitprice", "price"],
  quantity: ["수량", "수량회", "횟수", "quantity", "qty", "count"],
  amount: ["금액", "합계금액", "총액", "예산액", "편성액", "계획액", "예산편성액", "편성", "amount", "total", "budget"],
  spent: ["집행액", "집행금액", "집행", "지출액", "실집행액", "실집행", "spent", "executed"],
  basis: ["산출근거", "산출기초", "산출내역", "계산근거", "산출", "basis", "calculation"],
  note: ["비고", "메모", "참고", "note", "remark", "memo"]
};

const TOTAL_WORDS = ["합계", "총계", "소계", "총합", "계"];

/** 예산 행에 남길 칸 — 표에서 읽은 집행액 같은 곁가지 값이 저장 데이터로 새지 않게 한다. */
export const BUDGET_LINE_FIELDS = ["category", "item", "unitCost", "quantity", "basis", "note"];

/** 역할 → 예산 행 필드. 역할이 없으면 빈 글자. */
export function fieldOfRole(role) {
  const map = {
    category: "category",
    item: "item",
    unitPrice: "unitCost",
    qty: "quantity",
    budget: "amount",
    spent: "spent",
    basis: "basis",
    note: "note"
  };
  return map[role] || "";
}

/** 예산 행에서 예산표 칸만 골라낸다(사용자 열의 칸 값 포함). */
export function pickBudgetFields(line) {
  const source = line && typeof line === "object" ? line : {};
  const picked = {};
  for (const field of BUDGET_LINE_FIELDS) picked[field] = cellText(source[field]);
  const custom = source.custom && typeof source.custom === "object" && !Array.isArray(source.custom) ? source.custom : null;
  if (custom) {
    const cells = {};
    for (const [key, value] of Object.entries(custom)) {
      const id = cellText(key).slice(0, 40);
      const text = cellText(value);
      if (id && text) cells[id] = text;
    }
    if (Object.keys(cells).length) picked.custom = cells;
  }
  return picked;
}

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/[\s()（）[\]{}·:：]/g, "")
    .replace(/원$/, "")
    .toLowerCase();
}

function cellText(value) {
  return String(value ?? "").replace(/\uFEFF/g, "").trim().slice(0, MAX_CELL);
}

/** 탭이 하나라도 있으면 시트 복사(TSV), 파이프로 시작하는 줄이면 Markdown 표, 아니면 CSV. */
export function detectDelimiter(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.some((line) => line.includes("\t"))) return "\t";
  if (lines.some((line) => line.trim().startsWith("|"))) return "|";
  return ",";
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

/** Markdown 표의 구분선(|---|---|)과 빈 줄은 행으로 세지 않는다. */
function isSeparatorRow(cells) {
  const filled = cells.filter((cell) => cell.trim());
  return filled.length > 0 && filled.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

/**
 * 첫 줄이 머리글이면 열 이름으로 자리를 찾는다. 못 찾으면 null.
 * columns 를 넘기면 사업이 쓰는 열 이름(바꾼 머리글·사용자 열)을 먼저 맞춘다 —
 * 표 머리글이 표와 다른 이름이어도 사용자의 뜻을 따른다.
 * @param {string[]} cells 머리글 줄
 * @param {Array<{id:string, role:string, label:string}>|null} columns 사업의 표 열 정의
 */
export function mapHeaderRow(cells, columns = null) {
  const mapping = {};
  let hits = 0;
  const cols = Array.isArray(columns) ? columns.filter((column) => column && column.label) : [];
  const allowed = cols.length
    ? new Set([...cols.map((column) => (column.role === "custom" ? `custom:${column.id}` : fieldOfRole(column.role))).filter(Boolean), "spent", "amount"])
    : null;
  cells.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    // ① 사용자가 붙인 열 이름을 먼저 — 같은 이름의 기본 별칭보다 사용자의 열을 따른다.
    const own = cols.find((column) => normalizeHeader(column.label) === key);
    if (own) {
      const target = own.role === "custom" ? `custom:${own.id}` : fieldOfRole(own.role);
      if (target && mapping[target] === undefined) {
        mapping[target] = index;
        hits += 1;
      }
      return;
    }
    // ② 흔한 표기(비목·세목·단가…)는 그 역할의 열이 있을 때만 받는다.
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (mapping[field] !== undefined) continue;
      if (allowed && !allowed.has(field)) continue;
      if (aliases.some((alias) => normalizeHeader(alias) === key)) {
        mapping[field] = index;
        hits += 1;
        return;
      }
    }
  });
  // 비목·세목·단가·수량 가운데 2개 이상을 알아봐야 머리글로 인정한다(우연한 일치 방지).
  // 사용자 열 이름을 알아봤으면 그것만으로도 머리글로 인정한다(국비·지방비만 있는 표).
  const needed = ["category", "item", "unitCost", "quantity"].filter((field) => mapping[field] !== undefined);
  const customHits = Object.keys(mapping).filter((key) => key.startsWith("custom:")).length;
  return (needed.length >= 2 || (needed.length >= 1 && customHits >= 1) || customHits >= 2) && hits >= 2 ? mapping : null;
}

function positionalMapping(cellCount, columns = null) {
  const cols = Array.isArray(columns) ? columns.filter((column) => column?.label) : [];
  // 사용자가 정한 열 순서대로 읽는다 — 내려받은 표나 같은 표를 다시 붙일 때 자리가 어긋나지 않게.
  if (cols.length) {
    const mapping = {};
    cols.forEach((column, index) => {
      if (index >= cellCount) return;
      const target = column.role === "custom" ? `custom:${column.id}` : fieldOfRole(column.role);
      if (target && mapping[target] === undefined) mapping[target] = index;
    });
    return mapping;
  }
  const mapping = { category: 0, item: 1, unitCost: 2, quantity: 3, basis: 4, note: 5 };
  // 금액 열이 섞여 들어온 7열 표(비목·세목·단가·수량·금액·산출근거·비고)도 흔하다.
  if (cellCount >= 7) {
    mapping.basis = 5;
    mapping.note = 6;
    mapping.amount = 4;
  }
  // 예산 관리표를 그대로 붙인 경우(편성액·집행액·잔액·산출근거·비고)도 순서대로 읽는다.
  if (cellCount >= 8) {
    mapping.spent = 5;
    mapping.basis = 6;
    mapping.note = 7;
  }
  if (cellCount >= 9) {
    mapping.spent = 5;
    mapping.basis = 7;
    mapping.note = 8;
  }
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

/**
 * 붙여넣은 표를 예산 행으로 읽는다.
 * @returns {{rows: Array<{category:string,item:string,unitCost:string,quantity:string,basis:string,note:string}>,
 *   hadHeader: boolean, delimiter: string, warnings: string[], totalAmount: number, lineCount: number}}
 */
export function parseBudgetTable(text, options = {}) {
  const maxRows = Number(options.maxRows) > 0 ? Number(options.maxRows) : MAX_ROWS;
  const columns = Array.isArray(options.columns) && options.columns.length ? options.columns : null;
  const raw = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = options.delimiter || detectDelimiter(raw);
  const warnings = [];
  const lines = raw.split("\n").filter((line) => line.trim());
  const rows = [];
  let hadHeader = false;
  let mapping = null;
  let totalAmount = 0;
  let spentTotal = 0;

  if (!lines.length) {
    return { rows, hadHeader, delimiter, warnings: ["붙여넣은 내용이 비어 있습니다."], totalAmount, spentTotal, lineCount: 0 };
  }

  lines.forEach((line, lineIndex) => {
    const cells = splitRow(line, delimiter).map(cellText);
    if (isSeparatorRow(cells)) return;
    if (cells.every((cell) => !cell)) return;

    if (!mapping && lineIndex === 0) {
      const header = mapHeaderRow(cells, columns);
      if (header) {
        mapping = header;
        hadHeader = true;
        return;
      }
    }
    if (!mapping) mapping = positionalMapping(cells.length, columns);

    if (isTotalRow(cells)) {
      warnings.push(`${lineIndex + 1}번째 줄은 합계 행으로 보고 건너뛰었습니다.`);
      return;
    }
    if (rows.length >= maxRows) return;

    const category = pick(cells, mapping.category);
    const item = pick(cells, mapping.item);
    const unitCostRaw = pick(cells, mapping.unitCost);
    const quantityRaw = pick(cells, mapping.quantity);
    const amountRaw = pick(cells, mapping.amount);
    const spentRaw = pick(cells, mapping.spent);
    const basis = pick(cells, mapping.basis);
    const note = pick(cells, mapping.note);

    if (!category && !item && !unitCostRaw && !amountRaw) return;

    let unitCost = parseAmount(unitCostRaw);
    let quantity = parseQuantity(quantityRaw);
    const amount = parseAmount(amountRaw);

    // 단가·수량 없이 금액만 온 줄은 금액을 단가로 두고 수량 1로 채운다.
    if (!unitCost && amount) {
      unitCost = amount;
      if (!quantity) quantity = 1;
    }
    if (!quantity) quantity = 1;
    if (!category && !item) {
      warnings.push(`${lineIndex + 1}번째 줄에 비목·세목이 없어 건너뛰었습니다.`);
      return;
    }
    if (!unitCost) {
      warnings.push(`${lineIndex + 1}번째 줄(${item || category})의 단가를 숫자로 읽지 못했습니다.`);
    }

    const parsedLine = {
      ...emptyBudgetLine(),
      category,
      item,
      unitCost: unitCost ? String(unitCost) : "",
      quantity: quantityRaw ? String(quantityRaw) : String(quantity),
      basis,
      note
    };
    // 사용자 열의 칸 값 — 열 id 로 남긴다.
    const customCells = {};
    for (const [key, index] of Object.entries(mapping)) {
      if (!key.startsWith("custom:") || index === undefined) continue;
      const value = pick(cells, index);
      if (value) customCells[key.slice("custom:".length)] = value;
    }
    if (Object.keys(customCells).length) parsedLine.custom = customCells;
    // 집행액은 예산표 칸이 아니라 원장 몫이다 — 표에 함께 실려 오면 따로 세어 둔다.
    const spent = parseAmount(spentRaw);
    if (spentRaw && !spent) {
      warnings.push(`${lineIndex + 1}번째 줄(${item || category})의 집행액을 숫자로 읽지 못했습니다.`);
    }
    if (amount && unitCost * quantity && Math.abs(amount - unitCost * quantity) > 1) {
      warnings.push(
        `${lineIndex + 1}번째 줄(${item || category})의 금액 ${formatWon(amount)}이 단가×수량 ${formatWon(unitCost * quantity)}과 다릅니다. 표의 단가·수량을 그대로 넣었습니다.`
      );
    }
    rows.push(spent ? { ...parsedLine, spent: String(spent) } : parsedLine);
    totalAmount += lineAmount(parsedLine);
    spentTotal += spent;
  });

  if (!rows.length) warnings.push("예산 행을 찾지 못했습니다. 첫 줄에 비목·세목·단가·수량 같은 머리글을 넣거나, 시트에서 표 전체를 복사해 붙여넣어 주세요.");
  if (!hadHeader && rows.length) {
    warnings.push(columns
      ? `머리글이 없어 표에 있는 열 순서(${columns.map((column) => column.label).join(" → ")})대로 읽었습니다.`
      : "머리글이 없어 비목 → 세목 → 단가 → 수량 → 산출근거 → 비고 순서로 읽었습니다.");
  }

  return { rows, hadHeader, delimiter, warnings, totalAmount, spentTotal, lineCount: rows.length };
}

/**
 * 읽은 행을 기존 예산표에 넣는 방법.
 * - append: 기존 표 아래에 덧붙인다.
 * - replace: 기존 표를 지우고 읽은 행으로 바꾼다.
 * - merge: 비목+세목이 같은 행은 값만 바꾸고 나머지는 덧붙인다.
 */
export function mergeBudgetLines(existing, imported, mode = "append") {
  const base = Array.isArray(existing) ? existing : [];
  const incoming = Array.isArray(imported) ? imported : [];
  const stamp = Date.now();
  const withId = (line, index) => ({ ...emptyBudgetLine(`import-${stamp}-${index}`), ...pickBudgetFields(line), id: line.id || `import-${stamp}-${index}` });

  if (mode === "replace") return incoming.map(withId);

  if (mode === "merge") {
    const next = base.map((line) => ({ ...line }));
    const indexByKey = new Map(next.map((line, index) => [`${line.category}::${line.item}`, index]));
    incoming.forEach((line) => {
      const key = `${line.category}::${line.item}`;
      const found = indexByKey.get(key);
      if (found === undefined) {
        indexByKey.set(key, next.length);
        next.push(withId(line, next.length));
      } else {
        next[found] = { ...next[found], ...pickBudgetFields(line), id: next[found].id };
      }
    });
    return next;
  }

  return [...base, ...incoming.map((line, index) => withId(line, base.length + index))];
}

/** 편성표를 다시 시트로 옮길 때 쓰는 TSV(머리글 포함). */
export function budgetLinesToTsv(lines) {
  const header = ["비목", "세목", "단가", "수량", "산출근거", "비고"];
  const body = (Array.isArray(lines) ? lines : []).map((line) => [
    line.category, line.item, line.unitCost, line.quantity, line.basis, line.note
  ]);
  return [header, ...body].map((row) => row.map((cell) => String(cell ?? "").replace(/[\t\n]/g, " ")).join("\t")).join("\n");
}

export const BUDGET_IMPORT_SAMPLE = [
  ["비목", "세목", "단가", "수량", "산출근거", "비고"],
  ["인건비", "외래강사비", "250,000", "8", "250,000원 × 8회", "두레동아리 4회 × 2명"],
  ["사업비", "행사 운영비", "1,200,000", "1", "1,200,000원 × 1식", "체험 부스"],
  ["홍보비", "현수막", "80,000", "3", "80,000원 × 3개", ""]
].map((row) => row.join("\t")).join("\n");
