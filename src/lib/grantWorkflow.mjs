// 국고보조사업 예산·정산·결과보고 실무 로직.
// 브라우저와 node 테스트에서 함께 쓰이므로 mjs로 두고, 타입은 grantWorkflow.d.mts에서 정의한다.

export const GRANT_SCHEMA_VERSION = 1;

const MAX_TEXT = 2000;
const MAX_SHORT = 120;
const MAX_LINES = 300;
const MAX_CHECKLIST = 400;
const MAX_SECTIONS = 60;
const MAX_AMOUNT = 1_000_000_000_000;

const SCHEDULE_FIELDS = ["applyDeadline", "projectStart", "projectEnd", "settlementDeadline", "reportDeadline", "memo"];

export function createEmptyGrantPlan() {
  return {
    schemaVersion: GRANT_SCHEMA_VERSION,
    presetId: "",
    presetName: "",
    programName: "",
    agency: "",
    fundingSource: "",
    fundingYear: "",
    subsidyRate: "70",
    localRate: "20",
    selfRate: "10",
    budgetLines: [],
    checklist: [],
    reportSections: [],
    schedule: {
      applyDeadline: "",
      projectStart: "",
      projectEnd: "",
      settlementDeadline: "",
      reportDeadline: "",
      memo: ""
    },
    memo: "",
    updatedAt: ""
  };
}

export function toText(value, max = MAX_TEXT) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function toDigits(value, max = 3) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits ? digits.slice(0, max) : "";
}

/** "250,000원"， "25만원"， 250000 을 모두 같은 금액으로 읽는다. */
export function parseAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), MAX_AMOUNT) : 0;
  const text = String(value ?? "").replace(/\s/g, "");
  if (!text) return 0;
  const manwon = text.match(/^(\d+(?:\.\d+)?)만(?:원)?$/);
  if (manwon) return Math.min(Math.round(Number(manwon[1]) * 10000), MAX_AMOUNT);
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Math.min(Number(digits), MAX_AMOUNT) : 0;
}

