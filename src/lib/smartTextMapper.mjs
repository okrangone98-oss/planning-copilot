// 자유 텍스트 → 양식 칸 자동 배치.
//
// 카톡·메모장·회의록·기존 문서에서 복사한 글을 통째로 붙여넣으면, 읽어 둔 양식의 칸(kordoc 필드) 중
// 가장 알맞은 곳으로 나눠 넣는다. 두 단계로 동작한다.
//   1) 무료 AI 키가 있으면 칸 목록과 원문을 넘겨 JSON 으로 정교하게 배치한다.
//   2) AI 가 없거나 응답이 깨져도 규칙 기반(문단 분리·라벨 유사도·날짜/금액/인원/기관명 패턴)으로 즉시 배치한다.
// 어느 쪽이든 결과는 "미리보기 → 칸별 체크 → 적용" 이고, 원래 칸에 있던 글은 사용자가 확인하기 전에는 덮어쓰지 않는다.

import { isBlankValueCell, isFormLabelCell, normalizeFormLabel, fieldTypeOf } from "./kordocFormSpec.mjs";

const MAX_SEGMENT = 800;
const MAX_VALUE = 1500;
const MAX_FIELDS_IN_PROMPT = 80;

/* ────────────────────────── 동의어 사전 ────────────────────────── */

/** 같은 뜻으로 묶는 낱말 — 라벨 유사도를 사람이 보는 말 기준으로 맞춘다. */
const SYNONYM_GROUPS = [
  ["사업명", "사업이름", "과업명", "프로그램명", "프로그램", "사업제목", "제목"],
  ["수행기관", "주관기관", "신청기관", "기관", "단체", "법인", "센터", "기관명"],
  ["사업기간", "기간", "운영기간", "추진기간", "사업연도"],
  ["사업지역", "지역", "장소", "대상지", "사업장", "거점"],
  ["총사업비", "사업비", "예산", "소요예산", "금액", "재원", "비용"],
  ["담당자", "담당", "실무", "문의", "문의처", "책임자"],
  ["추진배경", "배경", "실태", "현황", "지역현황", "여건"],
  ["문제점", "문제", "과제", "한계", "어려움", "애로", "부족"],
  ["추진근거", "근거", "법령", "조례", "지침", "계획", "방침"],
  ["목표", "사업목표", "비전", "지향", "달성"],
  ["대상", "참여자", "수혜", "이용자", "참여대상", "대상자"],
  ["참여인원", "인원", "명", "모집인원", "정원"],
  ["추진내용", "내용", "사업내용", "활동", "프로그램", "주요내용"],
  ["운영방법", "운영", "방법", "방식", "진행", "운영계획"],
  ["협력기관", "협력", "파트너", "연계", "협업"],
  ["추진일정", "일정", "계획수립", "실행", "평가", "보고", "월별"],
  ["기대효과", "성과", "효과", "정량", "정성", "결과"],
  ["인건비", "강사비", "인력"],
  ["운영비", "재료비", "운영"],
  ["홍보비", "홍보", "마케팅"],
  ["예비비", "예비", "기타"]
];

const TOKEN_SPLIT = /[^가-힣A-Za-z0-9]+/;

function canonicalOf(word) {
  for (const group of SYNONYM_GROUPS) if (group.includes(word)) return group[0];
  return "";
}

/** 낱말 집합으로 펴기 — 원형 + 동의어 정준형 + 부분 일치(2자 이상) */
function expandTokens(text) {
  const words = String(text ?? "").toLowerCase().split(TOKEN_SPLIT).filter(Boolean);
  const tokens = new Set();
  for (const word of words) {
    tokens.add(word);
    const canonical = canonicalOf(word);
    if (canonical) tokens.add(canonical);
    if (word.length >= 3) {
      for (const group of SYNONYM_GROUPS) {
        for (const alias of group) {
          if (alias.length >= 2 && (word.includes(alias) || alias.includes(word))) {
            tokens.add(alias);
            tokens.add(group[0]);
          }
        }
      }
    }
  }
  return tokens;
}

/** 문자 2-gram Dice 유사도 — 띄어쓰기가 달라도 비슷한 말을 잡는다. */
function bigramSimilarity(a, b) {
  const clean = (value) => String(value ?? "").replace(/[^가-힣A-Za-z0-9]/g, "").toLowerCase();
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return 0;
  const grams = (value) => {
    const set = new Map();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      set.set(gram, (set.get(gram) || 0) + 1);
    }
    return set;
  };
  const first = grams(left);
  const second = grams(right);
  let shared = 0;
  let total = 0;
  for (const [gram, count] of first) {
    shared += Math.min(count, second.get(gram) || 0);
    total += count;
  }
  for (const count of second.values()) total += count;
  return total ? (2 * shared) / total : 0;
}

