import { useEffect, useMemo, useRef, useState } from "react";
import type { GrantBudgetLine } from "../types";
import { emptyBudgetLine, formatWon, parseAmount } from "../lib/grantWorkflow.mjs";
import {
  BUDGET_SHEET_COLUMNS,
  GRID_SPENT_LABEL,
  applyBlockPaste,
  sheetExportRows,
  sheetRows,
  sheetSummaryLine,
  sheetToTsv,
  sheetTotals,
  type GridSpentUpdate
} from "../lib/budgetSheet.mjs";
import { buildXlsxBytes, rowsToCsvText } from "../lib/xlsxTable.mjs";
import { mergeBudgetLines, parseBudgetTable, type BudgetImportMode, type ParsedBudgetRow } from "../lib/budgetImport.mjs";
import type { ProjectExpense } from "../lib/projectOperations.mjs";
import { downloadTextFile, safeFileName } from "../lib/storage";
import { BudgetImportPanel } from "./BudgetImportPanel";

type EditableKey = "category" | "item" | "unitCost" | "quantity" | "spent" | "basis" | "note";
type CellRef = { row: number; key: EditableKey };

const TEXT_KEYS: EditableKey[] = ["category", "item", "basis", "note"];

function downloadBytes(bytes: Uint8Array, fileName: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** 여러 칸 붙여넣기 — 탭으로 나뉜 표만 칸 단위로 받는다(쉼표 표는 예산 파서에 맡긴다). */
function pasteBlockOf(text: string) {
  const clean = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!/[\t\n]/.test(clean)) return null;
  if (!clean.includes("\t")) return null;
  const lines = clean.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

/**
 * 예산 관리표 — 엑셀·구글 시트처럼 칸을 눌러 바로 고치는 표.
 *
 * - 편성액 = 단가 × 수량, 잔액 = 편성액 − 집행액 은 계산 칸이라 직접 고치지 않는다.
 * - 집행액은 지출 원장에서 가져온다. 원장에 기록이 없는 비목이면 여기서 적을 수 있고,
 *   적은 값은 '예산 관리표에서 입력' 한 건으로 원장에 남는다(결과보고·내보내기가 같은 숫자를 쓴다).
 * - Tab·Enter 로 옆 칸·아래 칸으로 움직이고, 시트에서 복사한 여러 칸을 Ctrl+V 로 그대로 붙일 수 있다.
 */
export function BudgetSheet({
  lines,
  onChange,
  notify,
  expenses,
  onSetSpent,
  fileNamePrefix = "예산관리표",
  hint
}: {
  lines: GrantBudgetLine[];
  onChange: (lines: GrantBudgetLine[]) => void;
  notify: (message: string) => void;
  /** 지출 원장 — 넘기면 집행액·잔액이 원장과 연결된다. */
  expenses?: ProjectExpense[];
  /** 격자에서 고친 집행액을 원장에 반영한다(한 번에 여러 건). */
  onSetSpent?: (updates: GridSpentUpdate[]) => void;
  fileNamePrefix?: string;
  hint?: string;
}) {
  const rows = useMemo(() => sheetRows({ lines, expenses }), [lines, expenses]);
  const totals = useMemo(() => sheetTotals(rows), [rows]);
  const withLedger = Array.isArray(expenses);
  const columns = BUDGET_SHEET_COLUMNS;
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState<CellRef | null>(null);
  const [pending, setPending] = useState<CellRef | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const skipBlur = useRef(false);

  const valueOf = (rowIndex: number, key: EditableKey) => {
    const row = rows[rowIndex];
    if (!row) return "";
    if (key === "spent") return row.spent ? String(row.spent) : "";
    return String((row as unknown as Record<string, unknown>)[key] ?? "");
  };

  const canEdit = (rowIndex: number, key: EditableKey) => {
    if (!lines[rowIndex]) return false;
    if (key === "spent") return Boolean(onSetSpent) && !rows[rowIndex]?.locked;
    return true;
  };

  const startEdit = (rowIndex: number, key: EditableKey) => {
    if (!canEdit(rowIndex, key)) {
      if (key === "spent" && rows[rowIndex]?.locked) {
        notify("이 비목은 지출 원장에 기록이 있어 격자에서 고칠 수 없습니다. 아래 지출 원장에서 고쳐 주세요.");
      }
      return;
    }
    setActive({ row: rowIndex, key });
    setEditing({ row: rowIndex, key });
    setDraft(valueOf(rowIndex, key));
  };

  // 새 행을 만든 뒤 그 행의 첫 칸으로 옮겨 간다 — 표가 늘어난 다음 렌더에서 시작한다.
  useEffect(() => {
    if (!pending) return;
    if (pending.row < lines.length) {
      setEditing(pending);
      setActive(pending);
      setDraft(valueOf(pending.row, pending.key));
      setPending(null);
    }
  }, [pending, lines.length]);

  const commit = (cell: CellRef, raw: string) => {
    const line = lines[cell.row];
    if (!line) return;
    if (cell.key === "spent") {
      const amount = parseAmount(raw);
      if (onSetSpent) onSetSpent([{ lineId: line.id, amount }]);
      return;
    }
    let value = String(raw ?? "");
    if (cell.key === "unitCost") value = parseAmount(value) ? String(parseAmount(value)) : "";
    else value = value.slice(0, 200);
    const before = String((line as unknown as Record<string, unknown>)[cell.key] ?? "");
    if (before === value) return;
    onChange(lines.map((item, index) => (index === cell.row ? { ...item, [cell.key]: value } : item)));
  };

  /** Tab·Enter 가 옮겨 갈 칸. 표 끝을 넘어가면 새 행을 만든다. */
  const neighbor = (cell: CellRef, horizontal: 1 | -1, vertical: boolean): CellRef | "append" | null => {
    const columnIndex = columns.findIndex((column) => column.key === cell.key);
    let nextColumn = columnIndex;
    let nextRow = cell.row;
    if (vertical) nextRow += horizontal;
    else {
      nextColumn += horizontal;
      if (nextColumn >= columns.length) {
        nextColumn = 0;
        nextRow += 1;
      } else if (nextColumn < 0) {
        nextColumn = columns.length - 1;
        nextRow -= 1;
      }
    }
    if (nextRow < 0) return null;
    if (nextRow >= lines.length) return "append";
    return { row: nextRow, key: columns[nextColumn].key as EditableKey };
  };

  const moveTo = (target: CellRef | "append" | null) => {
    setEditing(null);
    if (!target) return;
    if (target === "append") {
      onChange([...lines, emptyBudgetLine(`sheet-${Date.now()}`)]);
      setPending({ row: lines.length, key: "category" });
      setActive({ row: lines.length, key: "category" });
      return;
    }
    setPending(target);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, cell: CellRef) => {
    if (event.key === "Tab") {
      event.preventDefault();
      skipBlur.current = true;
      commit(cell, draft);
      moveTo(neighbor(cell, event.shiftKey ? -1 : 1, false));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlur.current = true;
      commit(cell, draft);
      moveTo(neighbor(cell, event.shiftKey ? -1 : 1, true));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      skipBlur.current = true;
      setEditing(null);
    }
  };

  const applyPaste = (text: string, anchor: CellRef | null) => {
    const block = pasteBlockOf(text);
    if (!block) {
      // 쉼표(CSV) 표 — 머리글·따옴표를 알아보는 기존 파서로 읽어 뒤에 붙인다.
      const parsed = parseBudgetTable(text);
      if (!parsed.rows.length) {
        notify(parsed.warnings[parsed.warnings.length - 1] || "붙여넣은 표에서 예산 행을 찾지 못했습니다.");
        return;
      }
      applyImported(parsed.rows, "append");
      notify(`쉼표로 나뉜 표 ${parsed.rows.length}행을 예산표 뒤에 붙였습니다.`);
      return;
    }
    const startColumn = anchor ? Math.max(0, columns.findIndex((column) => column.key === anchor.key)) : 0;
    const result = applyBlockPaste({
      lines,
      expenses,
      // 행을 지운 뒤 남은 위치에서 붙여도 표 밖으로 넘어가지 않게 한다.
      startRow: anchor ? Math.min(Math.max(0, anchor.row), lines.length) : 0,
      startColumn,
      block
    });
    onChange(result.lines);
    if (result.spentChanges.length && onSetSpent) onSetSpent(result.spentChanges);
    if (!result.cells && !result.spentChanges.length) {
      notify(result.warnings[0] || "붙여넣은 칸을 넣지 못했습니다.");
      return;
    }
    notify(
      `붙여넣은 ${result.cells}칸을 넣었습니다${result.newRows ? ` · 행 ${result.newRows}개 추가` : ""}${
        result.warnings.length ? ` — ${result.warnings.join(" ")}` : ""
      }`
    );
  };

  const onCellPaste = (event: React.ClipboardEvent<HTMLInputElement>, cell: CellRef) => {
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text)) return; // 한 칸 값은 그대로 입력된다.
    event.preventDefault();
    skipBlur.current = true;
    setEditing(null);
    applyPaste(text, cell);
  };

  const onSheetPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (editing) return; // 칸 안 붙여넣기는 칸에서 처리한다.
    const text = event.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text)) return;
    event.preventDefault();
    applyPaste(text, active);
  };

  /** 예산 파서가 읽은 행을 표에 넣는다. 집행액이 함께 오면 원장에도 반영한다. */
  const applyImported = (imported: ParsedBudgetRow[], mode: BudgetImportMode) => {
    const nextLines = mergeBudgetLines(lines, imported, mode);
    onChange(nextLines);
    if (!onSetSpent) return;
    const byKey = new Map<string, string>();
    nextLines.forEach((line) => {
      const key = `${line.category}::${line.item}`;
      if (!byKey.has(key)) byKey.set(key, line.id);
    });
    const lockedIds = new Set(rows.filter((row) => row.locked).map((row) => row.id));
    const updates: GridSpentUpdate[] = [];
    imported.forEach((row) => {
      const spent = parseAmount(row.spent);
      if (!spent) return;
      const id = byKey.get(`${row.category}::${row.item}`);
      if (!id || lockedIds.has(id)) return;
      updates.push({ lineId: id, amount: spent });
    });
    if (updates.length) onSetSpent(updates);
  };

  const removeRow = (rowIndex: number) => {
    const row = rows[rowIndex];
    if (!row) return;
    const label = row.item || row.category || `${rowIndex + 1}행`;
    const note = row.expenseCount
      ? `\n이 비목에 붙은 지출 ${row.expenseCount}건은 지우지 않고 ‘비목 미지정’으로 남습니다.`
      : "";
    if (!window.confirm(`${label} 행을 예산표에서 지울까요?${note}`)) return;
    onChange(lines.filter((_, index) => index !== rowIndex));
    setEditing(null);
    notify(`${label} 행을 지웠습니다.`);
  };

  const addRow = () => {
    onChange([...lines, emptyBudgetLine(`sheet-${Date.now()}`)]);
    setPending({ row: lines.length, key: "category" });
  };

  const exportCsv = () => {
    const table = sheetExportRows({ lines, expenses });
    const name = safeFileName(`${fileNamePrefix}-${new Date().toISOString().slice(0, 10)}`, "예산관리표");
    downloadTextFile(rowsToCsvText(table), `${name}.csv`, "text/csv;charset=utf-8");
    notify("예산표를 CSV로 내려받았습니다. 엑셀에서 바로 열립니다.");
  };

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const bytes = await buildXlsxBytes({ sheetName: "예산관리표", rows: sheetExportRows({ lines, expenses }) });
      const name = safeFileName(`${fileNamePrefix}-${new Date().toISOString().slice(0, 10)}`, "예산관리표");
      downloadBytes(bytes, `${name}.xlsx`);
      notify("예산표를 엑셀 파일(.xlsx)로 내려받았습니다.");
    } catch {
      notify("엑셀 파일을 만들지 못했습니다. CSV로 내려받아 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const copyToSheet = async () => {
    try {
      await navigator.clipboard.writeText(sheetToTsv({ lines, expenses }));
      notify("예산표를 시트에 붙여넣을 수 있게 복사했습니다.");
    } catch {
      notify("복사하지 못했습니다. 브라우저가 클립보드를 막았는지 확인해 주세요.");
    }
  };

  return (
    <div className="budget-sheet" aria-label="예산 관리표">
      <div className="budget-sheet-bar">
        <div className="budget-sheet-bar-main">
          <strong>예산 관리표</strong>
          <span>
            칸을 눌러 바로 고치세요. <kbd>Tab</kbd>·<kbd>Enter</kbd>로 옆·아래 칸으로 옮겨 가고, 시트에서 복사한 표는{" "}
            <kbd>Ctrl</kbd>+<kbd>V</kbd>로 그대로 붙습니다.
          </span>
        </div>
        <div className="budget-sheet-actions">
          <button className="primary-button small" type="button" onClick={addRow}>행 추가</button>
          <button className="secondary-button small" type="button" onClick={() => setImporting((current) => !current)} aria-expanded={importing}>
            엑셀·시트 불러오기
          </button>
          <button className="ghost-light-button small" type="button" onClick={exportCsv}>CSV 내려받기</button>
          <button className="ghost-light-button small" type="button" onClick={() => { void exportXlsx(); }} disabled={busy}>XLSX 내려받기</button>
          <button className="ghost-light-button small" type="button" onClick={() => { void copyToSheet(); }}>시트로 복사</button>
        </div>
      </div>

      {hint && <p className="budget-sheet-hint">{hint}</p>}

      {importing && (
        <div className="budget-sheet-import">
          <BudgetImportPanel
            lines={lines}
            onChange={onChange}
            notify={notify}
            onImportRows={applyImported}
            onClose={() => setImporting(false)}
            defaultOpen
          />
        </div>
      )}

      <div className="budget-sheet-scroll" onPaste={onSheetPaste} tabIndex={0} aria-label="예산 관리표 격자">
        <table className="budget-sheet-table">
          <colgroup>
            <col style={{ width: 38 }} />
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="bs-gutter" scope="col" aria-label="행 번호" />
              {columns.map((column) => (
                <th key={column.key} scope="col" className={`bs-${column.kind} is-${column.align}`}>{column.label}</th>
              ))}
              <th className="bs-actions" scope="col" aria-label="행 관리" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="bs-gutter">1</td>
                <td className="budget-sheet-empty" colSpan={columns.length + 1} onClick={addRow}>
                  아직 적은 비목이 없습니다. <button className="block-link" type="button" onClick={(event) => { event.stopPropagation(); addRow(); }}>첫 행 추가</button>
                  {" "}또는 엑셀 파일·시트 표를 불러오세요.
                </td>
                <td className="bs-actions" />
              </tr>
            )}
            {rows.map((row, rowIndex) => (
              <tr key={row.id || rowIndex} className={row.balance < 0 ? "is-over" : ""}>
                <th className="bs-gutter" scope="row">{rowIndex + 1}</th>
                {columns.map((column) => {
                  const key = column.key as EditableKey;
                  const isEditing = editing?.row === rowIndex && editing?.key === column.key;
                  const editable = column.kind !== "calc" && canEdit(rowIndex, key);
                  const cellClass = `bs-cell bs-${column.kind} is-${column.align}${editable ? " is-editable" : ""}${row.balance < 0 && column.key === "balance" ? " is-negative" : ""}`;
                  if (isEditing) {
                    return (
                      <td key={column.key} className={`${cellClass} is-editing`}>
                        <input
                          className="bs-input"
                          autoFocus
                          inputMode={column.kind === "money" || column.kind === "spent" || column.kind === "quantity" ? "numeric" : "text"}
                          value={draft}
                          aria-label={`${rowIndex + 1}행 ${column.label}`}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => onKeyDown(event, { row: rowIndex, key })}
                          onPaste={(event) => onCellPaste(event, { row: rowIndex, key })}
                          onBlur={() => {
                            if (skipBlur.current) {
                              skipBlur.current = false;
                              return;
                            }
                            commit({ row: rowIndex, key }, draft);
                            setEditing(null);
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={column.key}
                      className={cellClass}
                      onClick={() => {
                        if (column.kind === "calc") {
                          setActive({ row: rowIndex, key });
                          return;
                        }
                        startEdit(rowIndex, key);
                      }}
                    >
                      {column.key === "amount" && (row.amount ? formatWon(row.amount) : "")}
                      {column.key === "balance" && (row.amount || row.spent ? formatWon(row.balance) : "")}
                      {column.key === "spent" && (
                        withLedger ? (
                          <span className="bs-spent">
                            {row.spent ? formatWon(row.spent) : ""}
                            {row.locked && <span className="bs-tag" title={`지출 원장 ${row.expenseCount}건에서 가져옴`}>원장</span>}
                            {!row.locked && row.spent > 0 && <span className="bs-tag is-grid" title={GRID_SPENT_LABEL}>입력</span>}
                            {row.plannedOnly > 0 && <span className="bs-tag is-planned" title="지출 예정은 잔액에서 빼지 않습니다">{formatWon(row.plannedOnly)} 예정</span>}
                          </span>
                        ) : <span className="bs-muted">—</span>
                      )}
                      {column.key === "unitCost" && (parseAmount(row.unitCost) ? formatWon(parseAmount(row.unitCost)) : "")}
                      {TEXT_KEYS.includes(key) && <span className="bs-text">{String((row as unknown as Record<string, unknown>)[column.key] ?? "")}</span>}
                      {column.key === "quantity" && <span className="bs-text">{row.quantity}</span>}
                    </td>
                  );
                })}
                <td className="bs-actions">
                  <button
                    className="bs-row-remove"
                    type="button"
                    aria-label={`${rowIndex + 1}행 ${row.item || row.category || "항목"} 지우기`}
                    onClick={() => removeRow(rowIndex)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="bs-gutter" scope="row">합</th>
              <td className="bs-total-label" colSpan={2}>합계 · {totals.lineCount}개 비목</td>
              <td className="bs-calc is-right" />
              <td className="bs-calc is-right" />
              <td className="bs-calc is-right">{totals.plan ? formatWon(totals.plan) : ""}</td>
              <td className="bs-calc is-right">{withLedger && totals.spent ? formatWon(totals.spent) : ""}</td>
              <td className={`bs-calc is-right${totals.balance < 0 ? " is-negative" : ""}`}>{totals.plan || totals.spent ? formatWon(totals.balance) : ""}</td>
              <td className="bs-calc is-left" colSpan={2}>
                {totals.plan ? `집행률 ${totals.rate}%${totals.over ? ` · 초과 ${totals.over}개 비목` : ""}` : ""}
              </td>
              <td className="bs-actions" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="budget-sheet-foot">
        <span>{sheetSummaryLine(rows)}</span>
        <button className="ghost-light-button small" type="button" onClick={addRow} aria-label="예산 행 추가">+ 행 추가</button>
      </div>
      <p className="block-note">
        편성액은 단가 × 수량으로 계산합니다. 집행액은 지출 원장에서 가져오고, 원장에 기록이 없는 비목이면 표에서 바로 적을 수 있습니다
        {withLedger ? " — 여기서 적은 값은 ‘예산 관리표에서 입력’ 기록으로 원장에 남아 결과보고·내려받기 숫자와 같아집니다." : "."}
      </p>
      {!withLedger && <p className="block-note">지출 원장과 함께 보려면 사업 상세의 ‘예산·집행’ 탭에서 이 표를 여세요.</p>}
    </div>
  );
}
