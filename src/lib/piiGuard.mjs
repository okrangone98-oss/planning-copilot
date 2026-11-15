// 개인정보(PII) 탐지·마스킹 가드.
// 한국형 민감정보(주민등록번호·연락처·이메일·계좌·카드·사업자번호·주소·성명)를 브라우저 안에서만 찾아
// [연락처_1] 같은 치환 토큰으로 바꾼다. 외부 AI·복사·내보내기 전에 호출하는 용도이며,
// 어디에도 원문을 저장하거나 전송하지 않는다.

/** 탐지 종류와 배지 이름. 화면 배지·마스킹 목록에서 같은 이름을 쓴다. */
export const PII_TYPES = [
  { key: "rrn", label: "주민등록번호", badge: "주민번호", token: "주민번호", priority: 100 },
  { key: "card", label: "카드번호", badge: "카드", token: "카드", priority: 90 },
  { key: "business", label: "사업자등록번호", badge: "사업자번호", token: "사업자번호", priority: 80 },
  { key: "account", label: "계좌번호", badge: "계좌", token: "계좌", priority: 70 },
  { key: "phone", label: "휴대폰·전화번호", badge: "연락처", token: "연락처", priority: 60 },
  { key: "email", label: "이메일", badge: "이메일", token: "이메일", priority: 50 },
  { key: "address", label: "주소", badge: "주소", token: "주소", priority: 40 },
  { key: "name", label: "성명", badge: "성명", token: "성명", priority: 10 }
];

const TYPE_BY_KEY = new Map(PII_TYPES.map((type) => [type.key, type]));

/** 기본값: 사업자등록번호는 공개 정보에 가까워 선택 사항으로 두고 기본 OFF. */
export const DEFAULT_PII_OPTIONS = {
  rrn: true,
  card: true,
  business: false,
  account: true,
  phone: true,
  email: true,
  address: true,
  name: true
};

/** 옵션을 항상 같은 모양으로 만든다. true/false, 배열, 부분 객체를 모두 받는다. */
export function normalizeOptions(options) {
  const resolved = { ...DEFAULT_PII_OPTIONS };
  if (Array.isArray(options)) {
    for (const key of Object.keys(resolved)) resolved[key] = options.includes(key);
    return resolved;
  }
  if (options && typeof options === "object") {
    for (const [key, value] of Object.entries(options)) {
      if (key in resolved && typeof value === "boolean") resolved[key] = value;
    }
  }
  return resolved;
}

/* ── 검증기 ─────────────────────────────────────────────────── */

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/** 주민등록번호 검사번호. 12자리까지의 가중합으로 마지막 자리를 확인한다. */
export function isValidRrn(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 13) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let index = 0; index < 12; index += 1) sum += Number(digits[index]) * weights[index];
  const expected = (11 - (sum % 11)) % 10;
  return expected === Number(digits[12]);
}

/** 외국인등록번호: 뒷자리 첫 숫자가 5~8이면 외국인으로 본다. 검사 규칙은 주민번호와 같다. */
export function isForeignerId(value) {
  const digits = digitsOnly(value);
  return digits.length === 13 && Number(digits[6]) >= 5 && Number(digits[6]) <= 8;
}

/** 카드번호 Luhn 검사. */
export function isValidCardNumber(value) {
  const digits = digitsOnly(value);
  if (digits.length < 14 || digits.length > 16) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** 사업자등록번호 검사번호(국세청 규칙). */
export function isValidBusinessNumber(value) {
  const digits = digitsOnly(value);
  if (digits.length !== 10) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3];
  let sum = 0;
  for (let index = 0; index < 8; index += 1) sum += Number(digits[index]) * weights[index];
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  const expected = (10 - (sum % 10)) % 10;
  return expected === Number(digits[9]);
}

/* ── 후보 수집 ─────────────────────────────────────────────── */

const RRN_PATTERN = /(\d{6})[-\s]?([1-8]\d{6})/g;
const FOREIGN_ONLY_PATTERN = /(\d{6})[-\s]?([5-8]\d{6})/g;
// 휴대폰은 0으로 시작하는 국내 표기만, +82로 시작하면 0을 생략해도 인정한다.
const PHONE_PATTERN = /(?:\+?82[-\s]?0?|0)(1[016789])[-\s]?(\d{3,4})[-\s]?(\d{4})/g;
const LANDLINE_PATTERN = /(0(?:2|[3-6][1-5]|70|80))[-\s]?(\d{3,4})[-\s]?(\d{4})/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const CARD_PATTERN = /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}(?:[-\s]?\d{2})?/g;
const BUSINESS_PATTERN = /\d{3}[-\s]\d{2}[-\s]\d{5}/g;
const ACCOUNT_PATTERN = /\d{2,6}[-\s]\d{2,6}(?:[-\s]\d{2,7}){0,3}/g;
const ROAD_ADDRESS_PATTERN =
  /(?:[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리|가)\s+){0,4}[가-힣0-9]{2,}(?:로|길)\s?\d{1,4}(?:-\d{1,4})?/g;