/* ────────────────────────── 값 모양 인식 ────────────────────────── */

const DATE_RANGE_RE = /\d{4}\s*[.년-]\s*\d{1,2}\s*[.월-]?(\s*\d{1,2}\s*일?)?\s*[~～\-–]\s*(\d{4}\s*[.년-]\s*)?\d{1,2}\s*[.월-]?(\s*\d{1,2}\s*일?)?/;
const DATE_SINGLE_RE = /\d{4}\s*[.년]\s*\d{1,2}\s*[.월](\s*\d{1,2}\s*일)?|\d{1,2}\s*월\s*\d{1,2}\s*일/;
const AMOUNT_RE = /\d[\d,.]*\s*(?:억|만|천)?\s*원|\d{1,3}(?:,\d{3})+|\d+\s*만\s*원/;
const COUNT_RE = /\d[\d,]*\s*(?:명|인|분|팀|가구|회|개소|개|건|회차)/;
const ORG_RE = /[가-힣A-Za-z]{2,}(?:센터|재단|협회|법인|주식회사|군청|군|시청|시|구청|구|도청|마을회|조합|학교|대학|기업|두레)/;
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

/** 한 조각이 어떤 값 모양인지 — 규칙 매칭의 근거로 쓴다. */
export function detectValueKinds(text) {
  const value = String(text ?? "");
  const kinds = new Set();
  if (DATE_RANGE_RE.test(value) || DATE_SINGLE_RE.test(value)) kinds.add("date");
  if (AMOUNT_RE.test(value)) kinds.add("amount");
  if (COUNT_RE.test(value)) kinds.add("count");
  if (ORG_RE.test(value)) kinds.add("org");
  if (PHONE_RE.test(value)) kinds.add("phone");
  if (EMAIL_RE.test(value)) kinds.add("email");
  if (/문제|어려움|부족|감소|줄어|늘어|떠나|한계|미흡|사라|불편|격차/.test(value)) kinds.add("problem");
  if (/목표|달성|지향|늘리|확대|개선|높이/.test(value)) kinds.add("goal");
  return [...kinds];
}

/** 필드가 기대하는 값 모양 */
function expectedKindsOf(field) {
  const kinds = [];
  if (field.type === "date" || /기간|일정|날짜/.test(field.label)) kinds.push("date");
  if (field.type === "amount" || /사업비|예산|금액|인원|비목/.test(field.label)) kinds.push("amount", "count");
  if (/기관|단체|법인|센터/.test(field.label)) kinds.push("org");
  if (/전화|연락처/.test(field.label)) kinds.push("phone");
  if (/이메일/.test(field.label)) kinds.push("email");
  if (/문제|현황|배경|실태/.test(field.label)) kinds.push("problem");
  if (/목표|기대|성과/.test(field.label)) kinds.push("goal");
  return kinds;
}

/* ────────────────────────── 자유 텍스트 나누기 ────────────────────────── */

