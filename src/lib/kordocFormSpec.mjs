// kordoc 양식 규격 — chrisryugj/kordoc(MIT)의 양식 인식·채우기 규칙을 브라우저 앱에서 그대로 쓰는 구현.
//
// 대응 관계:
//   kordoc src/form/recognize.ts  → isFormLabelCell·isBlankValueCell·isDatePlaceholderCell·isColumnHeaderRow·fieldTypeOf
//   kordoc src/form/match.ts      → normalizeFormLabel·findMatchingFieldKey·scanInlineFieldSegments
//   kordoc src/form/filler-hwpx.ts→ 채우기 대상 칸(라벨 오른쪽 칸) 규칙과 fill JSON 키(라벨 정규화·배열 값)
//
// kordoc 본체(HWP5·OCR·병합 셀 복원·실제 HWPX 쓰기)는 Node 로컬 런타임이 필요하므로,
// 이 앱은 "어느 칸에 무슨 값을 넣을지"를 kordoc 과 같은 규칙으로 정하고
// 실제 파일 채우기는 kordoc fill/patch(로컬 실행 또는 브릿지)에 넘긴다.

/** 이 앱이 맞춰 둔 kordoc 명령 규격 */
export const KORDOC_SPEC_VERSION = "4.24.80";

/** kordoc LABEL_KEYWORDS — 라벨 칸 판정에 쓰는 한국 공문서 라벨 낱말 */
export const FORM_LABEL_KEYWORDS = [
  "성명", "이름", "주소", "전화", "전화번호", "휴대폰", "핸드폰", "연락처",
  "생년월일", "주민등록번호", "소속", "직위", "직급", "부서",
  "이메일", "팩스", "학교", "학년", "반", "번호",
  "신청인", "대표자", "담당자", "작성자", "확인자", "승인자",
  "일시", "날짜", "기간", "장소", "목적", "사유", "비고",
  "금액", "수량", "단가", "합계", "계", "소계",
  "등록기준지", "본적", "위임인", "청구사유", "소명자료"
];

/** 사업계획서 양식에서 자주 쓰는 라벨 — kordoc 키워드에 더해 우리 쪽에서만 쓰는 목록 */
export const PLAN_LABEL_KEYWORDS = [
  "사업명", "사업기간", "사업지역", "사업비", "총사업비", "수행기관", "주관기관", "협력기관",
  "지역현황", "문제점", "추진근거", "추진배경", "목표", "대상", "참여인원", "추진내용",
  "운영방법", "계획수립", "실행", "평가", "비목", "산출내역", "인건비", "운영비", "홍보비",
  "예비비", "정량성과", "정성성과", "기대효과", "추진일정", "담당", "문의처"
];

const ENGLISH_LABEL_WORDS = new Set([
  "name", "date", "address", "tel", "phone", "mobile", "fax", "email", "e-mail",
  "dept", "department", "division", "title", "position", "grade", "rank",
  "birth", "nationality", "sex", "gender", "signature", "sign", "seal",
  "remarks", "note", "period", "place", "purpose", "reason", "amount", "total",
  "sum", "qty", "quantity", "unit", "no", "id", "passport"
]);
const ENGLISH_STOPWORDS = new Set(["of", "the", "and", "or", "in"]);

/** 수량·단위 값 형태 — "6개월"·"1억원"·"2026년" 은 라벨이 아니라 값 */
const NUMERIC_VALUE_RE = /^제?\d+(?:[.,]\d+)*[십백천만억조]*(?:원|명|건|개|회|부|매|장|점|호|번|년|월|일|시|분|초|개월|주년|차례|퍼센트)?$/;
/** 서술형 문장 어미 — 칸에 든 안내 문구를 라벨로 오인하지 않는다 */
const SENTENCE_ENDING_RE = /(?:입니다|합니다|습니다|하세요|십시오|시오|바랍니다|바람|할 것|할것|하며|하고|한다|된다|됨|음|임)$/;

/** 라벨 정규화 — kordoc normalizeLabel. 앞 번호와 콜론·공백·괄호·가운뎃점을 걷고 비교한다. */
export function normalizeFormLabel(label) {
  return String(label ?? "").trim()
    // “1. 기관명 :”·“① 성명”·“가) 주소” 처럼 항목 번호가 붙은 라벨도 같은 칸으로 본다.
    .replace(/^(?:[①-⑳]|\(?\d{1,3}[).]|[가-힣][).])\s*/, "")
    .replace(/<\/?su[bp]>/g, "")
    .replace(/[:：\s()（）·]/g, "");
}

/** 값이 비었거나 밑줄·괄호 빈칸·대시 같은 자리표시뿐 — kordoc isBlankValue */
export function isBlankValueCell(text) {
  return /^[\s_()（）\-—–~.·,]*$/.test(String(text ?? ""));
}

/** 날짜 자리표시 칸("년 월 일", "년 월 ~ 년 월") — 라벨이 아니라 값 자리 (kordoc isDatePlaceholder) */
export function isDatePlaceholderCell(text) {
  const t = String(text ?? "").trim()
    .replace(/부터|까지|입학|졸업|수료|재학|중퇴|편입|입사|퇴사|현재/g, " ")
    .replace(/(^|[-~～∼])\s*(?:19|20)(?=\s)/g, "$1");
  if (!/[년월일시분]/.test(t) || !/^[년월일시분초\s.\-~～∼()（）/]+$/.test(t)) return false;
  return /[-~～∼]/.test(t) || /[년월일시분]\s+[년월일시분]/.test(t);
}