// 지번 주소는 시·도·군·구 같은 행정 구역 표기가 앞에 있을 때만 인정한다.
// (‘홍길동 010-1234-5678’처럼 이름+번호를 주소로 잘못 읽지 않게)
const JIBEON_ADDRESS_PATTERN =
  /(?:[가-힣]{2,}(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)\s+)+(?:[가-힣]{2,}(?:읍|면|동|리|가)\s+){0,3}(?:산\s?)?\d{1,4}(?:-\d{1,4})?(?:\s?(?:번지|호))?/g;
const NAME_PATTERN =
  /(성명|이름|담당자|담당|대표자|신청인|신청자|작성자|책임자|실무자|연구책임자|예금주|접수자|연락처\s?담당)\s*[:：]?\s*([가-힣]{2,4})(?=[\s,，.·()\[\]/]|$)/g;

/** 이름 자리에 올 수 없는 낱말. (‘담당자: 없음’ 같은 표기를 가리지 않는다) */
const NAME_STOPWORDS = new Set(["없음", "미정", "추후", "확인", "필요", "본인", "대표", "담당", "추가", "변경", "이상", "이하", "기타", "해당"]);

const BANK_KEYWORDS = [
  "계좌", "입금", "출금", "송금", "이체", "예금주", "은행", "농협", "국민", "신한", "우리", "하나",
  "기업은행", "카카오뱅크", "토스뱅크", "케이뱅크", "수협", "축협", "새마을금고", "우체국", "씨티"
];

function contextAround(text, start, end, radius = 30) {
  return text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius));
}

/** 계좌 후보는 은행·계좌 표시가 바로 앞에 있을 때만 인정한다. (사업자·카드·날짜 오탐 방지) */
function hasBankContext(text, start) {
  const before = text.slice(Math.max(0, start - 24), start);
  if (/(사업자|법인|등록번호|주민|카드|전화|팩스|우편번호)/.test(before.slice(-14))) return false;
  const near = before.slice(-18);
  if (!BANK_KEYWORDS.some((keyword) => near.includes(keyword))) return false;
  return true;
}

