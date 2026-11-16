// HWPX 미리보기(Preview/) 정리 — 채운 파일이 옛 문서처럼 보이지 않게 만든다.
//
// HWPX 안에는 본문(Contents/section*.xml) 말고도 미리보기 두 가지가 들어 있다.
//   · Preview/PrvText.txt  — 문서 앞부분을 글자로 담은 미리보기(한컴이 만든 파일은 META-INF/container.xml 의 rootfile 로도 등록한다)
//   · Preview/PrvImage.png — 1쪽을 그림으로 담은 미리보기
// 양식에 값을 채워도 이 두 파일은 원본 그대로 복사돼, 모바일·일부 뷰어가 본문 대신 미리보기를 먼저 보여 줄 때
// **작년 문서처럼** 보이는 문제가 있었다(2025년 양식을 2026년 내용으로 채워 내려받은 실제 사례).
//
// 그래서 채운 파일을 묶을 때 이렇게 한다.
//   1) PrvText.txt 는 채워진 본문에서 뽑은 글자로 **새로 만든다** — 옛 연도 글자가 남지 않는다.
//   2) PrvImage.png 는 브라우저에서 1쪽을 정확히 그릴 수 없으므로 **넣지 않는다**. 옛 그림이 남는 것보다 없는 편이 낫다
//      (뷰어는 그림이 없으면 본문을 직접 그린다).
//   3) 그림을 가리키던 목록 항목(Contents/content.hpf·META-INF/manifest.xml·container.xml)이 있으면 함께 지워 정합성을 맞춘다.
//
// 실제 한컴오피스가 만든 .hwpx 를 확인한 결과: PrvImage.png 는 어떤 목록에도 등록돼 있지 않고,
// container.xml 은 PrvText.txt 만 rootfile 로 등록한다. 그래서 그림을 빼고 글자만 새로 써도 패키지 참조는 깨지지 않는다.

/** 새로 쓰는 미리보기 글자 파일 이름(HWPX 표준 경로) */
export const PREVIEW_TEXT_ENTRY = "Preview/PrvText.txt";
/** 지우는 미리보기 그림 파일 이름(한컴 기본 경로) */
export const PREVIEW_IMAGE_ENTRY = "Preview/PrvImage.png";
/** 미리보기 글자 길이 상한 — 표준 미리보기 수준(문서 앞부분 1000~1500자) */
export const DEFAULT_PREVIEW_TEXT_LIMIT = 1200;

const PREVIEW_TEXT_RE = /^Preview\/PrvText\.txt$/i;
const PREVIEW_IMAGE_RE = /^Preview\/PrvImage\.[A-Za-z0-9]+$/i;
/** 본문 참조 목록에서 지울 수 있는 요소 이름(패키지 목록·매니페스트 항목) */
const REFERENCE_LOCALS = new Set(["item", "itemref", "rootfile", "file-entry", "fileentry"]);

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

export function isPreviewTextEntry(name) {
  return PREVIEW_TEXT_RE.test(String(name ?? ""));
}

/** Preview/PrvImage.png · PrvImage.bmp 처럼 그림 미리보기 엔트리인가 */
export function isPreviewImageEntry(name) {
  return PREVIEW_IMAGE_RE.test(String(name ?? ""));
}

function safeCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * 섹션 XML 한 벌에서 보이는 글자만 문서 순서로 뽑는다.
 * `<hp:t>` 안 글자를 모으고, 문단 끝(`</hp:p>`)·줄바꿈(`<hp:lineBreak/>`)은 줄로, 탭·고정폭 빈칸은 빈칸으로 옮긴다.
 * `<hp:t/>` 처럼 스스로 닫히는 빈 글자 요소는 아무것도 더하지 않는다(뒤따르는 글자를 잘못 삼키지 않게).
 */
function collectPreviewRawText(xml) {
  const source = String(xml ?? "");
  const pieces = [];
  let insideText = 0;
  let cursor = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(source))) {
    if (insideText > 0 && match.index > cursor) pieces.push(decodeEntities(source.slice(cursor, match.index)));
    cursor = TOKEN_RE.lastIndex;
    if (match[1] !== undefined) {
      if (insideText > 0) pieces.push(match[1]);
      continue;
    }
    const name = match[3];
    if (!name) continue; // 주석·선언
    const closing = match[2] === "/";
    const selfClosing = match[5] === "/";
    const local = name.split(":").pop().toLowerCase();
    if (local === "t") {
      if (closing) {
        if (insideText > 0) insideText -= 1;
      } else if (!selfClosing) {
        insideText += 1;
      }
      continue;
    }
    if (local === "p") {
      if (closing) pieces.push("\n");
      continue;
    }
    if (local === "linebreak" || local === "lb") {
      pieces.push("\n");
      continue;
    }
    if (local === "tab") {
      pieces.push("\t");
      continue;
    }
    if (local === "fwspace" || local === "nbspace" || local === "nonbreakspace") pieces.push(" ");
  }
  return pieces.join("");
}