const BULLET_RE = /^([○●□■◇▷▶·ㆍ•*\-–—]|\d{1,2}[.)]|[①-⑳]|[가-하]\.)\s*/;
const HEADING_LINE_RE = /^(?:#{1,6}\s+|■\s*|【\s*|\[\s*[가-힣]{2,10}\s*\]\s*$)/;

/** 자유 텍스트의 “라벨: 값” — 값은 줄 끝(또는 다음 라벨 앞)까지. 쉼표로 자르지 않는다. */
const LABEL_AT_RE = /((?:[가-힣]{1,8}\s)?[가-힣A-Za-z][가-힣A-Za-z0-9·]{1,11})\s*[:：]/g;

export function splitLabeledLine(line) {
  const source = String(line ?? "");
  const labels = [];
  LABEL_AT_RE.lastIndex = 0;
  let match;
  while ((match = LABEL_AT_RE.exec(source))) {
    // "http://" 같은 주소는 라벨이 아니다.
    if (source[LABEL_AT_RE.lastIndex] === "/") continue;
    const label = match[1].trim();
    if (!isFormLabelCell(label)) continue;
    labels.push({ label, start: match.index, valueStart: LABEL_AT_RE.lastIndex });
  }
  return labels
    .map((label, index) => ({
      label: label.label,
      value: source.slice(label.valueStart, index + 1 < labels.length ? labels[index + 1].start : source.length).trim()
    }))
    .filter((segment) => segment.value);
}

/**
 * 붙여넣은 글을 칸에 넣을 수 있는 조각으로 나눈다.
 * "라벨: 값" 줄은 라벨째로, 목록 부호 줄은 한 항목씩, 나머지는 문단 단위로 묶는다.
 */
export function splitFreeText(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const segments = [];
  let sectionTitle = "";
  let buffer = "";

  const flush = () => {
    const merged = buffer.replace(/\s+/g, " ").trim();
    buffer = "";
    if (!merged) return;
    for (const sentence of splitSentences(merged)) {
      segments.push({ kind: "paragraph", text: sentence.slice(0, MAX_SEGMENT), sectionTitle, lineIndex: segments.length });
    }
  };

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\s+$/, "").trim();
    if (!line) {
      flush();
      return;
    }
    if (HEADING_LINE_RE.test(line)) {
      flush();
      sectionTitle = line.replace(/^#{1,6}\s+/, "").replace(/^■\s*/, "").replace(/[【】\[\]]/g, "").trim().slice(0, 60);
      segments.push({ kind: "heading", text: sectionTitle, sectionTitle, lineIndex: segments.length });
      return;
    }

    const labelled = splitLabeledLine(line);
    if (labelled.length) {
      flush();
      labelled.forEach((segment) => {
        segments.push({
          kind: "labeled",
          label: segment.label,
          text: segment.value.trim().slice(0, MAX_SEGMENT),
          sectionTitle,
          lineIndex: segments.length
        });
      });
      return;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      flush();
      const body = line.slice(bullet[0].length).trim();
      if (body) segments.push({ kind: "bullet", marker: bullet[1], text: body.slice(0, MAX_SEGMENT), sectionTitle, lineIndex: segments.length });
      return;
    }

    // 앞 줄이 문장을 맺지 않았으면(쉼표·접속어·연결어미) 같은 문단으로 이어 붙인다.
    if (buffer && !endsSentence(buffer)) buffer += ` ${line}`;
    else {
      flush();
      buffer = line;
    }
    if (endsSentence(buffer)) flush();
  });
  flush();

  return segments.map((segment, index) => ({ ...segment, id: `k${index + 1}` }));
}

function endsSentence(value) {
  return /[.!?。]$/.test(String(value ?? "").trim()) || /(니다|습니다|해요|예요|입니다)$/.test(String(value ?? "").trim());
}

/** 한 덩어리를 문장 단위로 나눈다 — "A입니다. B입니다." 를 서로 다른 칸에 넣기 위해서. */
export function splitSentences(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  // 마침표는 앞 문장에 남긴다 — 문장을 나누는 지점만 자른다.
  const parts = text.split(/(?<=[다요음임]\.)(?=\s+[가-힣A-Za-z0-9])/);
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 2 && out.length) out[out.length - 1] = `${out[out.length - 1]} ${trimmed}`;
    else out.push(trimmed);
  }
  return out;
}

/* ────────────────────────── 점수 ────────────────────────── */

function labelTokensOf(field) {
  return expandTokens(String(field.label ?? "").replace(/·/g, " "));
}

function sectionTokensOf(field) {
  return expandTokens(field.sectionTitle || "");
}

/** 겹침 비율 — 조각 낱말 중 칸 낱말에 걸린 비율을, 작은 쪽 기준으로 센다. */
function overlapScore(segmentTokens, tokens) {
  if (!segmentTokens.size || !tokens.size) return 0;
  let shared = 0;
  for (const token of segmentTokens) if (tokens.has(token) && token.length >= 2) shared += 1;
  return shared / Math.min(segmentTokens.size, tokens.size);
}

/**
 * 한 조각이 한 칸에 얼마나 맞는지 — 0~1.
 * 라벨이 같은 줄이면 1.0. 아니면 칸 이름 낱말 겹침·문자 유사도·값 모양(날짜·금액·인원·기관명)으로 점수를 낸다.
 * 힌트(작성 요령)는 점수에 넣지 않는다 — 안내문 낱말이 많으면 진짜 칸 이름이 묻힌다.
 */