export function formatWon(amount) {
  const rounded = Math.round(Number(amount) || 0);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}${String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}원`;
}

/** 수량은 "8", "8회", "2.5" 같은 표기를 받아 숫자로 읽는다. */
export function parseQuantity(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return 0;
  const number = Number(match[0]);
  return Number.isFinite(number) ? Math.min(Math.max(number, 0), 100000) : 0;
}

export function lineAmount(line) {
  if (!line || typeof line !== "object") return 0;
  return Math.min(Math.round(parseAmount(line.unitCost) * parseQuantity(line.quantity)), MAX_AMOUNT);
}

export function budgetLineKey(line) {
  return `${toText(line?.category, MAX_SHORT)}::${toText(line?.item, MAX_SHORT)}`;
}

export function checklistKey(item) {
  return `${toText(item?.group, MAX_SHORT)}::${toText(item?.label, MAX_SHORT)}`;
}

export function reportSectionKey(section) {
  return toText(section?.title, MAX_SHORT);
}

function ratioValue(value) {
  const digits = toDigits(value, 3);
  if (!digits) return 0;
  return Math.min(Number(digits), 100);
}

/**
 * 재원 구성(국비·지방비·자부담)을 총액과 비율로 계산한다.
 * 비율 합이 100이 아니면 자부담을 잔액으로 두고, 그 사실을 계산 결과에 남긴다.
 */
export function splitFunding(amount, rates = {}) {
  const total = Math.max(0, Math.round(Number(amount) || 0));
  const subsidyRate = ratioValue(rates.subsidyRate);
  const localRate = ratioValue(rates.localRate);
  const selfRate = ratioValue(rates.selfRate);
  const rateSum = subsidyRate + localRate + selfRate;

  const roundTo10 = (value) => Math.round(Number(value) / 10) * 10;
  let subsidy = roundTo10((total * subsidyRate) / 100);
  let local = roundTo10((total * localRate) / 100);
  if (subsidy + local > total) {
    local = Math.max(0, total - subsidy);
  }
  const self = Math.max(0, total - subsidy - local);

  return {
    total,
    subsidy,
    local,
    self,
    rates: { subsidyRate, localRate, selfRate },
    rateSum,
    rateMismatch: rateSum !== 100
  };
}

export function budgetSummary(plan) {
  const lines = Array.isArray(plan?.budgetLines) ? plan.budgetLines : [];
  const categoryTotals = new Map();
  let total = 0;
  const rows = lines.map((line) => {
    const amount = lineAmount(line);
    total += amount;
    const category = toText(line?.category, MAX_SHORT) || "미분류";
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + amount);
    return { ...line, amount };
  });

  const byCategory = Array.from(categoryTotals.entries()).map(([category, categoryTotal]) => ({
    category,
    total: categoryTotal,
    share: total ? Math.round((categoryTotal / total) * 1000) / 10 : 0
  }));

  const funding = splitFunding(total, {
    subsidyRate: plan?.subsidyRate,
    localRate: plan?.localRate,
    selfRate: plan?.selfRate
  });

  return { rows, byCategory, total, lineCount: lines.length, funding };
}

export function checklistSummary(plan) {
  const items = Array.isArray(plan?.checklist) ? plan.checklist : [];
  const required = items.filter((item) => item.required !== false);
  const requiredChecked = required.filter((item) => item.checked);
  const done = items.filter((item) => item.checked);
  return {
    total: items.length,
    done: done.length,
    requiredTotal: required.length,
    requiredDone: requiredChecked.length,
    requiredMissing: required.filter((item) => !item.checked),
    percent: items.length ? Math.round((done.length / items.length) * 100) : 0
  };
}

export function reportSummary(plan) {
  const sections = Array.isArray(plan?.reportSections) ? plan.reportSections : [];
  const written = sections.filter((section) => toText(section.content, MAX_TEXT).length > 0);
  return {
    total: sections.length,
    written: written.length,
    missing: sections.filter((section) => !toText(section.content, MAX_TEXT).length),
    percent: sections.length ? Math.round((written.length / sections.length) * 100) : 0
  };
}

function groupBy(items, keyOf) {
  const groups = [];
  const index = new Map();
  items.forEach((item) => {
    const key = keyOf(item) || "기타";
    if (!index.has(key)) {
      index.set(key, { title: key, items: [] });
      groups.push(index.get(key));
    }
    index.get(key).items.push(item);
  });
  return groups;
}

export function groupChecklist(plan) {
  return groupBy(Array.isArray(plan?.checklist) ? plan.checklist : [], (item) => toText(item.group, MAX_SHORT));
}

/**
 * 프리셋을 현재 작업에 적용한다.
 * 구조·금액은 프리셋 기준으로 새로 잡고, 같은 항목(비목·세목, 점검 항목, 보고서 섹션)의
 * 진행 상태와 메모는 그대로 살린다. 사업명·회계연도·일정·전체 메모는 사용자 값을 유지한다.
 */
export function applyPreset(preset, current) {
  const base = createEmptyGrantPlan();
  const previous = current && typeof current === "object" ? current : base;
  if (!preset || typeof preset !== "object" || !toText(preset.id, MAX_SHORT)) {
    return { ...base, ...previous, budgetLines: previous.budgetLines || [], checklist: previous.checklist || [], reportSections: previous.reportSections || [] };
  }

  const prevLines = new Map((Array.isArray(previous.budgetLines) ? previous.budgetLines : []).map((line) => [budgetLineKey(line), line]));
  const prevChecks = new Map((Array.isArray(previous.checklist) ? previous.checklist : []).map((item) => [checklistKey(item), item]));
  const prevSections = new Map((Array.isArray(previous.reportSections) ? previous.reportSections : []).map((section) => [reportSectionKey(section), section]));

  const budgetLines = (Array.isArray(preset.budgetLines) ? preset.budgetLines : []).map((line, index) => {
    const candidate = { category: toText(line.category, MAX_SHORT), item: toText(line.item, MAX_SHORT) };
    const before = prevLines.get(budgetLineKey(candidate));
    return {
      id: toText(before?.id, 60) || `${preset.id}-b${index + 1}`,
      category: candidate.category,
      item: candidate.item,
      unitCost: toText(line.unitCost, 40),
      quantity: toText(line.quantity, 20),
      basis: toText(line.basis, MAX_SHORT),
      note: toText(before?.note, MAX_SHORT) || toText(line.note, MAX_SHORT)
    };
  });

  const checklist = (Array.isArray(preset.checklist) ? preset.checklist : []).map((item, index) => {
    const candidate = { group: toText(item.group, MAX_SHORT), label: toText(item.label, MAX_SHORT) };
    const before = prevChecks.get(checklistKey(candidate));
    return {
      id: toText(before?.id, 60) || `${preset.id}-c${index + 1}`,
      group: candidate.group,
      label: candidate.label,
      basis: toText(item.basis, MAX_SHORT),
      required: item.required !== false,
      checked: Boolean(before?.checked),
      note: toText(before?.note, MAX_SHORT)
    };
  });

  const reportSections = (Array.isArray(preset.reportSections) ? preset.reportSections : []).map((section, index) => {
    const title = toText(section.title, MAX_SHORT);
    const before = prevSections.get(title);
    return {
      id: toText(before?.id, 60) || `${preset.id}-r${index + 1}`,
      title,
      hint: toText(section.hint, MAX_SHORT),
      content: toText(before?.content, MAX_TEXT)
    };
  });

  const schedule = base.schedule;
  SCHEDULE_FIELDS.forEach((field) => {
    schedule[field] = toText(previous.schedule?.[field], field === "memo" ? MAX_TEXT : 20);
  });

  return {
    ...base,
    presetId: toText(preset.id, MAX_SHORT),
    presetName: toText(preset.name, MAX_SHORT),
    programName: toText(previous.programName, MAX_SHORT) || toText(preset.name, MAX_SHORT),
    agency: toText(preset.agency, MAX_SHORT),
    fundingSource: toText(preset.fundingSource, MAX_SHORT),
    fundingYear: toText(previous.fundingYear, 4),
    subsidyRate: toDigits(preset.subsidyRate, 3) || base.subsidyRate,
    localRate: toDigits(preset.localRate, 3) || base.localRate,
    selfRate: toDigits(preset.selfRate, 3) || base.selfRate,
    budgetLines,
    checklist,
    reportSections,
    schedule,
    memo: toText(previous.memo, MAX_TEXT),
    updatedAt: new Date().toISOString()
  };
}

export function hasGrantWork(plan) {
  if (!plan || typeof plan !== "object") return false;
  const hasLine = (Array.isArray(plan.budgetLines) ? plan.budgetLines : []).some((line) => lineAmount(line) > 0);
  const hasCheck = (Array.isArray(plan.checklist) ? plan.checklist : []).some((item) => item.checked || toText(item.note, MAX_SHORT));
  const hasSection = (Array.isArray(plan.reportSections) ? plan.reportSections : []).some((section) => toText(section.content, MAX_TEXT));
  return hasLine || hasCheck || hasSection;
}

export function emptyBudgetLine(id = "") {
  return { id, category: "", item: "", unitCost: "", quantity: "", basis: "", note: "" };
}

/** 저장된 값은 허용 목록으로만 복원한다. 알 수 없는 필드(키·토큰 등)는 남기지 않는다. */
export function sanitizeGrantPlan(saved) {
  const base = createEmptyGrantPlan();
  const value = saved && typeof saved === "object" ? saved : {};

  const budgetLines = (Array.isArray(value.budgetLines) ? value.budgetLines : [])
    .slice(0, MAX_LINES)
    .map((line, index) => ({
      id: toText(line?.id, 60) || `line-${index + 1}`,
      category: toText(line?.category, MAX_SHORT),
      item: toText(line?.item, MAX_SHORT),
      unitCost: toText(line?.unitCost, 40),
      quantity: toText(line?.quantity, 20),
      basis: toText(line?.basis, MAX_SHORT),
      note: toText(line?.note, MAX_SHORT)
    }))
    .filter((line) => line.category || line.item || line.unitCost || line.quantity);

  const checklist = (Array.isArray(value.checklist) ? value.checklist : [])
    .slice(0, MAX_CHECKLIST)
    .map((item, index) => ({
      id: toText(item?.id, 60) || `check-${index + 1}`,
      group: toText(item?.group, MAX_SHORT) || "기타",
      label: toText(item?.label, MAX_SHORT),
      basis: toText(item?.basis, MAX_SHORT),
      required: item?.required !== false,
      checked: Boolean(item?.checked),
      note: toText(item?.note, MAX_SHORT)
    }))
    .filter((item) => item.label);

  const reportSections = (Array.isArray(value.reportSections) ? value.reportSections : [])
    .slice(0, MAX_SECTIONS)
    .map((section, index) => ({
      id: toText(section?.id, 60) || `section-${index + 1}`,
      title: toText(section?.title, MAX_SHORT),
      hint: toText(section?.hint, MAX_SHORT),
      content: toText(section?.content, MAX_TEXT)
    }))
    .filter((section) => section.title);

  return {
    schemaVersion: GRANT_SCHEMA_VERSION,
    presetId: toText(value.presetId, MAX_SHORT),
    presetName: toText(value.presetName, MAX_SHORT),
    programName: toText(value.programName, MAX_SHORT),
    agency: toText(value.agency, MAX_SHORT),
    fundingSource: toText(value.fundingSource, MAX_SHORT),
    fundingYear: toDigits(value.fundingYear, 4),
    subsidyRate: toDigits(value.subsidyRate, 3) || base.subsidyRate,
    localRate: toDigits(value.localRate, 3) || base.localRate,
    selfRate: toDigits(value.selfRate, 3) || base.selfRate,
    budgetLines,
    checklist,
    reportSections,
    schedule: SCHEDULE_FIELDS.reduce((schedule, field) => {
      schedule[field] = toText(value.schedule?.[field], field === "memo" ? MAX_TEXT : 20);
      return schedule;
    }, {}),
    memo: toText(value.memo, MAX_TEXT),
    updatedAt: toText(value.updatedAt, 40)
  };
}

/** 마감일까지 남은 일수. 날짜 형식이 아니면 null. */
export function daysUntil(dateText, now) {
  const text = toText(dateText, 20);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const reference = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(reference.getTime())) return null;
  const today = Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate());
  return Math.round((target - today) / 86400000);
}

export function dDayLabel(dateText, now) {
  const days = daysUntil(dateText, now);
  if (days === null) return "";
  if (days === 0) return "D-day";
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)} (지남)`;
}

