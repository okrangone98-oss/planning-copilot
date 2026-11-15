import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKordocArgs, handleBridgeRequest, parseBridgeRequest } from "../../kordoc-bridge.mjs";
import { KORDOC_SPEC_VERSION } from "../../../src/lib/kordocFormSpec.mjs";

const TEMPLATE_BASE64 = Buffer.from("fake-hwpx-bytes").toString("base64");

test("브릿지는 engine·mode·양식·값을 확인하고 이유를 돌려준다", () => {
  const fill = parseBridgeRequest({
    engine: "kordoc",
    mode: "fill",
    fileName: "양식.hwpx",
    templateBase64: TEMPLATE_BASE64,
    values: { "사업명": "양양 생활문화" }
  });
  assert.equal(fill.ok, true);
  assert.equal(fill.mode, "fill");
  assert.equal(fill.outputName, "양식-채움.hwpx");
  assert.deepEqual(fill.values, { "사업명": "양양 생활문화" });

  assert.equal(parseBridgeRequest(null).ok, false);
  assert.match(parseBridgeRequest({ engine: "other" }).error, /engine/);
  assert.match(parseBridgeRequest({ mode: "delete" }).error, /mode/);
  assert.match(parseBridgeRequest({ mode: "fill", fileName: "양식.hwpx", values: {} }).error, /templateBase64/);
  assert.match(parseBridgeRequest({ mode: "fill", fileName: "양식.docx", templateBase64: TEMPLATE_BASE64, values: { a: "b" } }).error, /\.hwpx/);
  assert.match(parseBridgeRequest({ mode: "fill", fileName: "양식.hwpx", templateBase64: TEMPLATE_BASE64 }).error, /values/);
  assert.match(parseBridgeRequest({ mode: "patch", fileName: "양식.hwpx", templateBase64: TEMPLATE_BASE64 }).error, /markdown/);
  assert.match(parseBridgeRequest({ mode: "generate", markdown: "  " }).error, /markdown/);

  const patch = parseBridgeRequest({
    mode: "patch",
    fileName: "양식.hwpx",
    templateBase64: TEMPLATE_BASE64,
    markdown: "# 채운 문서"
  });
  assert.equal(patch.ok, true);
  assert.equal(patch.outputName, "양식-반영.hwpx");

  const generated = parseBridgeRequest({ markdown: "# 보고서", fileName: "보고서.hwpx", preset: "보고서" });
  assert.equal(generated.ok, true);
  assert.equal(generated.mode, "generate");
  assert.equal(generated.fileName, "보고서.md");
});

test("kordoc 실행 인자는 모드별로 -o 와 -j 를 정확히 쓴다", () => {
  const paths = { templatePath: "/t/양식.hwpx", markdownPath: "/t/채운문서.md", valuesPath: "/t/채움값.json", outputPath: "/t/양식-채움.hwpx" };
  assert.deepEqual(
    buildKordocArgs({ mode: "fill" }, paths),
    ["-y", `kordoc@${KORDOC_SPEC_VERSION}`, "fill", "/t/양식.hwpx", "-j", "/t/채움값.json", "-o", "/t/양식-채움.hwpx"]
  );
  assert.deepEqual(
    buildKordocArgs({ mode: "patch" }, paths),
    ["-y", `kordoc@${KORDOC_SPEC_VERSION}`, "patch", "/t/양식.hwpx", "/t/채운문서.md", "-o", "/t/양식-채움.hwpx"]
  );
  assert.deepEqual(
    buildKordocArgs({ mode: "generate", preset: "계획서" }, paths),
    ["-y", `kordoc@${KORDOC_SPEC_VERSION}`, "generate", "/t/채운문서.md", "-o", "/t/양식-채움.hwpx", "--preset", "계획서", "--silent"]
  );
});

test("요청 하나를 처리해 채운 파일을 base64로 돌려주고 임시 폴더를 지운다", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kordoc-bridge-test-"));
  const seen = [];
  try {
    const result = await handleBridgeRequest(
      { mode: "fill", fileName: "양식.hwpx", templateBase64: TEMPLATE_BASE64, values: { "사업명": "양양" }, outputName: "결과.hwpx" },
      {
        tmpRoot,
        run: async (args, paths) => {
          seen.push(args);
          // kordoc 이 원본 양식을 받아 결과 파일을 썼다고 가정한다.
          assert.equal(await readFile(paths.templatePath, "utf-8"), "fake-hwpx-bytes");
          assert.match(await readFile(paths.valuesPath, "utf-8"), /"사업명": "양양"/);
          await writeFile(paths.outputPath, "filled-bytes");
          return { ok: true, note: "1개 필드 채움" };
        }
      }
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(Buffer.from(result.body.base64, "base64").toString(), "filled-bytes");
    assert.equal(result.body.fileName, "결과.hwpx");
    assert.equal(seen.length, 1);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("kordoc 이 실패하면 422와 이유를 돌려주고 파일을 남기지 않는다", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "kordoc-bridge-test-"));
  try {
    const result = await handleBridgeRequest(
      { mode: "fill", fileName: "양식.hwpx", templateBase64: TEMPLATE_BASE64, values: { "사업명": "양양" } },
      { tmpRoot, run: async () => ({ ok: false, error: "매칭 실패: 사업명" }) }
    );
    assert.equal(result.status, 422);
    assert.equal(result.body.ok, false);
    assert.match(result.body.error, /매칭 실패/);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }

  const invalid = await handleBridgeRequest({ mode: "fill" });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.ok, false);
});