/** 라벨처럼 보이는 칸인가 — kordoc isLabelCell (키워드 + 짧은 한글 + "라벨:" + 영문 관행) */
export function isFormLabelCell(text) {
  const trimmed = String(text ?? "").trim().replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰*※]+$/g, "").trim();
  if (!trimmed || trimmed.length > 30) return false;
  for (const keyword of FORM_LABEL_KEYWORDS) if (trimmed.includes(keyword)) return true;
  for (const keyword of PLAN_LABEL_KEYWORDS) if (trimmed.replace(/\s/g, "").includes(keyword)) return true;

  const compact = trimmed.replace(/\s/g, "");
  if (/^[가-힣0-9()（）·:：\-]+$/.test(compact)
    && compact.length >= 2 && compact.length <= 12
    && (compact.match(/[가-힣]/g) ?? []).length >= 2
    && (compact.length <= 8 || trimmed.split(/\s+/).length <= 2)
    && !NUMERIC_VALUE_RE.test(compact)
    && !SENTENCE_ENDING_RE.test(trimmed)
    && !/^[(（]주[)）]|^주식회사/.test(compact)) {
    return true;
  }
  if (/^[가-힣A-Za-z\s]+[:：]$/.test(trimmed)) return true;
  // “1. 기관명 :”처럼 항목 번호가 붙은 라벨 칸
  if (/^(?:[①-⑳]|\(?\d{1,3}[).]|[가-힣][).])\s*[가-힣A-Za-z\s]{1,20}[:：]$/.test(trimmed)) return true;
  if (/^[A-Za-z][A-Za-z\s./&-]*$/.test(trimmed) && trimmed.length <= 20) {
    const words = trimmed.toLowerCase().split(/[\s/&]+/).filter((word) => word && !ENGLISH_STOPWORDS.has(word));
    if (words.length >= 1 && words.length <= 3 && words.every((word) => ENGLISH_LABEL_WORDS.has(word.replace(/\.$/, "")))) return true;
  }
  return false;
}

/**
 * 라벨 칸 오른쪽이 하위 라벨이고 그 옆이 빈 값 칸이면 값 자리가 아니다 — kordoc isSubLabelBeside.
 * 행 머리가 여러 행을 덮은 표(‘경력’ 아래 ‘기간 | 소속 | 담당과목’)처럼, 병합 행 머리 오른쪽의
 * 열 머리도 값 자리가 아니라 머리 행이다. 그 아래 행에 값이 들어가므로 여기서 채우면 머리를 덮어쓴다.
 */
export function isSubLabelBeside(labelRowSpan, text, after) {
  if (after === undefined) return false;
  if (labelRowSpan > 1 && isFormLabelCell(text) && (isBlankValueCell(after) || isFormLabelCell(after))) return true;
  if (isBlankValueCell(text) || !isBlankValueCell(after) || !isFormLabelCell(text)) return false;
  const compact = String(text).replace(/\s/g, "");
  return labelRowSpan > 1 || (compact.length <= 15 && [...FORM_LABEL_KEYWORDS].some((keyword) => compact.includes(keyword)));
}

/**
 * 값이 들어갈 수 있는 칸 글자인가 — 빈칸·날짜 자리·서명 자리·`{{…}}`·`[입력]`·`___`.
 * 브라우저 채우기(fillableValueState)와 같은 기준을 스키마 쪽에서도 쓴다.
 */
export function isFillableCellText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return true;
  if (isBlankValueCell(trimmed) || isDatePlaceholderCell(trimmed) || isSignaturePlaceholderCell(trimmed)) return true;
  return detectPlaceholders(trimmed).length > 0;
}

/** 서명·인 자리 표시 — 이름을 적는 칸이지 ‘이미 값이 있는 칸’이 아니다. */
export function isSignaturePlaceholderCell(text) {
  return /^[\s(（\[]*(?:서\s*명(?:\s*(?:또는|\/|,|·)\s*인)?|날\s*인|인\s*(?:또는\s*서명)?|서\s*명\s*날\s*인)[\s)）\]]*$/.test(String(text ?? ""));
}

/**
 * 한 칸·한 문단 안에 ‘성 명 : … 생년월일 : … 주 소 : …’처럼 라벨이 줄지어 있는 서명 블록인가.
 * 계약서·서약서·동의서 끝의 서명란은 라벨 칸이 따로 있지 않고 한 칸 안에 인라인으로 들어온다.
 */
export function isInlineSignatureBlock(text) {
  const source = String(text ?? "");
  if (!source.trim() || source.length > 400) return false;
  const segments = scanInlineFieldSegments(source);
  const identity = segments.filter((segment) => {
    const key = normalizeFormLabel(segment.label);
    const ext = normalizeFormLabel(segment.extLabel || "");
    return SIGNATURE_LABEL_WORDS.some((word) => key.includes(word) || ext.includes(word));
  });
  if (identity.length >= 2) return true;
  return identity.length >= 1 && SEAL_TAIL_RE.test(source.trim());
}

/** 조례·법령 본문처럼 입력칸이 없는 문서인가 — ‘채울 칸 0개’를 오류가 아니라 정상으로 안내한다. */
export function isLegalDocumentSchema(schema) {
  const title = String(schema?.title ?? "").trim();
  if (/(법률|법|조례|시행령|시행규칙|규칙|고시|훈령|예규|지침)$/.test(title)) return true;
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  return sections.filter((section) => /제\s*\d+\s*조/.test(String(section?.title ?? ""))).length >= 3;
}

/** 열 머리 행 판정 — 라벨이 위, 값이 아래인 표인가 (kordoc isColumnHeaderRow) */
export function isColumnHeaderRow(heads, below) {
  if (!Array.isArray(heads) || heads.length < 2 || !Array.isArray(below) || below.some((item) => item === undefined)) return false;
  const normalized = heads.map((head) => String(head ?? "").trim());
  if (normalized.some((head) => !head || head.length > 40 || SENTENCE_ENDING_RE.test(head))) return false;
  const blanks = below.filter((cell) => isBlankValueCell(cell) || isDatePlaceholderCell(cell)).length;
  if (blanks === below.length) return true;
  return normalized.length >= 3 && blanks >= normalized.length - 1 && normalized.every((head) => head.length <= 20 && isFormLabelCell(head));
}

/** kordoc findMatchingKey — 정확 일치 뒤 접두사 60%/역방향 75% 일치 */
export function findMatchingFieldKey(cellLabel, keys) {
  const target = normalizeFormLabel(cellLabel);
  if (!target) return undefined;
  const list = Array.from(keys).map((key) => String(key));
  if (list.includes(target)) return target;
  let best;
  let bestLength = 0;
  for (const key of list) {
    if (target.startsWith(key)) {
      if (key.length >= target.length * 0.6 && key.length > bestLength) {
        bestLength = key.length;
        best = key;
      }
    } else if (key.startsWith(target)) {
      if (target.length >= key.length * 0.75 && target.length > bestLength) {
        bestLength = target.length;
        best = key;
      }
    }
  }
  return best;
}

