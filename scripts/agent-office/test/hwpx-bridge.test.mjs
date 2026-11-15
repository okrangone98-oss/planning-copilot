import test from "node:test";
import assert from "node:assert/strict";
import {
  BRIDGE_CONTRACT,
  KORDOC_PRESETS,
  buildBridgePayload,
  buildHwpxFileName,
  buildKordocCommand,
  interpretBridgeResponse,
  normalizeBridgeEndpoint,
  sanitizeBaseName
} from "../../../src/lib/hwpxBridge.mjs";

test("kordoc 명령은 파일 이름을 따옴표로 감싸고 프리셋을 붙인다", () => {
  assert.equal(
    buildKordocCommand({ fileName: "사업계획서 초안", preset: "보고서" }),
    'npx kordoc generate "사업계획서 초안.md" -o "사업계획서 초안.hwpx" --preset 보고서'
  );
});

test("이미 .md가 붙은 이름은 한 번만 붙인다", () => {
  assert.equal(
    buildKordocCommand({ fileName: "결과보고.md", preset: "계획서", org: "양양군농촌활성화지원센터" }),
    'npx kordoc generate "결과보고.md" -o "결과보고.hwpx" --preset 계획서 --org "양양군농촌활성화지원센터"'
  );
});

test("모르는 프리셋은 기본 보고서로 되돌린다", () => {
  assert.match(buildKordocCommand({ fileName: "x", preset: "없는서식" }), /--preset 보고서$/);
  assert.ok(KORDOC_PRESETS.every((preset) => preset.id && preset.label));
});

test("셸·경로에 문제가 되는 글자는 파일 이름에서 지운다", () => {
  assert.equal(sanitizeBaseName('a/b:c*?"<>|`$d'), "a b c d");
  assert.equal(sanitizeBaseName("   "), "planning-copilot-draft");
  assert.equal(buildHwpxFileName("2026 사업계획서"), "2026 사업계획서.hwpx");
});

test("브릿지 본문은 Markdown이 비면 만들지 않는다", () => {
  assert.equal(buildBridgePayload({ markdown: "   ", fileName: "x" }), null);
  const payload = buildBridgePayload({ markdown: "# 제목\n본문", fileName: "사업계획서.md", preset: "개조식", org: "양양군" });
  assert.equal(payload.format, "hwpx");
  assert.equal(payload.fileName, "사업계획서");
  assert.equal(payload.preset, "개조식");
  assert.equal(payload.org, "양양군");
  assert.equal(payload.markdown, "# 제목\n본문");
});

test("브릿지 주소는 http·https만 받고 끝 슬래시를 정리한다", () => {
  assert.equal(normalizeBridgeEndpoint("http://127.0.0.1:8787/hwpx/").url, "http://127.0.0.1:8787/hwpx");
  assert.equal(normalizeBridgeEndpoint(" https://bridge.local/api ").ok, true);
  assert.equal(normalizeBridgeEndpoint("").ok, false);
  assert.match(normalizeBridgeEndpoint("ftp://x").error, /http/);
  assert.match(normalizeBridgeEndpoint("127.0.0.1:8787").error, /형식/);
});

test("브릿지 응답은 성공·실패를 구분해 문장으로 바꾼다", () => {
  const done = interpretBridgeResponse(200, { ok: true, fileName: "사업계획서.hwpx", base64: "AAA" });
  assert.equal(done.ok, true);
  assert.match(done.message, /사업계획서\.hwpx/);
  assert.equal(done.base64, "AAA");

  const failed = interpretBridgeResponse(500, { ok: false, error: "kordoc 없음" });
  assert.equal(failed.ok, false);
  assert.match(failed.message, /kordoc 없음/);

  assert.equal(interpretBridgeResponse(502, null).ok, false);
  assert.match(interpretBridgeResponse(502, null).message, /HTTP 502/);
});

test("브릿지 계약 안내는 요청·응답 모양을 모두 적는다", () => {
  assert.ok(BRIDGE_CONTRACT.some((line) => line.includes("POST")));
  assert.ok(BRIDGE_CONTRACT.some((line) => line.includes("base64")));
});
