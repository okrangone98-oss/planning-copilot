#!/usr/bin/env node
// kordoc 로컬 브릿지 — 브라우저 앱이 만든 채우기 데이터로 실제 .hwpx 를 채워 돌려준다.
//
//   node scripts/kordoc-bridge.mjs            # http://127.0.0.1:8787/kordoc
//   PORT=8790 node scripts/kordoc-bridge.mjs  # 포트 바꾸기
//
// 받는 요청(JSON, POST):
//   { engine: "kordoc", mode: "fill",   fileName, templateBase64, values: { "사업명": "…" }, outputName }
//   { engine: "kordoc", mode: "patch",  fileName, templateBase64, markdown: "…", outputName }
//   { engine: "kordoc", preset: "보고서", markdown: "…", fileName }        ← 기존 .hwpx 변환(생성) 요청
// 돌려주는 응답(JSON):
//   { ok: true, fileName, base64 }  또는  { ok: false, error }
//
// 원칙
// - 127.0.0.1 에만 열린다. 같은 네트워크의 다른 기기에서 접근할 수 없다.
// - 파일은 임시 폴더에서만 쓰고 응답 뒤 지운다. 브릿지는 아무것도 보관하지 않는다.
// - 셸을 거치지 않고 execFile 로 kordoc 을 실행한다(값이 명령줄로 새지 않게 -j 파일 사용).
// - 개인정보가 든 양식을 다루므로 로그에 값·문서 내용을 남기지 않는다.

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { KORDOC_SPEC_VERSION, safeShellName } from "../src/lib/kordocFormSpec.mjs";

const MAX_BODY_BYTES = 40 * 1024 * 1024;
const MAX_BASE64 = 30 * 1024 * 1024;
const KORDOC_TIMEOUT_MS = 180 * 1000;
const DEFAULT_PORT = 8787;

/** 요청 본문을 검사해 실행 계획으로 바꾼다. 값이 모자라면 이유를 돌려준다(브릿지 계약). */
export function parseBridgeRequest(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "JSON 본문이 필요합니다." };
  const engine = String(body.engine ?? "kordoc");
  if (engine !== "kordoc") return { ok: false, error: `지원하지 않는 engine 입니다: ${engine}` };

  const mode = String(body.mode ?? (body.values ? "fill" : "generate"));
  if (!["fill", "patch", "generate"].includes(mode)) return { ok: false, error: `지원하지 않는 mode 입니다: ${mode}` };

  const fileName = safeShellName(body.fileName || "양식.hwpx", "양식.hwpx");
  const outputName = safeShellName(body.outputName || fileName.replace(/\.(hwpx|hwp)$/i, "") + (mode === "patch" ? "-반영.hwpx" : "-채움.hwpx"), "결과.hwpx");

  if (mode === "generate") {
    const markdown = String(body.markdown ?? "");
    if (!markdown.trim()) return { ok: false, error: "markdown 이 비어 있습니다." };
    const preset = String(body.preset ?? "보고서");
    return { ok: true, mode, fileName: safeShellName(fileName.replace(/\.(hwpx|hwp|md)$/i, "") + ".md", "문서.md"), outputName, markdown, preset };
  }

  const templateBase64 = String(body.templateBase64 ?? "").trim();
  if (!templateBase64) return { ok: false, error: "templateBase64(원본 양식 파일)가 필요합니다." };
  if (templateBase64.length > MAX_BASE64) return { ok: false, error: "양식 파일이 너무 큽니다(30MB 초과)." };
  if (!/\.(hwpx|hwp)$/i.test(fileName)) return { ok: false, error: "fill/patch 는 .hwpx·.hwp 양식만 받습니다." };

  if (mode === "patch") {
    const markdown = String(body.markdown ?? "");
    if (!markdown.trim()) return { ok: false, error: "patch 에는 채운 편집본 markdown 이 필요합니다." };
    return { ok: true, mode, fileName, outputName, templateBase64, markdown };
  }

  const values = body.values && typeof body.values === "object" && !Array.isArray(body.values) ? body.values : null;
  if (!values || !Object.keys(values).length) return { ok: false, error: "values(채울 값)가 필요합니다." };
  return { ok: true, mode, fileName, outputName, templateBase64, values };
}

