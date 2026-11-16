import { useRef, useState } from "react";
import { BUDGET_IMPORT_SAMPLE, mergeBudgetLines, parseBudgetTable, type BudgetImportMode, type BudgetParseResult } from "../lib/budgetImport.mjs";
import { formatWon } from "../lib/grantWorkflow.mjs";
import type { GrantBudgetLine } from "../types";

const MODES: Array<{ id: BudgetImportMode; label: string; hint: string }> = [
  { id: "append", label: "아래에 덧붙이기", hint: "지금 표는 그대로 두고 읽은 행을 뒤에 붙입니다." },
  { id: "merge", label: "같은 비목은 채우기", hint: "비목·세목이 같은 행은 값만 바꾸고 나머지는 덧붙입니다." },
  { id: "replace", label: "표를 비우고 넣기", hint: "지금 편성표를 지우고 읽은 행으로 바꿉니다." }
];

export function BudgetImportPanel({
  lines,
  onChange,
  notify
}: {
  lines: GrantBudgetLine[];
  onChange: (lines: GrantBudgetLine[]) => void;
  notify: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<BudgetParseResult | null>(null);
  const [mode, setMode] = useState<BudgetImportMode>("append");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const readText = (value: string) => {
    const parsed = parseBudgetTable(value);
    setResult(parsed.rows.length ? parsed : null);
    setError(parsed.rows.length ? "" : parsed.warnings[parsed.warnings.length - 1] || "표를 읽지 못했습니다.");
    if (!parsed.rows.length) notify("붙여넣은 내용에서 예산 행을 찾지 못했습니다.");
  };

  const apply = () => {
    if (!result) return;
    onChange(mergeBudgetLines(lines, result.rows, mode));
    notify(`예산표에 ${result.rows.length}개 비목을 넣었습니다. 금액 ${formatWon(result.totalAmount)}.`);
    setResult(null);
    setText("");
    setError("");
  };

  return (
    <section className={`import-block ${open ? "is-open" : ""}`} aria-label="시트·CSV로 예산 채우기">
      <button className="import-toggle" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="import-toggle-main">
          <strong>구글 시트·CSV 붙여넣기로 채우기</strong>
          <span>시트에서 비목·세목·단가·수량 줄을 그대로 복사해 붙여넣으면 표에 들어갑니다. 두 번 입력하지 않아도 됩니다.</span>
        </span>
        <span className="import-toggle-state">{open ? "접기" : "열기"}</span>
      </button>

      {open && (
        <div className="import-body">
          <label className="field wide">
            <span>붙여넣기 (탭·쉼표·Markdown 표 모두 인식)</span>
            <textarea
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={"비목\t세목\t단가\t수량\t산출근거\t비고\n인건비\t외래강사비\t250,000\t8\t250,000원 × 8회\t두레동아리 4회 × 2명"}
              spellCheck={false}
            />
          </label>
          <div className="import-actions">
            <button className="primary-button" type="button" onClick={() => readText(text)} disabled={!text.trim()}>
              표 읽기
            </button>
            <label className="secondary-button file-button">
              CSV·TXT 파일 열기
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                hidden
                onChange={async (event) => {
                  const input = event.currentTarget;
                  const file = input.files?.[0];
                  if (!file) return;
                  const content = await file.text();
                  input.value = "";
                  setText(content);
                  readText(content);
                }}
              />
            </label>
            <button className="secondary-button" type="button" onClick={() => { setText(BUDGET_IMPORT_SAMPLE); setError(""); setResult(null); }}>
              예시 표 넣어보기
            </button>
          </div>

          {error && (
            <p className="field-msg" role="alert">
              <span aria-hidden="true">!</span>
              {error}
            </p>
          )}

          {result && (
            <>
              <div className="import-summary">
                <strong>{result.lineCount}개 행</strong>
                <span>합계 {formatWon(result.totalAmount)}</span>
                <span>{result.hadHeader ? "머리글에서 열 이름을 찾았습니다" : "머리글 없이 순서대로 읽었습니다"}</span>
              </div>

              <div className="table-wrap">
                <table className="import-table">
                  <thead>
                    <tr><th>비목</th><th>세목</th><th>단가</th><th>수량</th><th>금액</th><th>산출근거</th></tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 12).map((row, index) => (
                      <tr key={`preview-${index}`}>
                        <td>{row.category || "-"}</td>
                        <td>{row.item || "-"}</td>
                        <td className="num">{row.unitCost ? formatWon(Number(row.unitCost)) : "-"}</td>
                        <td>{row.quantity || "1"}</td>
                        <td className="num">{formatWon(Number(row.unitCost || 0) * Number(String(row.quantity || "1").replace(/[^\d.]/g, "") || 1))}</td>
                        <td>{row.basis || row.note || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > 12 && <p className="block-note">… {result.rows.length - 12}개 행 더 있습니다. 넣을 때는 모두 들어갑니다.</p>}

              {result.warnings.length > 0 && (
                <ul className="import-warnings">
                  {result.warnings.slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}

              <div className="import-apply">
                <div className="seg" role="radiogroup" aria-label="넣는 방법">
                  {MODES.map((item) => (
                    <button
                      key={item.id}
                      className={`seg-item ${mode === item.id ? "is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={mode === item.id}
                      title={item.hint}
                      onClick={() => setMode(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <p className="block-note">{MODES.find((item) => item.id === mode)?.hint}</p>
                <button className="primary-button wide" type="button" onClick={apply}>예산표에 넣기</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
