// 예산 관리표의 열 정의 — 머리글 이름·순서·개수를 사용자가 바꿀 수 있게 하는 순수 함수 모음.
//
// 원칙
//  - 역할(role)이 계산과 자료 연결을 정하고, 이름(label)은 화면·내려받기·서류 채우기에 그대로 쓴다.
//    이름을 '세부사업명'으로 바꾸면 표 머리글·CSV/XLSX 머리글·서류 양식 채우기 라벨이 모두 그 이름을 쓴다.
//  - 단가·수량은 편성액(단가 × 수량) 계산의 근거, 편성액·집행액·잔액은 계산 칸이라 직접 고치지 않는다.
//  - 역할이 없는 사용자 열(custom)의 값은 예산 행의 custom[열 id] 에 남는다. 열을 지워도 값은 남는다.

/** 표에 둘 수 있는 열 수 상한 — 넘기면 화면·서류가 감당하지 못한다. */
export const MAX_BUDGET_COLUMNS = 24;
const MAX_LABEL = 24;

/**
 * 역할별 기본 열 — id 는 예산 행에서 값을 읽는 자리(legacy key)와 같게 둔다.
 * key 는 예전 코드·시트 클래스가 쓰던 이름이라 함께 남긴다.
 */
export const BUDGET_ROLE_SPECS = {
  category: { label: "비목", key: "category", kind: "text", align: "left", width: 104 },
  item: { label: "세목", key: "item", kind: "text", align: "left", width: 136 },
  unitPrice: { label: "단가", key: "unitCost", kind: "money", align: "right", width: 104 },
  qty: { label: "수량", key: "quantity", kind: "quantity", align: "right", width: 64 },
  budget: { label: "편성액", key: "amount", kind: "calc", align: "right", width: 110 },
  spent: { label: "집행액", key: "spent", kind: "spent", align: "right", width: 110 },
  balance: { label: "잔액", key: "balance", kind: "calc", align: "right", width: 110 },
  basis: { label: "산출근거", key: "basis", kind: "text", align: "left", width: 176 },
  note: { label: "비고", key: "note", kind: "text", align: "left", width: 132 }
};

/** 값이 아니라 계산으로 채워지는 역할 — 직접 고칠 수 없다. */
export const CALC_ROLES = new Set(["budget", "balance"]);
/** 지출 원장에서 오는 역할 — 원장 기록이 있으면 격자에서 고칠 수 없다. */
export const LEDGER_ROLES = new Set(["spent"]);

export const DEFAULT_BUDGET_COLUMNS = Object.entries(BUDGET_ROLE_SPECS).map(([role, spec]) => ({
  id: role,
  role,
  key: spec.key,
  label: spec.label,
  kind: spec.kind,
  align: spec.align,
  width: spec.width,
  numeric: spec.kind === "calc" || spec.kind === "spent" || spec.kind === "money"
}));

/** 역할 → 예산 행의 필드 이름. 역할이 없는 열은 null. */
export const ROLE_LINE_FIELD = {
  category: "category",
  item: "item",
  unitPrice: "unitCost",
  qty: "quantity",
  basis: "basis",
  note: "note"
};

/** 열의 종류 — 숫자 칸인지, 합계를 내는 칸인지 화면·내려받기가 함께 본다. */
export function isNumericColumn(column) {
  if (!column) return false;
  if (column.role === "custom") return column.kind === "number" || column.kind === "money";
  if (column.role === "unitPrice" || column.role === "qty") return true;
  return column.kind === "calc" || column.kind === "spent" || column.kind === "money";
}

/** 합계 줄에 숫자를 더하는 열인가 — 계산 칸과 숫자 사용자 열. */
export function isTotalColumn(column) {
  if (!column) return false;
  if (CALC_ROLES.has(column.role) || LEDGER_ROLES.has(column.role)) return true;
  return column.role === "custom" && isNumericColumn(column);
}

export function isCustomColumn(column) {
  return column?.role === "custom";
}