/** kordoc 실행 인자 — 셸을 거치지 않으므로 값은 파일로만 넘긴다. */
export function buildKordocArgs(plan, paths) {
  const pkg = `kordoc@${KORDOC_SPEC_VERSION}`;
  if (plan.mode === "generate") return ["-y", pkg, "generate", paths.markdownPath, "-o", paths.outputPath, "--preset", plan.preset, "--silent"];
  if (plan.mode === "patch") return ["-y", pkg, "patch", paths.templatePath, paths.markdownPath, "-o", paths.outputPath];
  return ["-y", pkg, "fill", paths.templatePath, "-j", paths.valuesPath, "-o", paths.outputPath];
}

/** kordoc 을 실제로 돌린다. 표준출력·오류는 로그로만 쓰고 값은 남기지 않는다. */
export function runKordoc(args, { timeoutMs = KORDOC_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise) => {
    execFile("npx", args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const note = String(stderr || "").trim().split("\n").filter(Boolean).slice(-3).join(" / ");
      if (error) {
        resolvePromise({ ok: false, error: note || error.message });
        return;
      }
      resolvePromise({ ok: true, note: note || String(stdout || "").trim() });
    });
  });
}

/** 요청 하나를 처리한다 — 임시 폴더에 쓰고 kordoc 을 돌린 뒤 결과를 base64 로 돌려준다. */
export async function handleBridgeRequest(body, options = {}) {
  const plan = parseBridgeRequest(body);
  if (!plan.ok) return { status: 400, body: { ok: false, error: plan.error } };

  const dir = await mkdtemp(join(options.tmpRoot || tmpdir(), "kordoc-bridge-"));
  try {
    const paths = {
      templatePath: join(dir, plan.fileName),
      markdownPath: join(dir, plan.mode === "generate" ? plan.fileName : "채운문서.md"),
      valuesPath: join(dir, "채움값.json"),
      outputPath: join(dir, plan.outputName)
    };
    if (plan.templateBase64) await writeFile(paths.templatePath, Buffer.from(plan.templateBase64, "base64"));
    if (plan.markdown) await writeFile(paths.markdownPath, plan.markdown, "utf-8");
    if (plan.values) await writeFile(paths.valuesPath, `${JSON.stringify(plan.values, null, 2)}\n`, "utf-8");

    const result = await (options.run || runKordoc)(buildKordocArgs(plan, paths), paths);
    if (!result.ok) return { status: 422, body: { ok: false, error: result.error || "kordoc 실행에 실패했습니다." } };

    const buffer = await readFile(paths.outputPath);
    return {
      status: 200,
      body: {
        ok: true,
        mode: plan.mode,
        fileName: plan.outputName,
        base64: buffer.toString("base64"),
        warnings: result.note ? [result.note] : []
      }
    };
  } catch (error) {
    return { status: 500, body: { ok: false, error: error instanceof Error ? error.message : String(error) } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function readBody(request) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("요청 본문이 너무 큽니다(40MB 초과)."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolvePromise(Buffer.concat(chunks).toString("utf-8")));
    request.on("error", reject);
  });
}

export function createBridgeServer() {
  return createServer(async (request, response) => {
    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type" });
      response.end();
      return;
    }
    if (request.method === "GET") {
      send(200, { ok: true, service: "kordoc-bridge", kordoc: KORDOC_SPEC_VERSION, hint: "POST JSON 으로 fill/patch 를 요청하세요." });
      return;
    }
    if (request.method !== "POST") {
      send(405, { ok: false, error: "POST 만 받습니다." });
      return;
    }
    try {
      const raw = await readBody(request);
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        send(400, { ok: false, error: "JSON 을 읽지 못했습니다." });
        return;
      }
      // 이 브릿지는 내 컴퓨터에서만 쓰는 도구다. 앱(브라우저)이 다른 포트에서 부르므로 CORS 를 열어 둔다.
      response.setHeader("Access-Control-Allow-Origin", "*");
      const result = await handleBridgeRequest(body);
      send(result.status, result.body);
    } catch (error) {
      send(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || "127.0.0.1";
  const server = createBridgeServer();
  server.listen(port, host, () => {
    console.log(`[kordoc-bridge] http://${host}:${port}/kordoc 에서 기다립니다 (kordoc ${KORDOC_SPEC_VERSION}).`);
    console.log("[kordoc-bridge] 앱의 ‘kordoc 채우기 데이터’ 칸에 이 주소를 넣으면 브릿지로 바로 채웁니다.");
    console.log("[kordoc-bridge] 끝내려면 Ctrl+C. 이 브릿지는 어떤 파일도 보관하지 않습니다.");
  });
}