/* ────────────────────────── 플레이스홀더 · 인라인 라벨 ────────────────────────── */

/**
 * 양식이 값을 받는 자리 표시. kordoc 은 칸 구조로 읽지만, 문서에 글자로 남은 표시도 같은 뜻이라 함께 잡는다.
 * - `{{사업명}}` 같은 머스태시, `[입력]`·`[사업명]` 같은 대괄호 자리
 * - `___`, `○○`, `(   )`, `0000`, `년 월 일` 같은 빈칸
 */
export const PLACEHOLDER_KINDS = ["mustache", "bracket", "blank", "date"];

const MUSTACHE_RE = /\{\{\s*([^{}]{1,40}?)\s*\}\}/g;
const BRACKET_RE = /\[\s*([가-힣A-Za-z][가-힣A-Za-z0-9 ]{0,18}?)\s*\]/g;
/** 대괄호에 들어가도 값 자리가 아닌 표시 — 붙임·별첨·참고 안내 */
const BRACKET_NOT_A_SLOT = /^(붙임|별첨|첨부|참고|비고|예시|예|단위|서식|양식|안내|주의|필수|선택|삭제|이미지|사진|도장|인)(\s*\d+)?$/;
const BLANK_RES = [/_{3,}/, /ㅇ{2,}/, /[○◯]{2,}/, /\(\s{3,}\)/, /\(\s*\)/, /\[\s{2,}\]/, /[([]\s*0{2,}\s*[)\]]/, /\.{4,}/];

/** 한 줄에서 값 자리 표시를 찾는다. */
export function detectPlaceholders(text) {
  const line = String(text ?? "");
  const found = [];
  MUSTACHE_RE.lastIndex = 0;
  let match;
  while ((match = MUSTACHE_RE.exec(line))) found.push({ kind: "mustache", raw: match[0], label: match[1] });
  BRACKET_RE.lastIndex = 0;
  while ((match = BRACKET_RE.exec(line))) {
    const label = match[1].trim();
    if (BRACKET_NOT_A_SLOT.test(label)) continue;
    found.push({ kind: "bracket", raw: match[0], label: label === "입력" || label === "작성" || label === "기입" ? "" : label });
  }
  if (BLANK_RES.some((pattern) => pattern.test(line))) {
    const label = String(line).replace(/[_{3,}ㅇ○◯]/g, " ").replace(/\s+/g, " ").trim();
    found.push({ kind: "blank", raw: (line.match(BLANK_RES.find((pattern) => pattern.test(line)))?.[0]) ?? "", label });
  }
  if (isDatePlaceholderCell(line)) found.push({ kind: "date", raw: line.trim(), label: "" });
  return found;
}

const INLINE_LABEL_RE = /((?:[가-힣A-Za-z]{1,10} )?)([가-힣A-Za-z]{2,10})\s*[:：]/g;
const SPACED_INLINE_LABEL_RE = /(?:(?<![가-힣A-Za-z]\s?)|(?<=\d[일월년]\s))(?<!\d)([가-힣]( {1,3})[가-힣](?:\2[가-힣]){0,6})\s*[:：]/g;
const SEAL_TAIL_RE = /[(（]\s*(?:인|서\s*명|날\s*인|서명\s*또는\s*인|인\s*또는\s*서명|서명\s*또는\s*날인)\s*[)）]\s*$/;
/** 서명 블록으로 볼 라벨 — 금액·비목이 줄지은 예산 내역과 구분한다. */
const SIGNATURE_LABEL_WORDS = ["성명", "이름", "생년월일", "주소", "연락처", "휴대폰", "핸드폰", "전화", "이메일", "소속", "직위", "직장", "대표자", "신청인", "청구인", "작성자", "확인자", "담당자", "서명"];

/**
 * 인라인 양식 한 줄을 라벨 단위로 나눈다 — "사업명: ○○ / 기간: 년 월" 처럼 한 줄에 라벨이 여러 개인 양식.
 * kordoc scanInlineSegments 를 따른다. 값이 빈 라벨도 돌려준다(채울 자리).
 */
export function scanInlineFieldSegments(text) {
  const source = String(text ?? "");
  const labels = [];
  INLINE_LABEL_RE.lastIndex = 0;
  let match;
  while ((match = INLINE_LABEL_RE.exec(source))) {
    if (source[INLINE_LABEL_RE.lastIndex] === "/") continue;
    const extText = match[1] || "";
    labels.push({
      label: match[2],
      ext: extText ? extText + match[2] : undefined,
      extStart: extText ? match.index : undefined,
      start: match.index + extText.length,
      end: INLINE_LABEL_RE.lastIndex
    });
  }
  SPACED_INLINE_LABEL_RE.lastIndex = 0;
  while ((match = SPACED_INLINE_LABEL_RE.exec(source))) {
    const start = match.index;
    const end = SPACED_INLINE_LABEL_RE.lastIndex;
    if (labels.some((label) => label.start < end && start < label.end)) continue;
    labels.push({ label: match[1].replace(/\s+/g, ""), start, end });
  }
  labels.sort((a, b) => a.start - b.start);
  // 앞 라벨의 값 자리에서 바로 시작하는 수식어는 값이다 — “성명: 홍길동 생년월일:”의 ‘홍길동’.
  for (let index = 1; index < labels.length; index += 1) {
    const current = labels[index];
    if (current.extStart === undefined) continue;
    let previousValueStart = labels[index - 1].end;
    while (previousValueStart < source.length && (source[previousValueStart] === " " || source[previousValueStart] === "\t")) previousValueStart += 1;
    if (current.extStart === previousValueStart) {
      current.ext = undefined;
      current.extStart = undefined;
    }
  }

  const segments = [];
  for (let index = 0; index < labels.length; index += 1) {
    const current = labels[index];
    let valueStart = current.end;
    while (valueStart < source.length && (source[valueStart] === " " || source[valueStart] === "\t")) valueStart += 1;
    let valueEnd = index + 1 < labels.length ? (labels[index + 1].extStart ?? labels[index + 1].start) : source.length;
    if (valueEnd < valueStart) valueEnd = valueStart;
    const separator = source.slice(valueStart, valueEnd).search(/[\n,;]/);
    if (separator !== -1) valueEnd = valueStart + separator;
    if (valueEnd - valueStart > 200) valueEnd = valueStart + 200;
    const seal = source.slice(valueStart, valueEnd).search(SEAL_TAIL_RE);
    if (seal !== -1) valueEnd = valueStart + seal;
    while (valueEnd > valueStart && /\s/.test(source[valueEnd - 1])) valueEnd -= 1;
    segments.push({
      label: current.label,
      extLabel: current.ext,
      value: source.slice(valueStart, valueEnd),
      start: current.start,
      valueStart,
      valueEnd
    });
  }
  return segments;
}