function overlapsAny(candidate, spans) {
  return spans.some((span) => candidate.start < span.end && span.start < candidate.end);
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function boundaryOk(text, start, end) {
  const before = text[start - 1] || "";
  const after = text[end] || "";
  if (isDigit(before) || isDigit(after)) return false;
  // 날짜(2026-11-15)나 기간 표기가 계좌·카드로 잡히지 않게 한다.
  if (before === "-" && isDigit(text[start - 2] || "")) return false;
  return true;
}

/** 규칙 하나를 훑어 유효한 후보만 만든다. */
function collectFromPattern(text, pattern, { group, accepts = () => true, boundary = "digit" } = {}) {
  const matches = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match) {
    const raw = group ? match[group] : match[0];
    const relative = group ? match[0].indexOf(raw) : 0;
    const start = match.index + (relative >= 0 ? relative : 0);
    const end = start + raw.length;
    const value = text.slice(start, end);
    if (!value.trim()) {
      match = pattern.exec(text);
      continue;
    }
    if (boundary === "digit" && !boundaryOk(text, start, end)) {
      match = pattern.exec(text);
      continue;
    }
    if (!accepts({ text, value, start, end })) {
      match = pattern.exec(text);
      continue;
    }
    matches.push({ type: "", start, end, value });
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  return matches;
}

function collectCandidates(text, options) {
  const candidates = [];
  const push = (type, items) => {
    for (const item of items) candidates.push({ ...item, type });
  };

  // 주민등록번호: 검사번호까지 맞는 13자리만 인정한다. (외국인등록번호 포함)
  const rrns = collectFromPattern(text, RRN_PATTERN, { accepts: ({ value }) => isValidRrn(value) });
  const cards = collectFromPattern(text, CARD_PATTERN, {
    accepts: ({ value }) => isValidCardNumber(value),
    boundary: "digit"
  });
  // 사업자번호는 옵션이 꺼져 있어도 ‘계좌’로 잘못 잡히지 않게 미리 확인해 둔다.
  const businesses = collectFromPattern(text, BUSINESS_PATTERN, {
    accepts: ({ value }) => isValidBusinessNumber(value),
    boundary: "digit"
  });
  const reserved = [...rrns, ...cards, ...businesses];

  if (options.rrn) push("rrn", rrns);
  if (options.card) push("card", cards);
  if (options.business) push("business", businesses);

  if (options.account) {
    push(
      "account",
      collectFromPattern(text, ACCOUNT_PATTERN, {
        accepts: ({ text: source, value, start }) => {
          const digits = digitsOnly(value);
          if (digits.length < 10 || digits.length > 16) return false;
          // 하이픈이 최소 한 번 있어야 계좌처럼 읽는다. (전화·날짜 오탐 방지)
          if (!/-/.test(value)) return false;
          if (!hasBankContext(source, start)) return false;
          return true;
        },
        boundary: "digit"
      }).filter((candidate) => !overlapsAny(candidate, reserved))
    );
  }

  if (options.phone) {
    const phones = [
      ...collectFromPattern(text, PHONE_PATTERN, { accepts: () => true }),
      ...collectFromPattern(text, LANDLINE_PATTERN, { accepts: () => true })
    ];
    push("phone", phones);
  }

  if (options.email) {
    push(
      "email",
      collectFromPattern(text, EMAIL_PATTERN, {
        accepts: ({ value }) => value.length <= 80,
        boundary: "none"
      })
    );
  }

  if (options.address) {
    const addresses = [
      ...collectFromPattern(text, ROAD_ADDRESS_PATTERN, { boundary: "none" }),
      ...collectFromPattern(text, JIBEON_ADDRESS_PATTERN, { boundary: "none" })
    ];
    push("address", addresses);
  }

  if (options.name) {
    push(
      "name",
      collectFromPattern(text, NAME_PATTERN, {
        group: 2,
        accepts: ({ value }) => value.length >= 2 && !NAME_STOPWORDS.has(value),
        boundary: "none"
      })
    );
  }

  return candidates;
}

/** 겹치는 후보는 우선순위(주민번호 > 카드 > 연락처 > 주소 …)와 길이로 정리한다. */
function resolveOverlaps(candidates) {
  const sorted = [...candidates].sort((left, right) => {
    const leftPriority = TYPE_BY_KEY.get(left.type)?.priority ?? 0;
    const rightPriority = TYPE_BY_KEY.get(right.type)?.priority ?? 0;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    if (left.start !== right.start) return left.start - right.start;
    return right.end - right.start - (left.end - left.start);
  });

  const kept = [];
  for (const candidate of sorted) {
    const overlaps = kept.some((item) => candidate.start < item.end && item.start < candidate.end);
    if (!overlaps) kept.push(candidate);
  }
  return kept.sort((left, right) => left.start - right.start);
}

/* ── 미리보기(가린 형태) ───────────────────────────────────── */

/** 목록에서 확인할 수 있게 앞뒤 일부만 남긴다. 원문 전체는 다시 보여 주지 않는다. */
export function maskPreview(type, value) {
  const text = String(value ?? "");
  if (type === "email") {
    const [local, domain] = text.split("@");
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${"*".repeat(Math.max(2, Math.min(4, local.length - head.length)))}@${domain || ""}`;
  }
  const digits = digitsOnly(text);
  if (type === "name") {
    const chars = [...text];
    if (chars.length <= 1) return "*";
    return `${chars[0]}${"*".repeat(chars.length - 1)}`;
  }
  if (type === "address") {
    const chars = [...text];
    if (chars.length <= 6) return `${chars[0]}***`;
    return `${chars.slice(0, 5).join("")}…${chars.slice(-2).join("")}`;
  }
  if (!digits) return "***";
  const visibleHead = type === "phone" ? 3 : type === "rrn" ? 6 : 3;
  const visibleTail = type === "phone" ? 4 : type === "card" ? 4 : 2;
  if (digits.length <= visibleHead + visibleTail) return "*".repeat(digits.length);
  return `${digits.slice(0, visibleHead)}${"*".repeat(digits.length - visibleHead - visibleTail)}${digits.slice(-visibleTail)}`;
}

function placeholderPrefix(type) {
  return TYPE_BY_KEY.get(type)?.token || type;
}

/* ── 공개 API ─────────────────────────────────────────────── */

/**
 * 텍스트에서 개인정보 후보를 찾는다.
 * @returns {{ total: number, findings: Array, types: Array, counts: Record<string, number>, badgeText: string }}
 */
export function scanPii(text, options) {
  const source = typeof text === "string" ? text : String(text ?? "");
  if (!source.trim()) {
    return { total: 0, findings: [], types: [], counts: {}, badgeText: "", kinds: 0 };
  }
  const resolved = normalizeOptions(options);
  const findings = resolveOverlaps(collectCandidates(source, resolved)).map((candidate) => {
    const type = TYPE_BY_KEY.get(candidate.type);
    const label = candidate.type === "rrn" && isForeignerId(candidate.value) ? "외국인등록번호" : type?.label || candidate.type;
    return {
      type: candidate.type,
      label,
      badge: type?.badge || candidate.type,
      start: candidate.start,
      end: candidate.end,
      preview: maskPreview(candidate.type, candidate.value)
    };
  });

  const counts = {};
  for (const finding of findings) counts[finding.type] = (counts[finding.type] || 0) + 1;
  const types = PII_TYPES.filter((type) => counts[type.key]).map((type) => ({
    key: type.key,
    label: type.label,
    badge: type.badge,
    count: counts[type.key]
  }));
  const badgeText = types.map((type) => `${type.badge} ${type.count}`).join(" · ");

  return { total: findings.length, findings, types, counts, badgeText, kinds: types.length };
}

/** 탐지한 개인정보를 [연락처_1] 형태로 바꾼다. 같은 값은 같은 번호를 쓴다. */
export function maskPii(text, options) {
  const source = typeof text === "string" ? text : String(text ?? "");
  const scan = scanPii(source, options);
  if (!scan.total) {
    return { ...scan, text: source, placeholders: [], replaced: 0 };
  }
  const counters = {};
  const valueToPlaceholder = new Map();
  const placeholders = [];

  let output = "";
  let cursor = 0;
  for (const finding of scan.findings) {
    const raw = source.slice(finding.start, finding.end);
    const normalized = `${finding.type}:${digitsOnly(raw) || raw}`;
    let placeholder = valueToPlaceholder.get(normalized);
    if (!placeholder) {
      counters[finding.type] = (counters[finding.type] || 0) + 1;
      placeholder = `[${placeholderPrefix(finding.type)}_${counters[finding.type]}]`;
      valueToPlaceholder.set(normalized, placeholder);
      placeholders.push({ placeholder, type: finding.type, label: finding.label, preview: finding.preview });
    }
    output += source.slice(cursor, finding.start) + placeholder;
    cursor = finding.end;
    finding.placeholder = placeholder;
  }
  output += source.slice(cursor);

  return {
    ...scan,
    text: output,
    placeholders,
    replaced: placeholders.length
  };
}

/** 객체·배열 안의 모든 문자열을 마스킹한다. 외부 전송 페이로드 점검용. */
export function maskRecord(input, options) {
  const report = { total: 0, counts: {}, types: [], badgeText: "", placeholders: [] };
  const seenPlaceholders = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      const masked = maskPii(value, options);
      if (masked.total) {
        report.total += masked.total;
        for (const [key, count] of Object.entries(masked.counts)) report.counts[key] = (report.counts[key] || 0) + count;
        for (const item of masked.placeholders) {
          if (seenPlaceholders.has(item.placeholder)) continue;
          seenPlaceholders.add(item.placeholder);
          report.placeholders.push(item);
        }
      }
      return masked.text;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const copy = {};
      for (const [key, item] of Object.entries(value)) copy[key] = walk(item);
      return copy;
    }
    return value;
  };
  const value = walk(input);
  report.types = PII_TYPES.filter((type) => report.counts[type.key]).map((type) => ({
    key: type.key,
    label: type.label,
    badge: type.badge,
    count: report.counts[type.key]
  }));
  report.badgeText = report.types.map((type) => `${type.badge} ${type.count}`).join(" · ");
  return { value, report };
}

/** 화면 안내 문구. 탐지 건수와 종류를 한 줄로 만든다. */
export function describePiiScan(scan) {
  if (!scan || !scan.total) return "개인정보로 보이는 값이 없습니다. 그래도 이름·연락처가 섞여 있지 않은지 한 번 확인하세요.";
  return `개인정보 ${scan.total}건 감지: ${scan.badgeText}. 마스킹을 켜면 [연락처_1] 같은 표시로 바뀐 채 전송됩니다.`;
}

/** 이미 마스킹된 토큰이 들어 있는지. 두 번 가렸는지 확인할 때 쓴다. */
export function hasMaskedTokens(text) {
  return /\[(?:주민번호|연락처|이메일|계좌|카드|사업자번호|주소|성명)_\d+\]/.test(String(text ?? ""));
}
