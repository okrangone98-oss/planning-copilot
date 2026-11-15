import { useMemo, useState } from "react";
import { downloadTextFile, loadHwpxBridgeEndpoint, safeFileName, saveHwpxBridgeEndpoint } from "../lib/storage";
import { interpretBridgeResponse } from "../lib/hwpxBridge.mjs";
import {
  KORDOC_FILL_CONTRACT,
  KORDOC_FILL_HINT,
  buildKordocFillCommand,
  buildKordocFillPayload,
  buildKordocFillValues,
  buildKordocPatchCommand,
  kordocFillJsonText,
  type FormField
} from "../lib/kordocFormSpec.mjs";

function base64ToBlob(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: "application/vnd.hancom.hwpx" });
}

export function KordocFillPanel({
  fields,
  values,
  fileName,
  fileBase64,
  markdown,
  notify
}: {
  fields: FormField[];
  values: Record<string, string>;
  fileName: string;
  fileBase64: string;
  markdown: string;
  notify: (message: string) => void;
}) {
  const [endpoint, setEndpoint] = useState(() => loadHwpxBridgeEndpoint());
  const [busy, setBusy] = useState<"" | "fill" | "patch">("");
  const [bridgeNote, setBridgeNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);

  const fill = useMemo(() => buildKordocFillValues({ fields, values }), [fields, values]);
  const jsonText = useMemo(() => kordocFillJsonText(fill.values), [fill.values]);
  const baseName = useMemo(() => String(fileName || "양식").replace(/\.(hwpx|hwp)$/i, ""), [fileName]);
  const command = useMemo(() => buildKordocFillCommand({ templateFile: fileName, valuesFile: `${baseName}-채움값.json` }), [fileName, baseName]);
  const editedFile = useMemo(() => `${baseName}-채운문서.md`, [baseName]);
  const patchCommand = useMemo(() => buildKordocPatchCommand({ templateFile: fileName, editedFile }), [fileName, editedFile]);
  const count = fill.entries.length;
  const uniqueKeys = Object.keys(fill.values).length;
  const hasFile = Boolean(fileBase64) && /\.(hwpx|hwp)$/i.test(fileName || "");
  const canPatch = Boolean(markdown.trim()) && hasFile;

  const copyJson = () => {
    if (!count) {
      notify("아직 채울 값이 없습니다. 자유 텍스트로 칸을 채우거나 내 사업 정보를 입력해 주세요.");
      return;
    }
    navigator.clipboard.writeText(jsonText).then(
      () => notify("kordoc 채움값 JSON을 복사했습니다. 값 파일로 저장해 kordoc fill -j 에 넘기세요."),
      () => notify("복사하지 못했습니다. 아래 JSON을 직접 선택해 복사해 주세요.")
    );
  };

  const copyCommand = (text: string, label: string) => {
    if (!text) {
      notify(`${label} 명령을 만들 수 없습니다. 양식 파일(.hwpx)을 올려 주세요.`);
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => notify(`${label} 명령을 복사했습니다. 터미널에 붙여넣으세요.`),
      () => notify("복사하지 못했습니다. 명령을 직접 선택해 복사해 주세요.")
    );
  };

  const downloadJson = () => {
    if (!count) return;
    downloadTextFile(jsonText, safeFileName(`${baseName}-채움값.json`, "채움값.json"), "application/json;charset=utf-8");
    notify("채움값 JSON을 내려받았습니다. 양식 파일 옆에 두고 kordoc fill -j 로 넘기세요.");
  };

  const sendThroughBridge = async (mode: "fill" | "patch") => {
    const target = endpoint.trim();
    if (!target) {
      setBridgeNote({ tone: "error", text: "브릿지 주소를 먼저 넣어 주세요. 예: http://127.0.0.1:8787/kordoc" });
      return;
    }
    const payload = buildKordocFillPayload({
      fileName,
      fileBase64,
      values: fill.values,
      mode,
      markdown,
      outputName: `${baseName}${mode === "patch" ? "-반영" : "-채움"}.hwpx`
    });
    if (!payload) {
      setBridgeNote({
        tone: "error",
        text: mode === "patch"
          ? "patch 로 보낼 채운 문서(.md)가 없습니다. 먼저 ‘이 양식에 맞춰 채우기’로 결과를 만들거나 .md를 내려받아 주세요."
          : "브릿지로 채우려면 양식 파일(.hwpx)을 올렸거나 연습 양식을 불러온 상태여야 합니다."
      });
      return;
    }
    setBusy(mode);
    setBridgeNote({ tone: "info", text: "브릿지에 채우기를 요청했습니다. 잠시 기다려 주세요." });
    try {
      const response = await fetch(target, {
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
        link.download = result.fileName || `${baseName}-채움.hwpx`;
        link.click();
        URL.revokeObjectURL(url);
        setBridgeNote({ tone: "ok", text: `${result.message} 파일을 내려받았습니다.` });
        notify(mode === "patch" ? "채운 문서를 원본 서식에 반영해 .hwpx로 받았습니다." : "값을 채운 .hwpx를 받았습니다.");
        return;
      }
      setBridgeNote({ tone: "info", text: result.message });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setBridgeNote({
        tone: "error",
        text: `브릿지에 연결하지 못했습니다: ${reason}. 아래 명령을 내 컴퓨터에서 실행해 주세요.`
      });
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="hwpx-block kordoc-fill" aria-label="kordoc 채우기 데이터">
      <div className="hwpx-head">
        <div>
          <h3>5 · kordoc 채우기 데이터로 양식에 넣기</h3>
          <p>{KORDOC_FILL_HINT}</p>
        </div>
        <span className="badge is-info">로컬 실행</span>
      </div>

      <div className="kordoc-fill-stats">
        <span className="template-badge is-ready">채울 칸 {count}개</span>
        <span>kordoc fill 키 {uniqueKeys}개</span>
        {fill.unmapped.length > 0 && <span className="kordoc-fill-muted">비어 있는 칸 {fill.unmapped.length}개</span>}
      </div>

      {fill.warnings.length > 0 && (
        <ul className="template-warnings">
          {fill.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {count > 0 ? (
        <div className="table-wrap">
          <table className="template-table kordoc-fill-table">
            <thead>
              <tr><th>칸</th><th>넣을 값</th><th>들어갈 자리</th></tr>
            </thead>
            <tbody>
              {fill.entries.slice(0, 40).map((entry, index) => (
                <tr key={`${entry.key}-${index}`}>
                  <td data-label="칸">{entry.label}</td>
                  <td data-label="넣을 값">{Array.isArray(entry.value) ? entry.value.join(" / ") : entry.value}</td>
                  <td data-label="들어갈 자리">{entry.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="block-note">
          아직 채울 값이 없습니다. 위에서 자유 텍스트로 칸을 채우면 여기에 kordoc 채우기 데이터가 만들어집니다.
        </p>
      )}

      <div className="draft-actions kordoc-fill-actions">
        <button className="secondary-button" type="button" onClick={copyJson} disabled={!count}>채움값 JSON 복사</button>
        <button className="secondary-button" type="button" onClick={downloadJson} disabled={!count}>채움값.json 내려받기</button>
        <button className="secondary-button" type="button" onClick={() => copyCommand(command, "kordoc fill")} disabled={!command}>fill 명령 복사</button>
        <button className="secondary-button" type="button" onClick={() => copyCommand(patchCommand, "kordoc patch")} disabled={!patchCommand}>patch 명령 복사</button>
      </div>

      <div className="hwpx-command">
        <code>{command || "npx -y kordoc fill 양식.hwpx -j 채움값.json -o 양식-채움.hwpx"}</code>
        <button className="secondary-button small" type="button" onClick={() => copyCommand(command, "kordoc fill")} disabled={!command}>복사</button>
      </div>
      <p className="block-note">
        fill 은 원본 양식의 글꼴·표 서식을 그대로 두고 빈 칸만 채웁니다. patch 는 지금 만든 채운 문서(.md)를 원본에 반영합니다
        {markdown.trim() ? ` (지금 결과: ${editedFile})` : " — 먼저 ‘이 양식에 맞춰 채우기’로 결과를 만들어 주세요"}.
      </p>

      <details className="hwpx-bridge">
        <summary>내 컴퓨터 브릿지로 바로 채우기</summary>
        <div className="hwpx-bridge-body">
          <p className="block-note">
            kordoc을 돌리는 작은 서버(브릿지)를 띄워 두었다면 주소만 넣고 .hwpx를 바로 받을 수 있습니다.
            양식 파일은 브릿지(내 컴퓨터)로만 전송되고, 이 앱 서버나 외부로는 나가지 않습니다.
          </p>
          <label className="field wide">
            <span>브릿지 주소</span>
            <input
              value={endpoint}
              placeholder="http://127.0.0.1:8787/kordoc"
              onChange={(event) => {
                setEndpoint(event.target.value);
                saveHwpxBridgeEndpoint(event.target.value);
              }}
            />
          </label>
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={() => { void sendThroughBridge("fill"); }} disabled={busy !== "" || !count || !hasFile}>
              {busy === "fill" ? "채우는 중" : "브릿지로 채우기"}
            </button>
            <button className="secondary-button" type="button" onClick={() => { void sendThroughBridge("patch"); }} disabled={busy !== "" || !canPatch}>
              {busy === "patch" ? "반영 중" : "브릿지로 patch"}
            </button>
          </div>
          {!hasFile && <p className="block-note">붙여넣은 양식은 파일이 없어 fill로 채울 수 없습니다. 양식을 .hwpx로 올리거나 연습 양식을 불러와 주세요.</p>}
          {bridgeNote && (
            <p className={`hwpx-note is-${bridgeNote.tone}`} role={bridgeNote.tone === "error" ? "alert" : "status"}>{bridgeNote.text}</p>
          )}
          <details className="setup-details">
            <summary>브릿지가 받는 요청 형식</summary>
            <ul id="kordoc-fill-contract" className="hwpx-contract">
              {KORDOC_FILL_CONTRACT.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="block-note">이 저장소의 <code>scripts/kordoc-bridge.mjs</code> 를 실행하면 위 형식을 그대로 받습니다: <code>node scripts/kordoc-bridge.mjs</code></p>
          </details>
        </div>
      </details>

      <details className="setup-details kordoc-fill-json">
        <summary>kordoc으로 넘길 채움값 JSON 보기</summary>
        <textarea className="draft-output" rows={12} readOnly value={jsonText} aria-label="kordoc 채움값 JSON" />
      </details>

      <p className="block-note">
        채운 .hwpx에는 이름·연락처·예산 같은 정보가 들어갑니다. 파일은 이 브라우저에 저장되지 않으니 받은 뒤 직접 보관하세요.
      </p>
    </section>
  );
}