/* ────────────────────────── 필드 타입 · 힌트 ────────────────────────── */

const LABEL_TYPE_RULES = [
  [/주민등록번호|외국인등록번호/, "idnum"],
  [/생년월일|일시|날짜|일자|기간|연월일|년월일|신청일|작성일|발급일|접수일|일정/, "date"],
  [/전화|연락처|휴대폰|핸드폰|팩스/, "phone"],
  [/이메일|전자우편|email/i, "email"],
  [/금액|단가|수량|합계|소계|예산|비용|사업비|인원|급여|연봉/, "amount"]
];

/** 필드 타입 추론 — 값 모양 우선, 없으면 라벨 낱말 (kordoc inferFieldType) */
export function fieldTypeOf(label, value) {
  if (/[□☑✓✔]/.test(String(value ?? "")) || /[□☑✓✔]/.test(String(label ?? ""))) return "checkbox";
  const text = String(value ?? "").trim();
  if (text) {
    if (/^\d{6}[-\s]?[1-4]\d{6}$/.test(text)) return "idnum";
    if (/^\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?\s*\.?$/.test(text)) return "date";
    if (/^0\d{1,2}[-.)\s]?\d{3,4}[-.\s]?\d{4}$/.test(text)) return "phone";
    if (/^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(text)) return "email";
    if (/^[\d,.\s]+(?:원|명|건|개|회|부|매|%)$/.test(text) && /\d/.test(text)) return "amount";
    if (/^\d{1,3}(?:,\d{3})+$/.test(text)) return "amount";
  }
  const compact = String(label ?? "").replace(/\s/g, "");
  for (const [pattern, type] of LABEL_TYPE_RULES) if (pattern.test(compact)) return type;
  return "text";
}

/** 라벨의 필수 표시(※·*·★·"(필수)") */
export function isRequiredLabel(label) {
  return /[*※★]|\(\s*필수\s*\)|（\s*필수\s*）/.test(String(label ?? ""));
}

/* ────────────────────────── 스키마 → kordoc 필드 ────────────────────────── */

const GENERIC_HEADERS = /^(구분|항목|비목|종류|분류|번호|연번|순번|단계|월|일자|성명|이름|내용|세부\s*내용|세부내용|작성\s*내용|산출\s*내역|산출내역|금액|금액\(원\)|비고|단위|수량)$/;

function isGenericHeader(text) {
  return GENERIC_HEADERS.test(String(text ?? "").replace(/\s+/g, " ").trim());
}

function isSyntheticHeader(headers) {
  return Array.isArray(headers) && headers.every((header) => /^열 \d+$/.test(String(header ?? "").trim()));
}