export function scoreSegmentForField(segment, field) {
  const reasons = [];
  const segmentText = String(segment.text ?? "");
  const segmentTokens = expandTokens(`${segment.label ? `${segment.label} ` : ""}${segmentText}`);

  if (segment.kind === "labeled" && segment.label) {
    const segmentKey = normalizeFormLabel(segment.label);
    if (segmentKey && (segmentKey === field.key || segmentKey === normalizeFormLabel(field.fillKey || ""))) {
      return { score: 1, reasons: ["라벨이 같은 줄"] };
    }
  }

  const core = overlapScore(segmentTokens, labelTokensOf(field));
  if (core > 0) reasons.push(`칸 이름과 낱말이 겹침(${Math.round(core * 100)}%)`);

  const section = overlapScore(segmentTokens, sectionTokensOf(field));
  const labelSim = bigramSimilarity(segment.label || "", field.label);
  const textSim = bigramSimilarity(segmentText.slice(0, 160), field.label);
  const similarity = Math.max(labelSim, textSim * 0.8);

  const kinds = detectValueKinds(segmentText);
  const expected = expectedKindsOf(field);
  let typeBonus = 0;
  if (expected.length && kinds.some((kind) => expected.includes(kind))) {
    typeBonus = 0.28;
    reasons.push("값 모양(날짜·금액·인원·기관명)이 칸 성격과 맞음");
  }
  if (field.type === "date" && kinds.includes("date")) typeBonus += 0.1;
  if (field.type === "amount" && (kinds.includes("amount") || kinds.includes("count"))) typeBonus += 0.08;
  if (field.type === "phone" && kinds.includes("phone")) typeBonus += 0.3;

  const sectionTitleBonus = segment.sectionTitle && field.sectionTitle && segment.sectionTitle.includes(field.sectionTitle)
    ? 0.18
    : 0;
  if (sectionTitleBonus) reasons.push("같은 구역 제목 아래 글");

  const emptyBonus = field.empty ? 0.05 : 0;
  const raw = core * 0.55 + section * 0.08 + similarity * 0.22 + typeBonus + sectionTitleBonus + emptyBonus;
  return { score: Math.max(0, Math.min(1, raw)), reasons };
}

const ACCEPT_SCORE = 0.42;

/**
 * 규칙 기반 배치 — 조각마다 가장 잘 맞는 빈 칸 하나를 고른다.
 * 같은 칸에 여러 조각이 걸리면 원문 순서대로 이어 붙인다.
 */
export function mapFreeTextToFields({ fields, text } = {}) {
  const list = (Array.isArray(fields) ? fields : []).filter((field) => field && field.label);
  const segments = splitFreeText(text);
  const assignments = [];
  const leftovers = [];
  const byField = new Map();

  for (const segment of segments) {
    if (segment.kind === "heading") {
      leftovers.push({ ...segment, reason: "구역 제목" });
      continue;
    }
    let best = null;
    for (const field of list) {
      const result = scoreSegmentForField(segment, field);
      if (!best || result.score > best.score) best = { field, score: result.score, reasons: result.reasons };
    }
    if (!best || best.score < ACCEPT_SCORE) {
      leftovers.push({ ...segment, reason: "어느 칸에도 충분히 맞지 않음" });
      continue;
    }
    const existing = byField.get(best.field.id);
    if (existing) {
      existing.segments.push(segment);
      existing.score = Math.max(existing.score, best.score);
      continue;
    }
    const assignment = {
      fieldId: best.field.id,
      field: best.field,
      score: best.score,
      reasons: best.reasons,
      segments: [segment],
      source: "rule"
    };
    byField.set(best.field.id, assignment);
    assignments.push(assignment);
  }

  return finalizeAssignments({ assignments, leftovers, fields: list });
}

function finalizeAssignments({ assignments, leftovers, fields }) {
  const rows = assignments.map((assignment) => {
    const current = String(assignment.field.value ?? "").trim();
    const proposed = assignment.segments.map((segment) => segment.text).join("\n").slice(0, MAX_VALUE).trim();
    const empty = isBlankValueCell(current);
    return {
      fieldId: assignment.fieldId,
      label: assignment.field.label,
      sectionTitle: assignment.field.sectionTitle || "",
      where: whereOf(assignment.field),
      type: assignment.field.type,
      current,
      proposed,
      mode: empty ? "new" : "replace",
      checked: empty,
      conflict: !empty,
      score: Number(assignment.score.toFixed(2)),
      reasons: assignment.reasons,
      source: assignment.source || "rule",
      segments: assignment.segments.map((segment) => ({ id: segment.id, text: segment.text }))
    };
  });
  rows.sort((a, b) => b.score - a.score);
  return {
    rows,
    leftovers: leftovers.map((segment) => ({ id: segment.id, kind: segment.kind, text: segment.text, reason: segment.reason || "", sectionTitle: segment.sectionTitle || "" })),
    fieldCount: Array.isArray(fields) ? fields.length : 0
  };
}

