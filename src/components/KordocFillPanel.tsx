import { useMemo, useState } from "react";
import { downloadTextFile, loadHwpxBridgeEndpoint, safeFileName, saveHwpxBridgeEndpoint } from "../lib/storage";
import { interpretBridgeResponse } from "../lib/hwpxBridge.mjs";
import {
  KORDOC_FILL_CONTRACT,
  buildKordocFillCommand,
  buildKordocFillPayload,
  buildKordocFillValues,
  buildKordocPatchCommand,
  kordocFillJsonText,
  type FormField
} from "../lib/kordocFormSpec.mjs";
import {
  filledFileName,
  patchHwpxBytes,
  summarizeFill,
  type FilledEntry,
  type HwpxPatchResult,
  type SkippedEntry
} from "../lib/browserHwpxFiller.mjs";

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBlob(bytes: Uint8Array) {
  // Blob 은 ArrayBuffer 를 요구한다 — 넘겨받은 뷰와 무관한 사본을 만들어 넘긴다.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/hwp+zip" });
}

function base64ToBlob(base64: string) {
  return bytesToBlob(base64ToBytes(base64));
}

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(bytesToBlob(bytes));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export function KordocFillPanel({
  fields,
  values,
  fileName,
  fileBase64,
  markdown,
  notify,
  onValueChange
}: {
  fields: FormField[];
  values: Record<string, string>;
  fileName: string;
  fileBase64: string;
  markdown: string;
  notify: (message: string) => void;
  /** 3단계 검토 표에서 값을 직접 고칠 때 — 칸 id 로 값을 바꾼다. */
  onValueChange?: (fieldId: string, value: string) => void;
}) {
  const [endpoint, setEndpoint] = useState(() => loadHwpxBridgeEndpoint());
  const [busy, setBusy] = useState<"" | "fill" | "patch" | "browser">("");
  const [bridgeNote, setBridgeNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [browserNote, setBrowserNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [browserResult, setBrowserResult] = useState<HwpxPatchResult | null>(null);

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
  const downloadName = filledFileName(fileName);
  const editable = typeof onValueChange === "function";

  /** 브라우저 안에서 양식 .hwpx를 채워 바로 내려받는다 — 터미널·브릿지 없이. */
  const downloadInBrowser = async () => {
    if (!hasFile) {
      setBrowserNote({ tone: "error", text: "채울 .hwpx 양식 파일이 없습니다. 양식 파일을 올리거나 연습 양식을 불러와 주세요." });
      return;
    }
    if (!count) {
      setBrowserNote({ tone: "error", text: "아직 넣을 값이 없습니다. 2단계에서 자료를 붙여넣거나 위 표에 값을 적어 주세요." });
      return;
    }
    setBusy("browser");
    setBrowserNote({ tone: "info", text: "브라우저에서 양식 서식을 그대로 두고 값을 넣는 중입니다." });
    try {
      const result = await patchHwpxBytes({ bytes: base64ToBytes(fileBase64), values: fill.values });
      setBrowserResult(result);
      if (!result.filled.length) {
        setBrowserNote({
          tone: "error",
          text: "값이 들어갈 칸을 양식 안에서 찾지 못했습니다. 아래 표의 ‘들어갈 자리’를 보고 칸 이름을 양식과 같게 맞춰 주세요."
        });
        return;
      }
      downloadBytes(result.bytes, downloadName);
      const summary = summarizeFill(result);
      setBrowserNote({ tone: "ok", text: `${summary} ${downloadName} 파일을 내려받았습니다.` });
      notify(`${summary} ${downloadName} 파일을 내려받았습니다. 한글에서 열어 서식을 확인하세요.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setBrowserNote({ tone: "error", text: `양식을 채우지 못했습니다: ${reason}` });
    } finally {
      setBusy("");
    }
  };

  const copyJson = () => {
    if (!count) {
      notify("아직 채울 값이 없습니다. 자료를 붙여넣거나 위 표에 값을 적어 주세요.");
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
          ? "patch 로 보낼 채운 문서(.md)가 없습니다. 먼저 고급 설정에서 ‘이 양식에 맞춰 채우기’로 결과를 만들어 주세요."
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
    <>
      <section className="hwpx-block kordoc-fill" aria-label="입력 결과 검토">
        <div className="hwpx-head">
          <div>
            <h3>3 · 입력 결과 검토(수정)</h3>
            <p>
              양식의 어느 칸에 무슨 값이 들어가는지 확인하는 표입니다. 칸이 잘못 잡혔으면 <strong>넣을 값을 직접 고치거나 지워</strong>
              주세요. 고친 값은 저장되어 4단계 다운로드에 그대로 쓰이고, 원본 양식에서 이미 값이 있는 칸은 덮어쓰지 않습니다.
            </p>
          </div>
          <span className="badge is-info">저장됨 · 브라우저 안</span>
        </div>

        <div className="kordoc-fill-stats">
          <span className="template-badge is-ready">넣을 값 {count}개</span>
          <span>kordoc fill 키 {uniqueKeys}개</span>
          {fill.unmapped.length > 0 && <span className="kordoc-fill-muted">비어 있는 칸 {fill.unmapped.length}개</span>}
          {!hasFile && <span className="kordoc-fill-muted">양식 파일(.hwpx)이 없어 다운로드는 안 됩니다</span>}
        </div>

        {fill.warnings.length > 0 && (
          <ul className="template-warnings">
            {fill.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        {count > 0 ? (
          <div className="table-wrap">
            <table className="template-table stacked-table kordoc-fill-table">
              <thead>
                <tr><th>칸</th><th>넣을 값{editable ? " (고칠 수 있음)" : ""}</th><th>들어갈 자리</th></tr>
              </thead>
              <tbody>
                {fill.entries.slice(0, 60).map((entry, index) => (
                  <tr key={`${entry.key}-${entry.fieldId ?? index}-${index}`}>
                    <td data-label="칸">{entry.label}</td>
                    <td data-label="넣을 값">
                      {editable && entry.fieldId ? (
                        <textarea
                          className="kordoc-fill-input"
                          rows={Math.min(4, Math.max(1, String(entry.value ?? "").split("\n").length))}
                          value={values[entry.fieldId] ?? String(entry.value ?? "")}
                          aria-label={`${entry.label} 칸에 넣을 값`}
                          onChange={(event) => onValueChange(entry.fieldId as string, event.target.value)}
                        />
                      ) : (
                        Array.isArray(entry.value) ? entry.value.join(" / ") : entry.value
                      )}
                    </td>
                    <td data-label="들어갈 자리">{entry.where}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fill.entries.length > 60 && <p className="template-empty-note">… {fill.entries.length - 60}개 더 있음</p>}
          </div>
        ) : (
          <p className="block-note">
            아직 넣을 값이 없습니다. 2단계에서 자료를 붙여넣고 <strong>자동으로 칸 나누기</strong>를 누르면 여기에 값이 모입니다.
          </p>
        )}
        {editable && count > 0 && (
          <p className="block-note">값을 모두 지운 칸은 양식에 쓰지 않습니다. 원본에 이미 적힌 칸은 채우지 않고 그대로 둡니다.</p>
        )}
      </section>

      <section className="hwpx-block kordoc-fill" aria-label="hwpx로 내려받기">
        <div className="hwpx-head">
          <div>
            <h3>4 · HWPX 다운로드</h3>
            <p>
              위에서 확인한 값을 원본 양식의 같은 칸에 넣어 <strong>.hwpx 파일로 내려받습니다</strong>. 글꼴·표 테두리·문단 모양은
              원본 그대로이고, 채우지 않은 칸도 원본 글자 그대로 남습니다. 파일은 이 브라우저 안에서만 만들어집니다.
            </p>
          </div>
          <span className="badge is-info">브라우저 안에서 완결</span>
        </div>

        <div className="browser-hwpx-action">
          <div className="browser-hwpx-copy">
            <strong>브라우저에서 바로 .hwpx 내려받기</strong>
            <span>
              {hasFile
                ? `${fileName} · 채울 칸 ${count}개`
                : "먼저 .hwpx 양식 파일을 올리거나 연습 양식을 불러와 주세요."}
            </span>
          </div>
          <button
            className="primary-button browser-hwpx-button"
            type="button"
            onClick={() => { void downloadInBrowser(); }}
            disabled={busy !== "" || !hasFile || !count}
          >
            {busy === "browser" ? "만드는 중" : ".hwpx 바로 내려받기"}
          </button>
        </div>
        {browserNote && (
          <p className={`hwpx-note is-${browserNote.tone}`} role={browserNote.tone === "error" ? "alert" : "status"}>{browserNote.text}</p>
        )}

        {browserResult && (browserResult.filled.length > 0 || browserResult.skipped.length > 0 || browserResult.unmatched.length > 0) && (
          <details className="setup-details browser-hwpx-result" open={browserResult.skipped.length > 0 || browserResult.unmatched.length > 0}>
            <summary>
              채운 칸 {browserResult.filled.length}개
              {browserResult.skipped.length ? ` · 그대로 둔 칸 ${browserResult.skipped.length}개` : ""}
              {browserResult.unmatched.length ? ` · 못 찾은 값 ${browserResult.unmatched.length}개` : ""}
            </summary>
            <ul className="browser-hwpx-list">
              {browserResult.filled.slice(0, 40).map((item: FilledEntry, index: number) => (
                <li key={`${item.key}-${index}`}>
                  <strong>{item.label}</strong>
                  <span>{String(item.value).replace(/\n/g, " / ")}</span>
                  <small>{item.where}</small>
                </li>
              ))}
              {browserResult.skipped.slice(0, 20).map((item: SkippedEntry, index: number) => (
                <li key={`skip-${item.label}-${index}`} className="is-skipped">
                  <strong>{item.label}</strong>
                  <span>{item.reason}</span>
                  <small>{item.where}{item.current ? ` · 지금 값: ${item.current.slice(0, 40)}` : ""}</small>
                </li>
              ))}
              {browserResult.unmatched.map((label: string) => (
                <li key={`unmatched-${label}`} className="is-skipped">
                  <strong>{label}</strong>
                  <span>양식에서 이 이름의 칸을 찾지 못했습니다</span>
                  <small>양식의 칸 이름과 같게 맞추면 들어갑니다</small>
                </li>
              ))}
            </ul>
          </details>
        )}

        <details className="setup-details local-hwpx-options">
          <summary>고급 설정 — kordoc JSON·CLI·로컬 브릿지</summary>
          <p className="block-note">
            내 컴퓨터에서 kordoc을 돌리는 쪽이 편할 때만 쓰세요. 위의 ‘.hwpx 바로 내려받기’와 결과는 같습니다.
            fill 은 원본 양식의 글꼴·표 서식을 그대로 두고 빈 칸만 채웁니다. patch 는 지금 만든 채운 문서(.md)를 원본에 반영합니다
            {markdown.trim() ? ` (지금 결과: ${editedFile})` : " — 먼저 고급 설정의 ‘이 양식에 맞춰 채우기’로 결과를 만들어 주세요"}.
          </p>
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
        </details>

        <p className="block-note">
          채운 .hwpx에는 이름·연락처·예산 같은 정보가 들어갑니다. 파일은 이 브라우저에 저장되지 않으니 받은 뒤 직접 보관하세요.
        </p>
      </section>
    </>
  );
}