/** 안내문(작성 요령)에서 칸에 붙일 힌트 문장만 남긴다. */
function hintTextOf(text) {
  const cleaned = String(text ?? "")
    .replace(/^[○●□■◇▷▶·ㆍ※*\-–—\s]+/, "")
    .replace(/^\(?\s*작성\s*(?:요령|방법|기준|예시|안내)\s*\)?\s*[:：]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > 90 ? `${cleaned.slice(0, 89)}…` : cleaned;
}

/**
 * 읽어 둔 양식 스키마에서 kordoc 이 채울 수 있는 칸(필드)을 뽑는다.
 * - 표: `라벨 | 빈칸` 쌍(칸 좌표·병합 반영), 열 머리 아래 값 칸
 * - 본문: "라벨: 값"·"라벨:" 인라인, `{{필드}}`·`[입력]`·`___` 자리 표시
 * 각 필드에는 그 칸이 무엇을 받는지 알려 주는 힌트(같은 구역의 작성 요령)와 원문 맥락을 붙인다.
 */
export function extractFormFields(schema) {
  const fields = [];
  const usedKeys = new Set();
  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  const tables = Array.isArray(schema?.tables) ? schema.tables : [];
  const slots = Array.isArray(schema?.slots) ? schema.slots : [];
  const sectionTitleOf = (sectionId) => sections.find((section) => section.id === sectionId)?.title || "";

  const pushField = (field) => {
    const label = String(field.label ?? "").trim();
    if (!label) return null;
    let key = normalizeFormLabel(label);
    if (!key) return null;
    if (usedKeys.has(key) && (field.origin === "table" || field.origin === "inline")) {
      // 같은 라벨이 여러 칸이면 kordoc 은 배열 값으로 순서대로 채운다 — 키는 하나로 둔다.
      field.duplicate = true;
    }
    usedKeys.add(key);
    const created = {
      id: `f${fields.length + 1}`,
      label,
      key,
      fillKey: field.fillLabel || label,
      value: String(field.value ?? ""),
      empty: isFillableCellText(field.value),
      type: fieldTypeOf(label, field.value),
      required: isRequiredLabel(label) || undefined,
      hint: hintTextOf(field.hint),
      sectionId: field.sectionId ?? null,
      sectionTitle: field.sectionTitle || sectionTitleOf(field.sectionId),
      tableId: field.tableId,
      rowIndex: field.rowIndex,
      columnIndex: field.columnIndex,
      slotId: field.slotId,
      origin: field.origin,
      duplicate: field.duplicate || undefined,
      /** 글자 전체(또는 앞부분+값)를 갈아끼우는 칸 — 라벨로 찾지 않고 원문 글자로 찾는다. */
      rewrite: field.rewrite || undefined,
      /** 갈아끼울 때 찾을 원문 줄 글자 */
      blockText: field.blockText || undefined,
      /** 값 앞에 그대로 두어야 하는 글자 */
      prefix: field.prefix === undefined ? undefined : String(field.prefix),
      context: field.context || ""
    };
    fields.push(created);
    return created;
  };

  /**
   * 인라인 서명 블록 — 한 칸·한 문단 안에 ‘성명: … 생년월일: … 주소: …’처럼 라벨이 줄지어 있는 자리.
   * 빈칸은 채울 칸으로, 이미 적힌 값은 ‘원본 유지’ 칸으로 보여 준다(계약서·서약서·동의서 끝).
   */
  const pushInlineSignatureFields = ({ text, tableId, rowIndex, columnIndex, slotId, sectionId, context }) => {
    if (!isInlineSignatureBlock(text)) return 0;
    let added = 0;
    for (const segment of scanInlineFieldSegments(text)) {
      const label = String(segment.extLabel || segment.label || "").trim();
      const fillLabel = String(segment.label || "").trim();
      if (!label || !fillLabel || !isFormLabelCell(label)) continue;
      const value = String(segment.value ?? "").trim();
      const fillable = isFillableCellText(value);
      const created = pushField({
        label,
        fillLabel,
        value: fillable ? "" : value,
        sectionId,
        tableId,
        rowIndex,
        columnIndex,
        slotId,
        origin: "inline",
        hint: "",
        context
      });
      if (created) added += 1;
    }
    return added;
  };

  const pushInlineFieldsOfTable = (table, rows, caption) => {
    rows.forEach((row, rowIndex) => {
      const cells = Array.isArray(row) ? row : [];
      cells.forEach((cell, columnIndex) => {
        const text = String(cell ?? "").trim();
        if (!text) return;
        pushInlineSignatureFields({
          text,
          tableId: table.id,
          rowIndex,
          columnIndex,
          sectionId: table.sectionId,
          context: `${caption} ${rowIndex + 1}행 ${columnIndex + 1}열`
        });
      });
    });
  };

  /* 표 — 라벨 칸 오른쪽(또는 열 머리 아래) 값 칸 */
  for (const table of tables) {
    const headers = Array.isArray(table.headers) ? table.headers : [];
    const rows = Array.isArray(table.rows) ? table.rows : [];
    const spans = Array.isArray(table.spans) ? table.spans : null;
    const synthetic = isSyntheticHeader(headers);
    const genericHead = headers.length >= 2 && isGenericHeader(headers[0]) && isGenericHeader(headers[1]);
    const caption = table.caption || `표 ${table.id}`;
    const rowSpanOf = (rowIndex, column) => Number(spans?.[rowIndex]?.[column]?.[0]) || 1;
    const colSpanOf = (rowIndex, column) => Number(spans?.[rowIndex]?.[column]?.[1]) || 1;
    const columnCount = Math.max(headers.length, ...rows.map((row) => (Array.isArray(row) ? row.length : 0)), 1);
    const hint = (sectionId) => slots.find((slot) => slot.kind === "guide" && slot.sectionId === sectionId)?.preview || "";

    /**
     * 표 제목 띠·행 머리 띠를 ‘라벨 | 값’으로 오인하지 않는다.
     * - 여러 열을 덮은 제목 칸(“강사카드”, “인적사항”)은 값 칸이 아니라 구역 제목이다.
     * - 라벨 옆 빈 칸 뒤에 다른 내용이 이어지면 그 빈 칸은 값 자리가 아니라 레이아웃 여백이다.
     */
    const isBandLabelPair = (rowIndex, column, cells) => {
      const labelColSpan = colSpanOf(rowIndex, column);
      const valueColSpan = colSpanOf(rowIndex, column + 1);
      const valueRowSpan = rowSpanOf(rowIndex, column + 1);
      if (columnCount >= 2 && labelColSpan >= columnCount) return true;
      if (labelColSpan >= 3) return true;
      if (labelColSpan >= 2 && valueRowSpan >= 3) return true;
      const valueText = String(cells[column + 1] ?? "").trim();
      if (!isFillableCellText(valueText) || !isBlankValueCell(valueText)) return false;
      const immediateAfter = String(cells[column + 2] ?? "").trim();
      if (isFormLabelCell(immediateAfter)) return false;
      const later = cells.slice(column + 3).some((cell) => String(cell ?? "").trim());
      return Boolean(immediateAfter || later);
    };

    /** 한 행 전체를 덮은 칸 하나뿐인 행 — 구역 제목 띠 */
    const isBandRow = (rowIndex, cells) => {
      const filled = cells.map((cell, column) => ({ text: String(cell ?? "").trim(), column })).filter((cell) => cell.text);
      if (filled.length > 1) return false;
      return filled.length === 1 && colSpanOf(rowIndex, filled[0].column) >= 3;
    };

    if (synthetic || genericHead || headers.length === 1) {
      // 제목 띠(‘자격사항’) 다음 줄이 열 머리이고 그 아래가 빈칸인 표 — 이력서·내역서의 반복 행 표.
      // 머리 줄을 라벨|값으로 읽으면 ‘경력 → 기간’처럼 머리를 값으로 오인하므로 먼저 열 머리 표로 본다.
      let headerIndex = 0;
      while (headerIndex < rows.length && isBandRow(headerIndex, rows[headerIndex])) headerIndex += 1;
      const headerNames = (Array.isArray(rows[headerIndex]) ? rows[headerIndex] : []).map((cell) => String(cell ?? "").trim());
      const headerAllLabels = headerIndex > 0
        && headerNames.filter(Boolean).length >= 2
        && headerNames.every((text) => !text || isFormLabelCell(text));
      const nextRow = Array.isArray(rows[headerIndex + 1]) ? rows[headerIndex + 1] : [];
      const nextRowBlankUnderHeader = headerNames.some((text, column) => column > 0 && text && isFillableCellText(nextRow[column]));
      if (headerAllLabels && nextRowBlankUnderHeader) {
        for (let column = 0; column < headerNames.length; column += 1) {
          const headerName = headerNames[column];
          if (!headerName) continue;
          for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
            const rowCells = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
            const value = String(rowCells[column] ?? "").trim();
            if (!isFillableCellText(value)) continue;
            pushField({
              label: headerName,
              fillLabel: headerName,
              value: "",
              sectionId: table.sectionId,
              tableId: table.id,
              rowIndex,
              columnIndex: column,
              origin: "table",
              hint: hint(table.sectionId),
              context: `${caption} ${rowIndex + 1}행 ${column + 1}열`
            });
          }
        }
        pushInlineFieldsOfTable(table, rows, caption);
        continue;
      }

      // 머리글 없는 `라벨 | 값` 표, 또는 "구분 | 내용" 표 — 행마다 라벨·값 쌍
      rows.forEach((row, rowIndex) => {
        const cells = Array.isArray(row) ? row : [];
        if (isBandRow(rowIndex, cells)) return;
        for (let column = 0; column < cells.length - 1; column += 1) {
          const labelCell = String(cells[column] ?? "").trim();
          const valueCell = String(cells[column + 1] ?? "").trim();
          if (!labelCell || !isFormLabelCell(labelCell)) continue;
          // 값 칸이 인라인 서명 블록이면 라벨 하나의 값이 아니라 라벨 여러 개의 자리다 — 인라인 전략이 맡는다.
          if (valueCell && isInlineSignatureBlock(valueCell)) break;
          // 병합 행 머리(‘경력’·‘전공’) 오른쪽의 열 머리는 값 자리가 아니다 — 그 행은 건너뛴다.
          if (isSubLabelBeside(rowSpanOf(rowIndex, column), labelCell, String(cells[column + 2] ?? "") || undefined)) break;
          if (isBandLabelPair(rowIndex, column, cells)) break;
          pushField({
            label: labelCell,
            value: valueCell,
            sectionId: table.sectionId,
            tableId: table.id,
            rowIndex,
            columnIndex: column + 1,
            origin: "table",
            hint: hint(table.sectionId),
            context: `${caption} ${rowIndex + 1}행`
          });
          break;
        }
      });
      pushInlineFieldsOfTable(table, rows, caption);
      continue;
    }

    // 열 머리 + 데이터 행 표 — 머리 이름이 곧 kordoc 의 채우기 키
    rows.forEach((row, rowIndex) => {
      const cells = Array.isArray(row) ? row : [];
      if (isBandRow(rowIndex, cells)) return;
      for (let column = 1; column < headers.length; column += 1) {
        const header = String(headers[column] ?? "").trim();
        const value = String(cells[column] ?? "").trim();
        if (!header || /^열 \d+$/.test(header)) continue;
        const rowLabel = String(cells[0] ?? "").trim();
        if (!rowLabel && !value) continue;
        const label = rowLabel && !isGenericHeader(rowLabel) ? `${rowLabel} · ${header}` : header;
        pushField({
          label,
          fillLabel: header,
          value,
          sectionId: table.sectionId,
          tableId: table.id,
          rowIndex,
          columnIndex: column,
          origin: "table",
          hint: hint(table.sectionId),
          context: `${caption} ${rowIndex + 1}행`
        });
      }
    });
    pushInlineFieldsOfTable(table, rows, caption);
  }

  /* 본문·칸 슬롯 — 라벨: 값 · 문서 제목 · 인라인 라벨 · 자리 표시 */
  for (const slot of slots) {
    if (slot.kind === "table-cell" || slot.kind === "guide") continue;
    // 표 밖 문단에 적힌 ‘라벨: 값’ — 결과보고서 사업명·기간·운영회차 같은 값.
    if (slot.kind === "labelled") {
      const value = String(slot.value ?? "").trim();
      if (!value) continue;
      pushField({
        label: slot.label,
        fillLabel: slot.fillLabel || slot.label,
        value,
        sectionId: slot.sectionId,
        slotId: slot.id,
        origin: "text",
        hint: "",
        context: slot.sectionTitle || ""
      });
      continue;
    }
    // 라벨 위치를 짚기 어려운 ‘라벨: 값’(괄호가 섞인 라벨) — 줄 앞부분은 그대로 두고 값만 갈아끼운다.
    if (slot.kind === "labelled-text") {
      const value = String(slot.value ?? "").trim();
      if (!value) continue;
      pushField({
        label: slot.label,
        fillLabel: slot.fillLabel || slot.label,
        value,
        sectionId: slot.sectionId,
        slotId: slot.id,
        origin: "text",
        rewrite: true,
        blockText: String(slot.preview ?? "").trim(),
        prefix: String(slot.prefix ?? ""),
        hint: "",
        context: slot.sectionTitle || ""
      });
      continue;
    }
    // 문서 제목 문단·칸 — 라벨이 따로 없으므로 글자 전체를 통째로 갈아끼우는 칸으로 둔다.
    if (slot.kind === "title") {
      const value = String(slot.value ?? "").trim();
      if (!value) continue;
      pushField({
        label: slot.label || "문서 제목",
        fillLabel: slot.label || "문서 제목",
        value,
        sectionId: slot.sectionId,
        slotId: slot.id,
        tableId: slot.tableId,
        rowIndex: slot.rowIndex,
        columnIndex: slot.columnIndex,
        origin: "text",
        rewrite: true,
        blockText: value,
        prefix: "",
        hint: "",
        context: slot.sectionTitle || ""
      });
      continue;
    }
    const preview = String(slot.preview ?? slot.label ?? "");
    if (!preview) continue;
    // 서명 블록은 라벨이 여러 개라 아래 일반 스캔으로는 일부만 잡힌다 — 한 번에 라벨별로 나눈다.
    if (isInlineSignatureBlock(preview)) {
      pushInlineSignatureFields({
        text: preview,
        slotId: slot.id,
        sectionId: slot.sectionId,
        context: slot.sectionTitle || ""
      });
      continue;
    }
    let matched = false;
    for (const segment of scanInlineFieldSegments(preview)) {
      const value = segment.value.trim();
      if (value && !isBlankValueCell(value) && !detectPlaceholders(value).length) continue;
      pushField({
        label: segment.extLabel || segment.label,
        fillLabel: segment.label,
        value: isBlankValueCell(value) ? "" : "",
        sectionId: slot.sectionId,
        slotId: slot.id,
        origin: "text",
        hint: slot.kind === "guide" ? "" : "",
        context: slot.sectionTitle || ""
      });
      matched = true;
    }
    if (matched) continue;
    for (const placeholder of detectPlaceholders(preview)) {
      if (placeholder.kind === "date" && !placeholder.label) continue;
      const label = placeholder.label || slot.label;
      if (!label) continue;
      pushField({
        label,
        value: "",
        sectionId: slot.sectionId,
        slotId: slot.id,
        origin: "placeholder",
        hint: "",
        context: slot.sectionTitle || ""
      });
    }
  }

  return fields;
}

