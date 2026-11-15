import { useMemo, useState } from "react";
import { downloadTextFile, loadHwpxBridgeEndpoint, safeFileName, saveHwpxBridgeEndpoint } from "../lib/storage";
import {
  BRIDGE_CONTRACT,
  HWPX_BRIDGE_HINT,
  KORDOC_DOCS_URL,
  KORDOC_PRESETS,
  buildBridgePayload,
  buildHwpxFileName,
  buildKordocCommand,
  interpretBridgeResponse,
  normalizeBridgeEndpoint
} from "../lib/hwpxBridge.mjs";

function base64ToBlob(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "application/vnd.hancom.hwpx" });
}

export function HwpxExportPanel({
  markdown,
  fileName,
  notify
}: {
  markdown: string;
  fileName: string;
  notify: (message: string) => void;
}) {
  const [preset, setPreset] = useState("보고서");
  const [org, setOrg] = useState("");
  const [endpoint, setEndpoint] = useState(() => loadHwpxBridgeEndpoint());
  const [bridgeNote, setBridgeNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const hwpxName = useMemo(() => buildHwpxFileName(fileName), [fileName]);
  const baseName = useMemo(() => String(fileName || "planning-copilot-draft").replace(/\.(md|markdown|hwpx)$/i, ""), [fileName]);
  const command = useMemo(() => buildKordocCommand({ fileName: baseName, preset, org }), [baseName, preset, org]);
  const ready = Boolean(markdown.trim());

  const copyCommand = () => {
    navigator.clipboard.writeText(command).then(
      () => notify("kordoc 명령을 복사했습니다. 터미널에 붙여넣으세요."),
      () => notify("복사하지 못했습니다. 명령을 직접 선택해 복사해 주세요.")
    );
  };

  const downloadMd = () => {
    if (!ready) return;
    downloadTextFile(markdown, safeFileName(`${baseName}.md`, "planning-copilot-draft.md"), "text/markdown;charset=utf-8");
    notify(".md 파일을 내려받았습니다. 같은 이름으로 kordoc 명령을 실행하면 .hwpx가 됩니다.");
  };

  const convertThroughBridge = async () => {
    const payload = buildBridgePayload({ markdown, fileName: baseName, preset, org });
    if (!payload) {
      setBridgeNote({ tone: "error", text: "변환할 내용이 없습니다. 먼저 결과를 만들어 주세요." });
      return;
    }
    const target = normalizeBridgeEndpoint(endpoint);
    if (!target.ok) {
      setBridgeNote({ tone: "error", text: target.error });
      return;
    }
    setBusy(true);
    setBridgeNote({ tone: "info", text: "브릿지에 변환을 요청했습니다. 잠시 기다려 주세요." });
    try {
      const response = await fetch(target.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      let body: Record<string, unknown> | null = null;
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        body = null;
      }
      const result = interpretBridgeResponse(response.status, body);
      if (!result.ok) {
        setBridgeNote({ tone: "error", text: result.message });
        return;
      }
      if (result.base64) {
        const url = URL.createObjectURL(base64ToBlob(result.base64));
        const link = document.createElement("a");
        link.href = url;
        link.download = result.fileName || hwpxName;
        link.click();
        URL.revokeObjectURL(url);
        setBridgeNote({ tone: "ok", text: `${result.message} 파일을 내려받았습니다.` });
        notify("한글(.hwpx) 파일을 내려받았습니다.");
        return;
      }
      if (result.downloadUrl) {
        window.open(result.downloadUrl, "_blank", "noreferrer");
        setBridgeNote({ tone: "ok", text: result.message });
        return;
      }
      setBridgeNote({ tone: "info", text: result.message });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setBridgeNote({
        tone: "error",
        text: `브릿지에 연결하지 못했습니다: ${reason}. 브라우저만으로는 .hwpx를 만들 수 없으니, 아래 명령을 내 컴퓨터에서 실행해 주세요.`
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="hwpx-block" aria-label="한글(.hwpx)로 변환">
      <div className="hwpx-head">
        <div>
          <h3>한글(.hwpx)로 변환하기</h3>
          <p>{HWPX_BRIDGE_HINT}</p>
        </div>
        <span className="badge is-info">브라우저 단독 불가</span>
      </div>

      <ol className="hwpx-steps">
        <li>
          <span className="hwpx-step-no" aria-hidden="true">1</span>
          <div>
            <strong>.md 파일로 내려받기</strong>
            <span>kordoc은 Markdown을 읽어 한글 문서를 만듭니다.</span>
          </div>
          <button className="secondary-button" type="button" onClick={downloadMd} disabled={!ready}>.md 내려받기</button>
        </li>
        <li>
          <span className="hwpx-step-no" aria-hidden="true">2</span>
          <div>
            <strong>터미널에서 변환 명령 실행</strong>
            <span>Node.js 20 이상이면 설치 없이 npx로 실행됩니다.</span>
          </div>
          <button className="secondary-button" type="button" onClick={copyCommand}>명령 복사</button>
        </li>
        <li>
          <span className="hwpx-step-no" aria-hidden="true">3</span>
          <div>
            <strong>한글에서 열어 서식 확인</strong>
            <span>기관 양식이 있으면 kordoc generate --template 로 서식을 맞출 수 있습니다.</span>
          </div>
          <a className="ghost-light-button" href={KORDOC_DOCS_URL} target="_blank" rel="noreferrer">kordoc 안내</a>
        </li>
      </ol>

      <div className="hwpx-options">
        <label className="field">
          <span>공문서 서식</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value)}>
            {KORDOC_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.hint}</option>)}
          </select>
        </label>
        <label className="field">
          <span>기관명 (선택)</span>
          <input value={org} onChange={(event) => setOrg(event.target.value)} placeholder="예: 양양군농촌활성화지원센터" />
        </label>
      </div>

      <div className="hwpx-command">
        <code>{command}</code>
        <button className="secondary-button small" type="button" onClick={copyCommand}>복사</button>
      </div>

      <details className="hwpx-bridge">
        <summary>로컬 브릿지가 있으면 바로 변환</summary>
        <div className="hwpx-bridge-body">
          <p className="block-note">
            내 컴퓨터에서 kordoc을 돌리는 작은 서버(브릿지)를 띄워 두었다면, 주소만 넣고 바로 .hwpx를 받을 수 있습니다.
            브릿지가 없으면 위 1~2단계로 진행하세요.
          </p>
          <label className="field wide">
            <span>브릿지 주소</span>
            <input
              value={endpoint}
              placeholder="http://127.0.0.1:8787/hwpx"
              onChange={(event) => {
                setEndpoint(event.target.value);
                saveHwpxBridgeEndpoint(event.target.value);
              }}
            />
          </label>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={() => { void convertThroughBridge(); }} disabled={busy || !ready}>
              {busy ? "변환 중" : "브릿지로 변환"}
            </button>
          </div>
          {bridgeNote && (
            <p className={`hwpx-note is-${bridgeNote.tone}`} role={bridgeNote.tone === "error" ? "alert" : "status"}>{bridgeNote.text}</p>
          )}
          <ul id="hwpx-contract" className="hwpx-contract">
            {BRIDGE_CONTRACT.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </details>

      <p className="block-note">변환 결과는 이 브라우저에 저장되지 않습니다. 받은 .hwpx 파일은 로컬·Drive에 보관하세요.</p>
    </section>
  );
}