/** 사용자가 손댄 열인가 — 이름을 바꿨거나 새로 만든 열. 서류·글에 이 열의 이름을 먼저 내보낸다. */
export function isCustomizedColumn(column) {
  if (!column) return false;
  if (column.role === "custom") return true;
  const spec = BUDGET_ROLE_SPECS[column.role];
  return Boolean(spec) && String(column.label ?? "").trim() !== spec.label;
}

/** 역할의 기본 이름 — 비운 이름을 되돌릴 때 쓴다. */
export function defaultLabelOf(role) {
  return BUDGET_ROLE_SPECS[role]?.label ?? "새 열";
}

function cleanLabel(value, fallback) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return (text || fallback).slice(0, MAX_LABEL);
}

function cleanId(value, fallback) {
  const text = String(value ?? "").replace(/[^\w가-힣-]+/g, "").slice(0, 40);
  return text || fallback;
}

function clampWidth(value, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(280, Math.max(56, number));
}

/** 새 사용자 열에 붙일 id — 이미 쓰는 id 와 겹치지 않게 번호를 올린다. */
export function nextColumnId(columns, base = "col") {
  const used = new Set((Array.isArray(columns) ? columns : []).map((column) => String(column?.id ?? "")));
  let index = 1;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/**
 * 사용자 열 하나 만들기.
 * @param {{label?:string, numeric?:boolean}} spec
 * @param {Array} columns 이미 쓰는 열(겹치지 않는 id·이름을 만들기 위해)
 */
export function createBudgetColumn({ label, numeric = false } = {}, columns = []) {
  const id = nextColumnId(columns);
  const usedLabels = new Set((Array.isArray(columns) ? columns : []).map((column) => String(column?.label ?? "").trim()));
  let name = cleanLabel(label, "새 열");
  let suffix = 2;
  while (usedLabels.has(name)) {
    name = cleanLabel(`${cleanLabel(label, "새 열")} ${suffix}`, `새 열 ${suffix}`);
    suffix += 1;
  }
  return {
    id,
    role: "custom",
    key: id,
    label: name,
    kind: numeric ? "number" : "text",
    align: numeric ? "right" : "left",
    width: numeric ? 104 : 120,
    numeric: Boolean(numeric)
  };
}

/**
 * 저장된 열 정의를 표에 쓸 수 있는 모양으로 다듬는다.
 *  - 없거나 비어 있으면 기본 열(비목·세목·단가·수량·편성액·집행액·잔액·산출근거·비고).
 *  - 역할은 하나씩만 남긴다(계산이 두 번 되지 않게). 이름이 겹치면 뒤 열에 번호를 붙인다.
 *  - id 는 반드시 있고 서로 달라야 한다(사용자 열 값의 열쇠).
 * @returns {Array} 정규화된 열 배열(최소 1열)
 */
export function normalizeBudgetColumns(input) {
  const list = Array.isArray(input) ? input : [];
  if (!list.length) return DEFAULT_BUDGET_COLUMNS.map((column) => ({ ...column }));

  const usedRoles = new Set();
  const usedIds = new Set();
  const usedLabels = new Set();
  const columns = [];
  for (const raw of list) {
    if (columns.length >= MAX_BUDGET_COLUMNS) break;
    if (!raw || typeof raw !== "object") continue;
    const role = Object.prototype.hasOwnProperty.call(BUDGET_ROLE_SPECS, raw.role)
      ? raw.role
      : (Object.prototype.hasOwnProperty.call(BUDGET_ROLE_SPECS, raw.id) ? raw.id : "custom");
    if (role !== "custom") {
      if (usedRoles.has(role)) continue; // 같은 역할은 한 번만 — 계산 칸이 두 개면 어느 쪽이 맞는지 알 수 없다.
      usedRoles.add(role);
    }
    const spec = BUDGET_ROLE_SPECS[role];
    const numeric = role === "custom" ? raw.numeric === undefined ? raw.kind !== "text" : Boolean(raw.numeric) : undefined;
    let id = cleanId(raw.id, role === "custom" ? nextColumnId(columns) : role);
    if (usedIds.has(id)) id = nextColumnId(columns, id.replace(/-\d+$/, "") || "col");
    usedIds.add(id);
    let label = cleanLabel(raw.label, role === "custom" ? `새 열 ${columns.length + 1}` : spec.label);
    if (usedLabels.has(label)) {
      let suffix = 2;
      while (usedLabels.has(`${label} ${suffix}`)) suffix += 1;
      label = `${label} ${suffix}`.slice(0, MAX_LABEL);
    }
    usedLabels.add(label);
    const kind = role === "custom" ? (numeric ? "number" : "text") : spec.kind;
    columns.push({
      id,
      role,
      key: role === "custom" ? id : spec.key,
      label,
      kind,
      align: kind === "text" ? "left" : "right",
      width: clampWidth(raw.width, role === "custom" ? (numeric ? 104 : 120) : spec.width),
      numeric: kind === "text" || kind === "quantity" ? false : true
    });
  }
  return columns.length ? columns : DEFAULT_BUDGET_COLUMNS.map((column) => ({ ...column }));
}

/** 열 정의를 저장용으로 줄인다 — 화면에 쓰는 계산값은 남기지 않는다. */
export function columnsForStorage(columns) {
  return normalizeBudgetColumns(columns).map((column) => ({
    id: column.id,
    role: column.role,
    label: column.label,
    kind: column.kind,
    width: column.width
  }));
}

/** 표에서 이 역할의 열. 없으면 null. */
export function columnOfRole(columns, role) {
  return (Array.isArray(columns) ? columns : []).find((column) => column?.role === role) || null;
}

/** 사용자 열의 값 — 예산 행의 custom[열 id]. */
export function customValueOf(line, columnId) {
  const custom = line && typeof line === "object" ? line.custom : null;
  if (!custom || typeof custom !== "object") return "";
  return String(custom[columnId] ?? "");
}

/** 행(row)에서 이 열이 보여 줄 값 — 숫자 역할은 숫자, 나머지는 글자. */
export function cellValueOf(row, column) {
  if (!row || !column) return "";
  switch (column.role) {
    case "category": return String(row.category ?? "");
    case "item": return String(row.item ?? "");
    case "unitPrice": return String(row.unitCost ?? "");
    case "qty": return String(row.quantity ?? "");
    case "budget": return Math.round(Number(row.amount) || 0);
    case "spent": return Math.round(Number(row.spent) || 0);
    case "balance": return Math.round(Number(row.balance) || 0);
    case "basis": return String(row.basis ?? "");
    case "note": return String(row.note ?? "");
    default: {
      const custom = row.custom && typeof row.custom === "object" ? row.custom : null;
      return String(custom?.[column.id] ?? "");
    }
  }
}

/** 숫자 사용자 열의 값을 숫자로 — 비었으면 null(0과 구분). */
export function numericValueOf(row, column) {
  const raw = cellValueOf(row, column);
  if (!String(raw).trim()) return null;
  const number = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? Math.round(number) : null;
}

/** 열 합계 — 숫자 열만 더한다. 값이 하나도 없으면 null. */
export function columnTotalOf(rows, column) {
  const list = Array.isArray(rows) ? rows : [];
  if (!column) return null;
  if (column.role === "budget") return list.reduce((sum, row) => sum + Math.round(Number(row?.amount) || 0), 0);
  if (column.role === "spent") return list.reduce((sum, row) => sum + Math.round(Number(row?.spent) || 0), 0);
  if (column.role === "balance") return list.reduce((sum, row) => sum + Math.round(Number(row?.balance) || 0), 0);
  if (column.role === "custom" && isNumericColumn(column)) {
    let total = 0;
    let seen = false;
    for (const row of list) {
      const value = numericValueOf(row, column);
      if (value === null) continue;
      total += value;
      seen = true;
    }
    return seen ? total : null;
  }
  return null;
}