function whereOf(field) {
  if (field.tableId) return `${field.sectionTitle || "표"} · ${field.rowIndex + 1}행`;
  if (field.slotId) return `${field.sectionTitle || "본문"} · 문단`;
  return field.sectionTitle || "";
}

/* ────────────────────────── AI 배치 ────────────────────────── */

/** AI 에 넘길 칸 목록 — 번호·이름·구역·힌트·받는 값 모양만 보낸다(원문 값은 보내지 않는다). */
export function buildSmartTextPrompt({ fields, text } = {}) {
  const list = (Array.isArray(fields) ? fields : []).slice(0, MAX_FIELDS_IN_PROMPT);
  const lines = list.map((field) => {
    const parts = [`- ${field.id} · ${field.label}`];
    if (field.sectionTitle) parts.push(`구역 ‘${field.sectionTitle}’`);
    if (field.type && field.type !== "text") parts.push(`받는 값: ${field.type}`);
    if (field.hint) parts.push(`힌트: ${field.hint}`);
    if (!field.empty && field.value) parts.push(`이미 적힌 값: ${String(field.value).slice(0, 60)}`);
    return parts.join(" · ");
  });
  return [
    "당신은 한국 사업계획서 양식을 채우는 실무자입니다.",
    "아래 ‘양식 칸’ 중 알맞은 곳에 ‘원문’의 글을 나눠 넣으세요.",
    "",
    "지켜야 할 것:",
    "1. 원문에 없는 사실·수치·기관명을 만들지 마세요. 원문 문장을 그대로 쓰거나, 문장을 잇기만 하세요.",
    "2. 한 칸에는 원문에서 이어지는 글만 넣으세요. 서로 다른 주제의 글을 억지로 합치지 마세요.",
    "3. 어느 칸에도 맞지 않는 글은 assignments 에 넣지 말고 unassigned 에 원문 그대로 남기세요.",
    "4. 칸이 이미 채워져 있으면(이미 적힌 값) 원문이 더 낫다고 판단될 때만 넣고, reason 에 이유를 쓰세요.",
    "5. 결과는 아래 JSON 하나만 출력하세요. 설명·인사말·코드블록 표시를 붙이지 마세요.",
    "",
    "출력 형식:",
    '{"assignments":[{"fieldId":"f1","text":"칸에 넣을 글","reason":"왜 이 칸인지 한 줄"}],"unassigned":["어느 칸에도 맞지 않는 글"]}',
    "",
    "## 양식 칸",
    ...(lines.length ? lines : ["- (읽은 양식 칸이 없습니다)"]),
    "",
    "## 원문",
    String(text ?? "").slice(0, 6000)
  ].join("\n");
}

/** AI 응답에서 JSON 만 꺼낸다 — 코드블록·머리말이 섞여도 찾아낸다. */
function extractJsonObject(raw) {
  const text = String(raw ?? "").replace(/^\uFEFF/, "").trim();
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // 끝에 설명이 붙은 경우 한 번 더 시도 — 마지막 닫는 괄호까지
    try {
      return JSON.parse(slice.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]"));
    } catch {
      return null;
    }
  }
}

/**
 * AI 응답을 배치 결과로 바꾼다. JSON 이 깨졌거나 칸 번호가 없으면 null 을 돌려
 * 호출한 쪽이 규칙 기반 결과로 넘어가게 한다(폴백 계약).
 */
