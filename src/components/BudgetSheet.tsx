import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BudgetSheetColumn, GrantBudgetLine } from "../types";
import { emptyBudgetLine, formatWon, parseAmount } from "../lib/grantWorkflow.mjs";
import {
  GRID_SPENT_LABEL,
  applyBlockPaste,
  sheetExportRows,
  sheetRows,
  sheetSummaryLine,
  sheetToTsv,
  sheetTotals,
  type GridSpentUpdate
} from "../lib/budgetSheet.mjs";
import {
  cellValueOf,
  columnOfRole,
  createBudgetColumn,
  isNumericColumn,
  numericValueOf,
  normalizeBudgetColumns
} from "../lib/budgetColumns.mjs";
import { buildXlsxBytes, rowsToCsvText } from "../lib/xlsxTable.mjs";
import { mergeBudgetLines, parseBudgetTable, type BudgetImportMode, type ParsedBudgetRow } from "../lib/budgetImport.mjs";
import type { ProjectExpense } from "../lib/projectOperations.mjs";
import { downloadTextFile, safeFileName } from "../lib/storage";
import { BudgetImportPanel } from "./BudgetImportPanel";

type CellRef = { row: number; id: string };

/** 열 역할 → 예산 행의 필드. 역할이 없는 열(사용자 열)은 빈 글자. */
function fieldOfRole(role: string): keyof GrantBudgetLine | "" {
  switch (role) {
    case "category": return "category";
    case "item": return "item";
    case "unitPrice": return "unitCost";
    case "qty": return "quantity";
    case "basis": return "basis";
    case "note": return "note";
    default: return "";
  }
}