/** 필드가 가리키는 칸의 현재 값 */
export function fieldValueOf(schema, field) {
  if (!schema || !field) return "";
  if (field.tableId) {
    const table = (schema.tables || []).find((item) => item.id === field.tableId);
    const row = table?.rows?.[field.rowIndex];
    return String(row?.[field.columnIndex] ?? "");
  }
  if (field.slotId) {
    const slot = (schema.slots || []).find((item) => item.id === field.slotId);
    return String(slot?.value ?? slot?.preview ?? "");
  }
  return String(field.value ?? "");
}

/**
 * 스키마 사본에 값을 넣는다. 원본 칸 글자는 덮어쓰지 않고, 비어 있거나 자리표시인 칸만 채운다.
 * (force=true 이면 사용자가 확인한 칸만 덮어쓴다.)
 */
export function applyFieldValues(schema, valuesByFieldId, { force = false } = {}) {
  if (!schema) return schema;
  const fields = extractFormFields(schema);
  const next = {
    ...schema,
    tables: (schema.tables || []).map((table) => ({ ...table, rows: (table.rows || []).map((row) => row.slice()) })),
    slots: (schema.slots || []).map((slot) => ({ ...slot }))
  };
  let applied = 0;
  const skipped = [];
  for (const field of fields) {
    const value = String(valuesByFieldId?.[field.id] ?? "").trim();
    if (!value) continue;
    if (field.origin === "inline") {
      // 인라인 서명 블록의 값은 칸 글자를 통째로 바꾸지 않는다 — .hwpx를 채울 때 같은 자리에 쓴다.
      applied += 1;
      continue;
    }
    if (field.rewrite) {
      // 문서 제목처럼 글자 전체를 갈아끼우는 칸 — 스키마 표·칸 글자는 그대로 두고 .hwpx에서 바꿈.
      applied += 1;
      continue;
    }
    if (field.tableId) {
      const table = next.tables.find((item) => item.id === field.tableId);
      if (!table) continue;
      const row = table.rows[field.rowIndex];
      if (!row) continue;
      const current = String(row[field.columnIndex] ?? "").trim();
      if (current && !isBlankValueCell(current) && !force && !field.empty) {
        skipped.push({ field, current });
        continue;
      }
      row[field.columnIndex] = value;
      applied += 1;
      continue;
    }
    if (field.slotId) {
      const slot = next.slots.find((item) => item.id === field.slotId);
      if (!slot) continue;
      slot.value = value;
      applied += 1;
    }
  }
  // 표의 빈칸 수와 스키마 요약을 다시 센다 — 채운 뒤에도 “빈칸 6”으로 남으면 화면이 거짓말을 한다.
  let emptyCells = 0;
  next.tables = next.tables.map((table) => {
    let tableEmpty = 0;
    const headers = Array.isArray(table.headers) ? table.headers : [];
    for (const row of table.rows || []) {
      for (let column = 0; column < headers.length; column += 1) {
        if (!String(row?.[column] ?? "").trim()) tableEmpty += 1;
      }
    }
    emptyCells += tableEmpty;
    return { ...table, emptyCells: tableEmpty };
  });
  next.counts = { ...(schema.counts || {}), emptyCells };

  return { schema: next, applied, skipped };
}