export function parseSmartTextResponse(raw, { fields, fallbackText = "" } = {}) {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") return null;
  const list = Array.isArray(fields) ? fields : [];
  const byId = new Map(list.map((field) => [field.id, field]));
  const byLabel = new Map(list.map((field) => [normalizeFormLabel(field.label), field]));
  const rawAssignments = Array.isArray(parsed.assignments) ? parsed.assignments : Array.isArray(parsed.items) ? parsed.items : [];
  if (!rawAssignments.length) return null;

  const assignments = [];
  for (const item of rawAssignments) {
    if (!item || typeof item !== "object") continue;
    const text = String(item.text ?? item.value ?? item.content ?? "").trim().slice(0, MAX_VALUE);
    if (!text) continue;
    const field = byId.get(String(item.fieldId ?? item.id ?? "")) || (item.label ? byLabel.get(normalizeFormLabel(item.label)) : undefined);
    if (!field) continue;
    const existing = assignments.find((assignment) => assignment.fieldId === field.id);
    if (existing) {
      existing.segments.push({ id: `a${existing.segments.length + 1}`, text });
      continue;
    }
    assignments.push({
      fieldId: field.id,
      field,
      score: 1,
      reasons: [String(item.reason ?? "AI 가 고른 칸").slice(0, 80)],
      segments: [{ id: "a1", text }],
      source: "ai"
    });
  }
  if (!assignments.length) return null;

  const unassignedTexts = Array.isArray(parsed.unassigned) ? parsed.unassigned : [];
  const leftovers = unassignedTexts
    .map((item, index) => ({ id: `u${index + 1}`, kind: "paragraph", text: String(item ?? "").slice(0, MAX_SEGMENT), reason: "AI 가 칸을 정하지 않음" }))
    .filter((item) => item.text.trim());

  return finalizeAssignments({ assignments, leftovers, fields: list });
}

/** AI 결과가 일부 칸만 채웠을 때, 규칙 기반 결과로 빈 곳을 마저 채운다. */
export function mergeWithRuleMap(aiResult, ruleResult) {
  if (!aiResult) return ruleResult;
  if (!ruleResult) return aiResult;
  const takenFields = new Set(aiResult.rows.map((row) => row.fieldId));
  const takenSegments = new Set(aiResult.rows.flatMap((row) => row.segments.map((segment) => segment.text.trim())));
  const extraRows = ruleResult.rows.filter((row) => !takenFields.has(row.fieldId) && !takenSegments.has(row.proposed.trim()));
  const leftovers = ruleResult.leftovers.filter((item) => !takenSegments.has(item.text.trim()));
  const rows = [...aiResult.rows, ...extraRows].sort((a, b) => b.score - a.score);
  return {
    rows,
    leftovers: leftovers.length ? leftovers : aiResult.leftovers,
    fieldCount: aiResult.fieldCount || ruleResult.fieldCount,
    aiRows: aiResult.rows.length,
    ruleRows: extraRows.length
  };
}

/* ────────────────────────── 적용 ────────────────────────── */

/** 미리보기에서 사용자가 체크한 줄만 값으로 바꾼다. 기존 글을 지키는 줄은 값에 넣지 않는다. */
export function collectSelectedValues(rows, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const values = {};
  const kept = [];
  let replaced = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!selected.has(row.fieldId)) {
      if (row.conflict) kept.push(row.fieldId);
      continue;
    }
    const value = String(row.proposed ?? "").trim();
    if (!value) continue;
    values[row.fieldId] = value;
    if (row.conflict) replaced += 1;
  }
  return { values, kept, replaced, count: Object.keys(values).length };
}

/** 화면 요약 — "12칸 중 9칸 채움, 3칸은 기존 글 유지" */
export function summarizeSmartMap(result, selectedIds) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const selected = selectedIds instanceof Set ? selectedIds : new Set(Array.isArray(selectedIds) ? selectedIds : rows.filter((row) => row.checked).map((row) => row.fieldId));
  const filling = rows.filter((row) => selected.has(row.fieldId) && row.proposed).length;
  const conflicts = rows.filter((row) => row.conflict).length;
  return {
    total: rows.length,
    filling,
    conflicts,
    keeping: rows.filter((row) => row.conflict && !selected.has(row.fieldId)).length,
    leftovers: Array.isArray(result?.leftovers) ? result.leftovers.length : 0,
    fields: result?.fieldCount || 0
  };
}

/** 칸에 넣을 값의 타입을 화면에서 보여 줄 이름 */
export const FIELD_TYPE_LABEL = {
  text: "글",
  date: "날짜·기간",
  amount: "금액·수량",
  phone: "전화",
  email: "이메일",
  idnum: "번호",
  checkbox: "체크"
};

/** 값 모양으로 칸 타입을 다시 확인 — 자유 텍스트가 날짜면 데이트피커 힌트를 준다. */
export function hintForValue(value) {
  const type = fieldTypeOf("", value);
  return FIELD_TYPE_LABEL[type] || "글";
}