function grouped(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

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
 * - 머리글을 눌러 이름을 바꾸고, 열을 더하거나 지울 수 있다. 바뀐 이름·열은 이 사업에 저장되어
 *   내려받기(CSV·XLSX)·서류 양식 채우기·결과보고 .hwpx 에 그대로 쓰인다.
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
  columns: columnsProp,
  onChangeColumns,
  fileNamePrefix = "예산관리표",
  hint,
  badge,
  actions
}: {
  lines: GrantBudgetLine[];
  onChange: (lines: GrantBudgetLine[]) => void;
  notify: (message: string) => void;
  /** 지출 원장 — 넘기면 집행액·잔액이 원장과 연결된다. */
  expenses?: ProjectExpense[];
  /** 격자에서 고친 집행액을 원장에 반영한다(한 번에 여러 건). */
  onSetSpent?: (updates: GridSpentUpdate[]) => void;
  /** 사업에 저장된 열 정의 — 없으면 기본 열로 시작하고 이 화면 안에서만 바뀐다. */
  columns?: BudgetSheetColumn[];
  /** 머리글 이름·열 추가/삭제를 사업에 저장한다. */
  onChangeColumns?: (columns: BudgetSheetColumn[]) => void;
  fileNamePrefix?: string;
  hint?: string;
  /** 표 제목 옆에 붙는 짧은 셈 — 예: "지출 1건 · 비목 4개" */
  badge?: string;
  /** 툴바 끝에 붙일 화면별 버튼(예: 서류 양식에 숫자 넣기) */
  actions?: React.ReactNode;
}) {
  const [localColumns, setLocalColumns] = useState<BudgetSheetColumn[]>(() => normalizeBudgetColumns(null));
  const columns = useMemo(
    () => (columnsProp ? normalizeBudgetColumns(columnsProp) : localColumns),
    [columnsProp, localColumns]
  );
  const setColumns = useCallback(
    (next: BudgetSheetColumn[]) => {
      const normalized = normalizeBudgetColumns(next);
      if (onChangeColumns) onChangeColumns(normalized);
      else setLocalColumns(normalized);
    },
    [onChangeColumns]
  );

  const rows = useMemo(() => sheetRows({ lines, expenses }), [lines, expenses]);
  const totals = useMemo(() => sheetTotals(rows, columns), [rows, columns]);
  const withLedger = Array.isArray(expenses);
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [draft, setDraft] = useState("");
  const [active, setActive] = useState<CellRef | null>(null);
  const [pending, setPending] = useState<CellRef | null>(null);
  const [headerEdit, setHeaderEdit] = useState<{ id: string; draft: string } | null>(null);
  const [adding, setAdding] = useState<{ label: string; numeric: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const skipBlur = useRef(false);
  const skipHeaderBlur = useRef(false);

  const columnById = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);

  const valueOf = (rowIndex: number, column: BudgetSheetColumn) => {
    const row = rows[rowIndex];
    if (!row || !column) return "";
    if (column.role === "spent") return row.spent ? String(row.spent) : "";
    const value = cellValueOf(row, column);
    return value === null || value === undefined ? "" : String(value);
  };

  const canEdit = (rowIndex: number, column: BudgetSheetColumn) => {
    if (!lines[rowIndex] || !column) return false;
    if (column.role === "budget" || column.role === "balance") return false;
    if (column.role === "spent") return Boolean(onSetSpent) && !rows[rowIndex]?.locked;
    return true;
  };

  const startEdit = (rowIndex: number, column: BudgetSheetColumn) => {
    if (!canEdit(rowIndex, column)) {
      if (column.role === "spent" && rows[rowIndex]?.locked) {
        notify("이 비목은 지출 원장에 기록이 있어 격자에서 고칠 수 없습니다. 아래 지출 원장에서 고쳐 주세요.");
      }
      return;
    }
    setHeaderEdit(null);
    setActive({ row: rowIndex, id: column.id });
    setEditing({ row: rowIndex, id: column.id });
    setDraft(valueOf(rowIndex, column));
  };

  // 새 행을 만든 뒤 그 행의 첫 칸으로 옮겨 간다 — 표가 늘어난 다음 렌더에서 시작한다.
  useEffect(() => {
    if (!pending) return;
    if (pending.row < lines.length) {
      setEditing(pending);
      setActive(pending);
      const column = columnById.get(pending.id) || columns[0];
      setDraft(column ? valueOf(pending.row, column) : "");
      setPending(null);
    }
  }, [pending, lines.length]);

  /**
   * 고친 값을 예산 행에 반영한 새 목록을 돌려준다(바뀐 것이 없으면 null).
   * Enter 로 새 행을 만들 때 이 목록 뒤에 붙여야 방금 적은 값이 사라지지 않는다.
   */
  const commitLines = (cell: CellRef, raw: string): GrantBudgetLine[] | null => {
    const line = lines[cell.row];
    const column = columnById.get(cell.id);
    if (!line || !column) return null;
    if (column.role === "spent") {
      const amount = parseAmount(raw);
      if (onSetSpent) onSetSpent([{ lineId: line.id, amount }]);
      return null;
    }
    let value = String(raw ?? "");
    if (column.role === "unitPrice") value = parseAmount(value) ? String(parseAmount(value)) : "";
    else value = value.slice(0, 200);

    if (column.role === "custom") {
      const custom = { ...(line.custom || {}) };
      const before = String(custom[column.id] ?? "");
      if (before === value) return null;
      if (value) custom[column.id] = value;
      else delete custom[column.id];
      return lines.map((item, index) => (index === cell.row ? { ...item, custom } : item));
    }

    const field = fieldOfRole(column.role);
    if (!field) return null;
    if (String(line[field] ?? "") === value) return null;
    return lines.map((item, index) => (index === cell.row ? { ...item, [field]: value } : item));
  };

  const commit = (cell: CellRef, raw: string) => {
    const next = commitLines(cell, raw);
    if (next) onChange(next);
    return next;
  };

  /** Tab·Enter 가 옮겨 갈 칸. 표 끝을 넘어가면 새 행을 만든다. */
  const neighbor = (cell: CellRef, horizontal: 1 | -1, vertical: boolean): CellRef | "append" | null => {
    const columnIndex = columns.findIndex((column) => column.id === cell.id);
    let nextColumn = columnIndex < 0 ? 0 : columnIndex;
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
    return { row: nextRow, id: columns[nextColumn].id };
  };

  const moveTo = (target: CellRef | "append" | null, baseLines: GrantBudgetLine[] = lines) => {
    setEditing(null);
    if (!target) return;
    if (target === "append") {
      onChange([...baseLines, emptyBudgetLine(`sheet-${Date.now()}`)]);
      setPending({ row: baseLines.length, id: columns[0]?.id ?? "category" });
      setActive({ row: baseLines.length, id: columns[0]?.id ?? "category" });
      return;
    }
    setPending(target);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, cell: CellRef) => {
    if (event.key === "Tab") {
      event.preventDefault();
      skipBlur.current = true;
      const next = commit(cell, draft);
      moveTo(neighbor(cell, event.shiftKey ? -1 : 1, false), next ?? lines);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlur.current = true;
      const next = commit(cell, draft);
      moveTo(neighbor(cell, event.shiftKey ? -1 : 1, true), next ?? lines);
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
      const parsed = parseBudgetTable(text, { columns });
      if (!parsed.rows.length) {
        notify(parsed.warnings[parsed.warnings.length - 1] || "붙여넣은 표에서 예산 행을 찾지 못했습니다.");
        return;
      }
      applyImported(parsed.rows, "append");
      notify(`쉼표로 나뉜 표 ${parsed.rows.length}행을 예산표 뒤에 붙였습니다.`);
      return;
    }
    const startColumn = anchor ? Math.max(0, columns.findIndex((column) => column.id === anchor.id)) : 0;
    const result = applyBlockPaste({
      lines,
      expenses,
      // 행을 지운 뒤 남은 위치에서 붙여도 표 밖으로 넘어가지 않게 한다.
      startRow: anchor ? Math.min(Math.max(0, anchor.row), lines.length) : 0,
      startColumn,
      columns,
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
    setPending({ row: lines.length, id: columns[0]?.id ?? "category" });
  };

  /* ── 머리글 이름·열 편집 ─────────────────────────────── */

  const startHeaderEdit = (column: BudgetSheetColumn) => {
    setEditing(null);
    setHeaderEdit({ id: column.id, draft: column.label });
  };

  const commitHeader = () => {
    const target = headerEdit;
    if (!target) return;
    setHeaderEdit(null);
    const column = columnById.get(target.id);
    if (!column) return;
    const label = target.draft.trim().replace(/\s+/g, " ").slice(0, 24) || column.label;
    if (label === column.label) return;
    setColumns(columns.map((item) => (item.id === target.id ? { ...item, label } : item)));
    notify(`머리글 ‘${column.label}’을(를) ‘${label}’(으)로 바꿨습니다. 내려받기·서류 양식에도 이 이름으로 들어갑니다.`);
  };

  const submitColumn = () => {
    if (!adding) return;
    const label = adding.label.trim();
    if (!label) {
      notify("새 열 이름을 적어 주세요. 예: 국비, 지방비, 자부담");
      return;
    }
    const column = createBudgetColumn({ label, numeric: adding.numeric }, columns);
    setColumns([...columns, column]);
    setAdding(null);
    notify(`‘${column.label}’ 열을 더했습니다${adding.numeric ? " (숫자 열 — 표 아래에 합계를 냅니다)" : ""}.`);
  };

  const toggleNumeric = (column: BudgetSheetColumn) => {
    const numeric = isNumericColumn(column);
    const next = columns.map((item) => (item.id === column.id
      ? ({ ...item, numeric: !numeric, kind: numeric ? "text" : "number", align: numeric ? "left" : "right" } as BudgetSheetColumn)
      : item));
    setColumns(next);
    notify(`‘${column.label}’ 열을 ${isNumericColumn(column) ? "글자" : "숫자"} 열로 바꿨습니다.`);
  };

  const removeColumn = (column: BudgetSheetColumn) => {
    if (columns.length <= 1) {
      notify("표에는 열이 최소 한 개는 있어야 합니다.");
      return;
    }
    if ((column.role === "unitPrice" || column.role === "qty") && columnOfRole(columns, "budget")) {
      notify(`${column.label} 열은 편성액(단가 × 수량) 계산에 쓰여 지울 수 없습니다. 이름은 바꿀 수 있습니다.`);
      return;
    }
    const note = column.role === "budget" || column.role === "balance"
      ? "\n이 열을 지우면 표에서 금액이 보이지 않습니다(적은 값은 지워지지 않습니다)."
      : column.role === "spent"
        ? "\n집행액 열을 지워도 지출 원장 기록은 그대로 남습니다."
        : "";
    if (!window.confirm(`‘${column.label}’ 열을 표에서 지울까요?${note}`)) return;
    setColumns(columns.filter((item) => item.id !== column.id));
    notify(`‘${column.label}’ 열을 표에서 지웠습니다. 적어 둔 값은 남아 있어 다시 더하면 그대로 보입니다.`);
  };

  /* ── 내려받기·복사 ─────────────────────────────────── */

  const exportCsv = () => {
    const table = sheetExportRows({ lines, expenses, columns });
    const name = safeFileName(`${fileNamePrefix}-${new Date().toISOString().slice(0, 10)}`, "예산관리표");
    downloadTextFile(rowsToCsvText(table), `${name}.csv`, "text/csv;charset=utf-8");
    notify("예산표를 CSV로 내려받았습니다. 머리글은 표에서 고친 열 이름 그대로입니다.");
  };

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const bytes = await buildXlsxBytes({ sheetName: "예산관리표", rows: sheetExportRows({ lines, expenses, columns }) });
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
      await navigator.clipboard.writeText(sheetToTsv({ lines, expenses, columns }));
      notify("예산표를 시트에 붙여넣을 수 있게 복사했습니다.");
    } catch {
      notify("복사하지 못했습니다. 브라우저가 클립보드를 막았는지 확인해 주세요.");
    }
  };

  /** 합계 줄에 넣을 글자 — 숫자 열은 합계, 첫 글자 열은 '합계 · N개 비목'. */
  const totalTextOf = (column: BudgetSheetColumn) => {
    if (column.role === "category") return `합계 · ${totals.lineCount}개 비목`;
    if (column.role === "budget") return totals.plan ? formatWon(totals.plan) : "";
    if (column.role === "spent") return withLedger && totals.spent ? formatWon(totals.spent) : "";
    if (column.role === "balance") {
      if (!totals.plan && !totals.spent) return "";
      return formatWon(totals.balance);
    }
    const total = totals.columnTotals[column.id];
    if (total === null || total === undefined) return "";
    return column.kind === "number" ? grouped(total) : formatWon(total);
  };

  const tableMinWidth = 38 + 40 + columns.reduce((sum, column) => sum + (Number(column.width) || 100), 0);

  return (
    <div className="budget-sheet" aria-label="예산 관리표">
      <div className="budget-sheet-bar">
        <div className="budget-sheet-bar-main">
          <strong>
            예산 관리표
            {badge && <> <small className="budget-sheet-badge">{badge}</small></>}
          </strong>
          <span>
            칸을 눌러 바로 고치세요. <kbd>Tab</kbd>·<kbd>Enter</kbd>로 옆·아래 칸으로 옮겨 가고, 시트에서 복사한 표는{" "}
            <kbd>Ctrl</kbd>+<kbd>V</kbd>로 그대로 붙습니다. <strong>머리글을 누르면 이름을 바꿀 수 있고</strong>, 바뀐 이름·열은
            내려받기와 서류 양식에 그대로 쓰입니다.
          </span>
        </div>
        <div className="budget-sheet-actions">
          <button className="primary-button small" type="button" onClick={addRow}>행 추가</button>
          <button className="secondary-button small" type="button" onClick={() => setAdding(adding ? null : { label: "", numeric: false })} aria-expanded={Boolean(adding)}>
            + 열 추가
          </button>
          <button className="secondary-button small" type="button" onClick={() => setImporting((current) => !current)} aria-expanded={importing}>
            엑셀·시트 불러오기
          </button>
          <button className="ghost-light-button small" type="button" onClick={exportCsv}>CSV 내려받기</button>
          <button className="ghost-light-button small" type="button" onClick={() => { void exportXlsx(); }} disabled={busy}>XLSX 내려받기</button>
          <button className="ghost-light-button small" type="button" onClick={() => { void copyToSheet(); }}>시트로 복사</button>
          {actions}
        </div>
      </div>

      {adding && (
        <div className="budget-sheet-add-column" role="group" aria-label="새 열 만들기">
          <label className="field">
            <span>새 열 이름</span>
            <input
              autoFocus
              value={adding.label}
              maxLength={24}
              placeholder="예: 국비, 지방비, 자부담"
              onChange={(event) => setAdding({ ...adding, label: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitColumn();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setAdding(null);
                }
              }}
            />
          </label>
          <label className="pc-check-inline">
            <input
              type="checkbox"
              checked={adding.numeric}
              onChange={(event) => setAdding({ ...adding, numeric: event.target.checked })}
            />
            <span>숫자 열 (표 아래에 합계를 냅니다)</span>
          </label>
          <div className="budget-sheet-add-actions">
            <button className="primary-button small" type="button" onClick={submitColumn}>열 추가</button>
            <button className="ghost-light-button small" type="button" onClick={() => setAdding(null)}>취소</button>
          </div>
        </div>
      )}

      {hint && <p className="budget-sheet-hint">{hint}</p>}

      {importing && (
        <div className="budget-sheet-import">
          <BudgetImportPanel
            lines={lines}
            onChange={onChange}
            notify={notify}
            columns={columns}
            onImportRows={applyImported}
            onClose={() => setImporting(false)}
            defaultOpen
          />
        </div>
      )}

      <div className="budget-sheet-scroll" onPaste={onSheetPaste} tabIndex={0} aria-label="예산 관리표 격자">
        <table className="budget-sheet-table" style={{ minWidth: Math.max(960, tableMinWidth) }}>
          <colgroup>
            <col style={{ width: 38 }} />
            {columns.map((column) => <col key={column.id} style={{ width: column.width }} />)}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="bs-gutter" scope="col" aria-label="행 번호" />
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={`bs-kind-${column.kind} is-${column.align} bs-col-${column.id} bs-role-${column.role}`}
                  title={`${column.label} — ${column.role === "custom" ? "내가 더한 열" : "예산표 기본 열"}`}
                >
                  {headerEdit?.id === column.id ? (
                    <input
                      className="bs-head-input"
                      autoFocus
                      value={headerEdit.draft}
                      maxLength={24}
                      aria-label={`${column.label} 머리글 이름`}
                      onChange={(event) => setHeaderEdit({ ...headerEdit, draft: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          skipHeaderBlur.current = true;
                          commitHeader();
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          skipHeaderBlur.current = true;
                          setHeaderEdit(null);
                        }
                      }}
                      onBlur={() => {
                        if (skipHeaderBlur.current) {
                          skipHeaderBlur.current = false;
                          return;
                        }
                        commitHeader();
                      }}
                    />
                  ) : (
                    <span className="bs-head">
                      <button
                        className="bs-head-label"
                        type="button"
                        onClick={() => startHeaderEdit(column)}
                        aria-label={`${column.label} 머리글 이름 바꾸기`}
                      >
                        {column.label}
                      </button>
                      <span className="bs-head-tools">
                        {column.role === "custom" && (
                          <button
                            className="bs-head-tool"
                            type="button"
                            onClick={() => toggleNumeric(column)}
                            aria-label={`${column.label} 열을 ${isNumericColumn(column) ? "글자" : "숫자"} 열로 바꾸기`}
                            title={isNumericColumn(column) ? "글자 열로 바꾸기" : "숫자 열로 바꾸기 (합계를 냅니다)"}
                          >
                            {isNumericColumn(column) ? "가" : "123"}
                          </button>
                        )}
                        <button
                          className="bs-head-tool is-remove"
                          type="button"
                          onClick={() => removeColumn(column)}
                          aria-label={`${column.label} 열 지우기`}
                          title="이 열 지우기"
                        >
                          ×
                        </button>
                      </span>
                    </span>
                  )}
                </th>
              ))}
              <th className="bs-actions" scope="col" aria-label="행 관리" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="bs-gutter">1</td>
                <td className="budget-sheet-empty" colSpan={Math.max(1, columns.length)} onClick={addRow}>
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
                  const isEditing = editing?.row === rowIndex && editing?.id === column.id;
                  const editable = canEdit(rowIndex, column);
                  const cellClass = `bs-cell bs-kind-${column.kind} bs-col-${column.id} is-${column.align}${editable ? " is-editable" : ""}${row.balance < 0 && column.role === "balance" ? " is-negative" : ""}`;
                  if (isEditing) {
                    return (
                      <td key={column.id} className={`${cellClass} is-editing`}>
                        <input
                          className="bs-input"
                          autoFocus
                          inputMode={column.kind === "text" ? "text" : "numeric"}
                          value={draft}
                          aria-label={`${rowIndex + 1}행 ${column.label}`}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => onKeyDown(event, { row: rowIndex, id: column.id })}
                          onPaste={(event) => onCellPaste(event, { row: rowIndex, id: column.id })}
                          onBlur={() => {
                            if (skipBlur.current) {
                              skipBlur.current = false;
                              return;
                            }
                            commit({ row: rowIndex, id: column.id }, draft);
                            setEditing(null);
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={column.id}
                      className={cellClass}
                      onClick={() => {
                        if (column.role === "budget" || column.role === "balance") {
                          setActive({ row: rowIndex, id: column.id });
                          return;
                        }
                        startEdit(rowIndex, column);
                      }}
                    >
                      {column.role === "budget" && (row.amount ? formatWon(row.amount) : "")}
                      {column.role === "balance" && (row.amount || row.spent ? formatWon(row.balance) : "")}
                      {column.role === "spent" && (
                        withLedger ? (
                          <span className="bs-spent-line">
                            {row.spent ? formatWon(row.spent) : ""}
                            {row.locked && <span className="bs-tag" title={`지출 원장 ${row.expenseCount}건에서 가져옴`}>원장</span>}
                            {!row.locked && row.spent > 0 && <span className="bs-tag is-grid" title={GRID_SPENT_LABEL}>입력</span>}
                            {row.plannedOnly > 0 && <span className="bs-tag is-planned" title="지출 예정은 잔액에서 빼지 않습니다">{formatWon(row.plannedOnly)} 예정</span>}
                          </span>
                        ) : <span className="bs-muted">—</span>
                      )}
                      {column.role === "unitPrice" && (parseAmount(row.unitCost) ? formatWon(parseAmount(row.unitCost)) : "")}
                      {column.role === "qty" && <span className="bs-value">{row.quantity}</span>}
                      {(column.role === "category" || column.role === "item" || column.role === "basis" || column.role === "note" || column.role === "custom") && (
                        <span className={`bs-value${column.role === "custom" && isNumericColumn(column) ? " is-num" : ""}`}>
                          {column.role === "custom" && isNumericColumn(column)
                            ? (() => {
                                const number = numericValueOf(row, column);
                                return number === null ? String(cellValueOf(row, column) ?? "") : grouped(number);
                              })()
                            : String(cellValueOf(row, column) ?? "")}
                        </span>
                      )}
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
              {columns.map((column) => {
                const text = totalTextOf(column);
                const negative = column.role === "balance" && totals.balance < 0;
                return (
                  <td
                    key={column.id}
                    className={`${column.role === "category" ? "bs-total-label" : "bs-calc"} is-${column.align}${negative ? " is-negative" : ""}${isNumericColumn(column) ? " bs-kind-num" : ""}`}
                  >
                    {text}
                  </td>
                );
              })}
              <td className="bs-actions" />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="budget-sheet-foot">
        <span>
          {sheetSummaryLine(rows)}
          {totals.over ? ` · 초과 ${totals.over}개 비목` : ""}
        </span>
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