/** 미리보기 글자를 줄 단위로 다듬는다 — 빈 줄 제거, 줄 앞뒤·겹친 빈칸 정리. */
function previewLines(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t\u00a0]/g, " ").replace(/ {2,}/g, " ").trim())
    .filter((line) => line.length > 0);
}

/**
 * 채운 본문(section XML 들)에서 미리보기 글자를 만든다.
 * 앞부분만 남기고(기본 1200자) 줄 경계에서 끊는다 — 한컴오피스가 쓰는 PrvText.txt 와 같은 CRLF 줄바꿈.
 */
export function extractPreviewText(sectionXmls, { limit = DEFAULT_PREVIEW_TEXT_LIMIT } = {}) {
  const list = Array.isArray(sectionXmls) ? sectionXmls : [sectionXmls];
  const raw = list.map((xml) => collectPreviewRawText(xml)).join("\n");
  const lines = previewLines(raw);
  const max = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_PREVIEW_TEXT_LIMIT;
  const kept = [];
  let length = 0;
  for (const line of lines) {
    const added = (kept.length ? 2 : 0) + line.length;
    if (length + added > max) {
      if (!kept.length && max > 1) kept.push(`${line.slice(0, max - 1)}…`);
      break;
    }
    kept.push(line);
    length += added;
  }
  return kept.join("\r\n");
}

function attrValue(attrs, name) {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(String(attrs ?? ""));
  return found ? String(found[1] ?? found[2] ?? "") : "";
}

/** XML 안의 요소를 문서 순서로 훑는다(여는 태그 속성·요소 범위). 목록 파일은 평평해 스택으로 충분하다. */
function scanElements(source) {
  const elements = [];
  const stack = [];
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(source))) {
    const name = match[3];
    if (!name) continue;
    const closing = match[2] === "/";
    const selfClosing = match[5] === "/";
    if (closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index -= 1;
      if (index >= 0) {
        stack[index].end = TOKEN_RE.lastIndex;
        stack.length = index;
      }
      continue;
    }
    const element = {
      name,
      local: name.split(":").pop().toLowerCase(),
      attrs: match[4] || "",
      start: match.index,
      end: TOKEN_RE.lastIndex,
      selfClosing
    };
    elements.push(element);
    if (!selfClosing) stack.push(element);
  }
  return elements;
}

/**
 * 패키지 목록(Contents/content.hpf·META-INF/manifest.xml·container.xml)에서 미리보기 **그림**을 가리키는 항목을 지운다.
 * 그림 파일을 빼면서 목록에 이름만 남아 깨지는 일을 막는다.
 * @returns {{xml: string, changed: boolean, removed: string[]}}
 */
export function stripPreviewImageReferences(xml) {
  const source = String(xml ?? "");
  if (!/prvimage/i.test(source)) return { xml: source, changed: false, removed: [] };
  const elements = scanElements(source);
  const targets = elements.filter((element) => REFERENCE_LOCALS.has(element.local) && /prvimage/i.test(element.attrs));
  if (!targets.length) return { xml: source, changed: false, removed: [] };
  const ids = new Set(targets.map((element) => attrValue(element.attrs, "id")).filter(Boolean));
  const ranges = targets.map((element) => [element.start, element.end]);
  for (const element of elements) {
    if (element.local !== "itemref") continue;
    const ref = attrValue(element.attrs, "idref");
    if (ref && ids.has(ref)) ranges.push([element.start, element.end]);
  }
  const merged = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  let output = "";
  let cursor = 0;
  for (const [start, end] of merged) {
    output += source.slice(cursor, start);
    cursor = end;
  }
  output += source.slice(cursor);
  return { xml: output, changed: true, removed: targets.map((element) => element.name) };
}

/**
 * 채운 .hwpx 를 묶기 전에 미리보기를 어떻게 다룰지 정한다.
 * @param {{names?: string[], sectionXmls?: string[], limit?: number}} input
 * @returns {{previewText: string, removeEntries: string[]}}
 */
export function planPreviewPatch({ names = [], sectionXmls = [], limit } = {}) {
  const list = Array.isArray(names) ? names.map(String) : [];
  const removeEntries = list.filter((name) => isPreviewImageEntry(name));
  return { previewText: extractPreviewText(sectionXmls, { limit }), removeEntries };
}

/** 목록 파일(패키지 목록·매니페스트)에서 미리보기 그림 참조를 지워야 하는 이름인가 */
export function isPackageListEntry(name) {
  return /^(Contents\/content\.hpf|META-INF\/manifest\.xml|META-INF\/container\.xml)$/i.test(String(name ?? ""));
}

/**
 * 미리보기 글자를 ZIP 에 넣는다. 빈 글자는 넣지 않는다(빈 파일을 미리보기로 보여 주면 더 나쁘다).
 * @returns {boolean} 넣었는지
 */
export function writePreviewText(output, previewText) {
  const text = String(previewText ?? "");
  if (!output || !text.trim()) return false;
  output.file(PREVIEW_TEXT_ENTRY, text);
  return true;
}