/* ────────────────────────── kordoc 채우기 데이터 ────────────────────────── */

/**
 * 채울 값들을 kordoc fill 의 `-j` JSON 모양으로 만든다.
 * - 키는 칸 라벨 글자 그대로(콜론·공백 제거) — kordoc 이 같은 규칙으로 정규화한다.
 * - 같은 라벨이 여러 칸이면 등장 순서 배열로 넣는다(kordoc 배열 값 규칙).
 */
export function buildKordocFillValues({ fields, values }) {
  const entries = [];
  const byKey = new Map();
  const warnings = [];
  const list = Array.isArray(fields) ? fields : [];
  for (const field of list) {
    // 문서 제목처럼 글자 전체를 갈아끼우는 칸은 라벨 채우기 값이 아니다(별도 목록으로 넘긴다).
    // 다만 검토 표에는 보여야 하므로 항목으로는 남긴다.
    if (field.rewrite) {
      const titleValue = String(values?.[field.id] ?? "").trim();
      if (!titleValue) continue;
      entries.push({ key: field.fillKey || field.label, normalized: normalizeFormLabel(field.fillKey || field.label), value: titleValue, fields: [field], rewrite: true });
      continue;
    }
    const value = String(values?.[field.id] ?? "").trim();
    if (!value) continue;
    const key = field.fillKey || field.label;
    const normalized = normalizeFormLabel(key);
    const existing = byKey.get(normalized);
    if (!existing) {
      const entry = { key, normalized, value, fields: [field] };
      byKey.set(normalized, entry);
      entries.push(entry);
      continue;
    }
    if (existing.value === value) {
      existing.fields.push(field);
      continue;
    }
    existing.fields.push(field);
    if (Array.isArray(existing.value)) existing.value.push(value);
    else existing.value = [existing.value, value];
  }

  const values_ = {};
  const rows = [];
  for (const entry of entries) {
    if (entry.rewrite) {
      // 라벨로 찾는 값이 아니라 원문 글자로 찾는 값 — filler 의 rewrites 로 넘어간다.
      rows.push({ key: entry.key, value: entry.value, label: entry.fields[0].label, sectionTitle: entry.fields[0].sectionTitle, where: whereOf(entry.fields[0]), fieldId: entry.fields[0].id });
      continue;
    }
    values_[entry.key] = entry.value;
    const fieldsInEntry = entry.fields;
    if (Array.isArray(entry.value)) {
      warnings.push(`‘${entry.key}’ 칸이 ${entry.value.length}곳이라 값 ${entry.value.length}개를 등장 순서대로 넣습니다. 순서를 확인해 주세요.`);
      fieldsInEntry.forEach((field, index) => {
        rows.push({ key: entry.key, value: entry.value[index], label: field.label, sectionTitle: field.sectionTitle, where: whereOf(field), fieldId: field.id });
      });
    } else {
      for (const field of fieldsInEntry) {
        rows.push({ key: entry.key, value: entry.value, label: field.label, sectionTitle: field.sectionTitle, where: whereOf(field), fieldId: field.id });
      }
    }
  }
  const unmapped = list.filter((field) => !field.rewrite && !String(values?.[field.id] ?? "").trim());
  return { values: values_, entries: rows, warnings, unmapped };
}

