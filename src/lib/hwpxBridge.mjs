// 한글(.hwpx) 변환 브릿지 — 브라우저 앱은 .hwpx를 직접 만들지 않는다.
// kordoc CLI 명령어를 만들어 주고, 사용자가 로컬 브릿지(HTTP)를 띄워 두면 그쪽으로 Markdown을 보낸다.
// 원칙: 되는 것과 안 되는 것을 섞지 않는다. 브라우저만으로는 변환되지 않는다고 화면에 그대로 적는다.

export const KORDOC_PACKAGE = "kordoc";
export const KORDOC_DOCS_URL = "https://github.com/chrisryugj/kordoc";
export const HWPX_BRIDGE_HINT =
  "이 앱은 브라우저에서만 돌아가므로 .hwpx 파일을 직접 만들지 않습니다. 아래 명령을 내 컴퓨터 터미널에서 실행하거나, 로컬 브릿지를 띄워 두고 그 주소로 변환을 맡기세요.";

/** kordoc generate --preset 에 넣는 공문서 서식. 실제 kordoc CLI가 받는 값만 둔다. */
export const KORDOC_PRESETS = [
  { id: "보고서", label: "보고서", hint: "표지·요약 상자·쪽번호가 붙는 보고서" },
  { id: "계획서", label: "계획서", hint: "추진 배경·추진 계획 중심의 사업계획서" },
  { id: "개조식", label: "개조식", hint: "□·○·- 항목부호와 로마숫자 장헤더" },
  { id: "공문", label: "공문", hint: "기관명·시행일·수신처가 있는 공문" }
];

/** 파일 이름에서 셸·경로에 문제가 되는 글자를 지운다. 확장자는 붙이지 않는다. */
export function sanitizeBaseName(value, fallback = "planning-copilot-draft") {
  const cleaned = String(value ?? "")
    .replace(/[\\/:*?"<>|`$]/g, " ")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function buildHwpxFileName(value, fallback = "planning-copilot-draft") {
  return `${sanitizeBaseName(value, fallback)}.hwpx`;
}

function quoteShell(value) {
  return `"${String(value).replace(/"/g, "'")}"`;
}

/**
 * 사용자가 자기 터미널에 붙여넣을 명령. 파일 이름은 .md, 결과는 .hwpx.
 * @returns {string} 예: npx kordoc generate "사업계획서 초안.md" -o "사업계획서 초안.hwpx" --preset 보고서
 */
export function buildKordocCommand({ fileName, preset = "보고서", org = "" } = {}) {
  const base = sanitizeBaseName(String(fileName ?? "").replace(/\.(md|markdown)$/i, ""));
  const command = ["npx", "kordoc", "generate", quoteShell(`${base}.md`), "-o", quoteShell(`${base}.hwpx`)];
  const presetId = KORDOC_PRESETS.some((item) => item.id === preset) ? preset : "보고서";
  if (presetId) command.push("--preset", presetId);
  const orgName = String(org ?? "").trim();
  if (orgName) command.push("--org", quoteShell(orgName));
  return command.join(" ");
}

/** 로컬 브릿지에 보낼 본문. 브릿지 구현이 이 모양만 맞추면 된다. */
export function buildBridgePayload({ markdown, fileName, preset = "보고서", org = "" } = {}) {
  const text = String(markdown ?? "");
  if (!text.trim()) return null;
  return {
    format: "hwpx",
    engine: KORDOC_PACKAGE,
    preset: KORDOC_PRESETS.some((item) => item.id === preset) ? preset : "보고서",
    org: String(org ?? "").trim(),
    fileName: sanitizeBaseName(String(fileName ?? "").replace(/\.(md|markdown|hwpx)$/i, "")),
    markdown: text
  };
}

/**
 * 브릿지 주소를 점검한다. http/https만 받고, 주소가 비면 "브릿지 없음"으로 본다.
 * @returns {{ok: boolean, url: string, error: string}}
 */
export function normalizeBridgeEndpoint(value) {
  const text = String(value ?? "").trim();
  if (!text) return { ok: false, url: "", error: "브릿지 주소가 비어 있습니다." };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, url: "", error: "주소 형식이 올바르지 않습니다. http://127.0.0.1:8787/hwpx 처럼 적어 주세요." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url: "", error: "http 또는 https 주소만 연결할 수 있습니다." };
  }
  parsed.hash = "";
  const url = parsed.toString().replace(/\/$/, "");
  return { ok: true, url, error: "" };
}

/** 브릿지 응답(JSON)을 화면 문구로 바꾼다. */
export function interpretBridgeResponse(status, body) {
  const ok = status >= 200 && status < 300 && body && body.ok !== false;
  if (!ok) {
    const reason = body && (body.error || body.message);
    return {
      ok: false,
      message: reason
        ? `브릿지가 변환하지 못했습니다: ${reason}`
        : `브릿지 응답을 받지 못했습니다(HTTP ${status}). 브릿지가 떠 있는지, 주소가 맞는지 확인해 주세요.`
    };
  }
  const name = body && body.fileName ? String(body.fileName) : "";
  return {
    ok: true,
    message: name ? `${name} 파일을 만들었습니다.` : "브릿지가 변환을 마쳤습니다.",
    fileName: name,
    base64: body && typeof body.base64 === "string" ? body.base64 : "",
    downloadUrl: body && typeof body.downloadUrl === "string" ? body.downloadUrl : "",
    warnings: body && Array.isArray(body.warnings) ? body.warnings.map(String) : []
  };
}

/** 브릿지가 없을 때 보여 줄 준비물 안내(브릿지 계약과 같은 순서). */
export const BRIDGE_CONTRACT = [
  "POST 로 JSON을 받습니다: { format: \"hwpx\", fileName, preset, org, markdown }",
  "성공하면 { ok: true, fileName, base64 } 또는 { ok: true, downloadUrl } 을 돌려줍니다.",
  "실패하면 4xx·5xx와 { ok: false, error } 로 이유를 알려 줍니다.",
  "브릿지 안에서는 npx kordoc generate 같은 명령을 실행하고 결과 파일만 돌려주면 됩니다."
];