export function scheduleEntries(plan) {
  const schedule = plan?.schedule || {};
  return [
    { key: "applyDeadline", label: "신청·교부 마감", value: toText(schedule.applyDeadline, 20) },
    { key: "projectStart", label: "사업 시작", value: toText(schedule.projectStart, 20) },
    { key: "projectEnd", label: "사업 종료", value: toText(schedule.projectEnd, 20) },
    { key: "settlementDeadline", label: "정산 마감", value: toText(schedule.settlementDeadline, 20) },
    { key: "reportDeadline", label: "결과보고 마감", value: toText(schedule.reportDeadline, 20) }
  ].filter((entry) => entry.value);
}

/** 다음에 할 일: 미체크 필수 증빙, 비어 있는 보고서 섹션, 다가오는 마감. */
export function pendingFollowUps(plan, now) {
  const followUps = [];
  const checks = checklistSummary(plan);
  checks.requiredMissing.slice(0, 12).forEach((item) => {
    followUps.push({ kind: "증빙", label: `${item.group} · ${item.label}`, detail: item.basis || "" });
  });

  const report = reportSummary(plan);
  report.missing.slice(0, 8).forEach((section) => {
    followUps.push({ kind: "보고서", label: `결과보고 '${section.title}' 작성`, detail: section.hint || "" });
  });

  scheduleEntries(plan)
    .map((entry) => ({ ...entry, days: daysUntil(entry.value, now) }))
    .filter((entry) => entry.days !== null && entry.days <= 30)
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
    .forEach((entry) => {
      const label = entry.days === null ? entry.label : `${entry.label} (${dDayLabel(entry.value, now)})`;
      followUps.unshift({ kind: "일정", label, detail: entry.value });
    });

  return followUps;
}