function whereOf(field) {
  if (field.tableId) return `${field.sectionTitle || "표"} · ${field.rowIndex + 1}행 ${field.columnIndex + 1}열`;
  if (field.slotId) return `${field.sectionTitle || "본문"} · 문단`;
  return field.sectionTitle || "";
}

/** 터미널·브릿지로 넘길 채우기 JSON 문자열 */
export function kordocFillJsonText(values) {
  const safe = values && typeof values === "object" ? values : {};
  return `${JSON.stringify(safe, null, 2)}\n`;
}

/** 셸에서 쓸 파일 이름만 남긴다. */
export function safeShellName(value, fallback = "form") {
  const cleaned = String(value ?? "")
    .replace(/[\\/:*?"<>|`$]/g, " ")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function quoteShell(value) {
  return `"${String(value).replace(/"/g, "'")}"`;
}

/**
 * 원본 서식에 값만 넣는 명령 — kordoc fill 서식.hwpx -j 값.json -o 결과.hwpx
 * (-j 는 셸 기록·프로세스 목록에 값이 남지 않아 -f 보다 안전하다.)
 */
export function buildKordocFillCommand({ templateFile, valuesFile = "채움값.json", outputFile } = {}) {
  const template = safeShellName(templateFile, "양식.hwpx");
  if (!/\.(hwpx|hwp)$/i.test(template)) return "";
  const output = safeShellName(outputFile || template.replace(/\.(hwpx|hwp)$/i, "") + "-채움.hwpx", "양식-채움.hwpx");
  return `npx -y kordoc@${KORDOC_SPEC_VERSION} fill ${quoteShell(template)} -j ${quoteShell(safeShellName(valuesFile, "채움값.json"))} -o ${quoteShell(output)}`;
}

/** 서식을 유지한 채 편집본 Markdown 을 원본에 되돌리는 명령 — kordoc patch */
export function buildKordocPatchCommand({ templateFile, editedFile, outputFile } = {}) {
  const template = safeShellName(templateFile, "양식.hwpx");
  if (!/\.(hwpx|hwp)$/i.test(template)) return "";
  const edited = safeShellName(editedFile, "채운문서.md");
  const output = safeShellName(outputFile || template.replace(/\.(hwpx|hwp)$/i, "") + "-반영.hwpx", "양식-반영.hwpx");
  return `npx -y kordoc@${KORDOC_SPEC_VERSION} patch ${quoteShell(template)} ${quoteShell(edited)} -o ${quoteShell(output)}`;
}

/** 브릿지에 보내는 본문 — 모드(fill/patch)에 필요한 것만 담는다. */
export function buildKordocFillPayload({ fileName, fileBase64, values, mode = "fill", markdown = "", outputName = "" } = {}) {
  const name = safeShellName(fileName, "양식.hwpx");
  const payload = {
    format: "hwpx",
    engine: "kordoc",
    mode: mode === "patch" ? "patch" : "fill",
    fileName: name,
    outputName: safeShellName(outputName || name.replace(/\.(hwpx|hwp)$/i, "") + (mode === "patch" ? "-반영.hwpx" : "-채움.hwpx"), "결과.hwpx")
  };
  const base64 = String(fileBase64 ?? "").trim();
  if (!base64) return null;
  payload.templateBase64 = base64;
  if (payload.mode === "patch") {
    if (!String(markdown ?? "").trim()) return null;
    payload.markdown = String(markdown);
    return payload;
  }
  const cleanValues = {};
  for (const [key, value] of Object.entries(values && typeof values === "object" ? values : {})) {
    const label = String(key ?? "").trim();
    if (!label) continue;
    if (Array.isArray(value)) {
      const list = value.map((item) => String(item ?? "").trim()).filter(Boolean);
      if (list.length) cleanValues[label] = list;
    } else {
      const text = String(value ?? "").trim();
      if (text) cleanValues[label] = text;
    }
  }
  if (!Object.keys(cleanValues).length) return null;
  payload.values = cleanValues;
  return payload;
}

/** 브릿지 계약 — 사용자가 자기 브릿지를 만들 때도 이 모양만 맞추면 된다. */
export const KORDOC_FILL_CONTRACT = [
  "POST 로 JSON 을 받습니다: { engine: \"kordoc\", mode: \"fill\"|\"patch\", fileName, templateBase64, values|markdown, outputName }",
  "서버는 받은 base64 를 임시 .hwpx 로 쓰고 kordoc fill/patch 를 실행합니다.",
  "성공하면 { ok: true, fileName, base64 } 를, 실패하면 4xx·5xx 와 { ok: false, error } 를 돌려줍니다.",
  "채운 파일에는 개인정보가 들어 있을 수 있으니 브릿지는 내 컴퓨터 안에서만 띄우세요."
];

export const KORDOC_FILL_HINT =
  "양식에 값을 넣는 일은 이제 브라우저 안에서 끝납니다. 로컬 kordoc fill(원본 서식 유지)이나 patch(서식 유지 편집)는 터미널·브릿지를 쓰는 사람을 위한 보조 수단입니다.";
