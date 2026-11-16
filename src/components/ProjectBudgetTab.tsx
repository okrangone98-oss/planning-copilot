import { useMemo, useState } from "react";
import type { GrantBudgetLine, GrantPlan, SectionId } from "../types";
import type { ProjectMeta } from "../lib/projectWorkspace.mjs";
import { budgetSummary, formatWon } from "../lib/grantWorkflow.mjs";
import {
  EXPENSE_STATUSES,
  addExpenses,
  expenseStatusLabel,
  expenseSummary,
  removeExpense,
  updateExpense,
  type ExpenseStatusId,
  type ProjectExpense,
  type ProjectWork
} from "../lib/projectOperations.mjs";
import { expensesToTsv } from "../lib/expenseImport.mjs";
import type { ExpenseInput } from "../lib/expenseImport.mjs";
import { BudgetImportPanel } from "./BudgetImportPanel";
import { ExpenseImportPanel } from "./ExpenseImportPanel";

type ExpenseDraft = {
  budgetLineId: string;
  sessionId: string;
  spentAt: string;
  vendor: string;
  description: string;
  amount: string;
  status: ExpenseStatusId;
  evidenceRef: string;
  evidenceNote: string;
  evidenceChecked: boolean;
};

function todayText() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function emptyDraft(): ExpenseDraft {
  return {
    budgetLineId: "",
    sessionId: "",
    spentAt: todayText(),
    vendor: "",
    description: "",
    amount: "",
    status: "paid",
    evidenceRef: "",
    evidenceNote: "",
    evidenceChecked: false
  };
}

function draftFrom(expense: ProjectExpense): ExpenseDraft {
  return {
    budgetLineId: expense.budgetLineId,
    sessionId: expense.sessionId,
    spentAt: expense.spentAt,
    vendor: expense.vendor,
    description: expense.description,
    amount: String(expense.amount || ""),
    status: expense.status,
    evidenceRef: expense.evidenceRef,
    evidenceNote: expense.evidenceNote,
    evidenceChecked: expense.evidenceChecked
  };
}

function draftToPatch(draft: ExpenseDraft) {
  return {
    budgetLineId: draft.budgetLineId,
    sessionId: draft.sessionId,
    spentAt: draft.spentAt,
    vendor: draft.vendor,
    description: draft.description,
    amount: Number(String(draft.amount).replace(/[^\d]/g, "")) || 0,
    status: draft.status,
    evidenceRef: draft.evidenceRef,
    evidenceNote: draft.evidenceNote,
    evidenceChecked: draft.evidenceChecked
  };
}

function formatDay(value: string) {
  if (!value) return "날짜 없음";
  const [year, month, day] = value.split("-");
  return `${Number(year)}.${Number(month)}.${Number(day)}`;
}

/** 비목 select에 쓰는 이름. 같은 이름이 여럿이면 구분되도록 번호를 붙인다. */
function lineLabel(line: GrantBudgetLine) {
  const category = line.category || "비목 미입력";
  const item = line.item ? ` · ${line.item}` : "";
  return `${category}${item}`;
}

type LedgerFilter = "all" | "paid" | "pending" | "planned" | "evidence";

/**
 * 예산·집행 탭.
 * 계획액의 유일한 원천은 grantPlan.budgetLines다(이 화면은 복제 합산하지 않는다).
 * 지출 원장(expenses)은 실제로 나간 돈을 비목 id로 계획 행에 붙여, 계획·집행·잔액을 한 판에서 대조한다.
 */
export function ProjectBudgetTab({
  meta,
  plan,
  work,
  onChangeLines,
  onUpdateWork,
  notify,
  onNavigate,
  onOpenTab
}: {
  meta: ProjectMeta;
  plan: GrantPlan;
  work: ProjectWork;
  onChangeLines: (lines: GrantBudgetLine[]) => void;
  onUpdateWork: (next: ProjectWork) => void;
  notify: (message: string) => void;
  onNavigate: (section: SectionId) => void;
  onOpenTab?: (tab: "overview" | "tasks" | "sessions" | "budget") => void;
}) {
  const summary = budgetSummary(plan);
  const funding = summary.funding;
  const ledger = useMemo(() => expenseSummary(work, plan), [work, plan]);
  const maxCategory = summary.byCategory.reduce((max, item) => Math.max(max, item.total), 0);
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<ExpenseDraft>(emptyDraft);

  const expenses = work.expenses;
  const editing = expenses.find((expense) => expense.id === editingId) || null;
  const lineById = useMemo(() => new Map(plan.budgetLines.map((line) => [line.id, line])), [plan.budgetLines]);
  const sessionById = useMemo(() => new Map(work.sessions.map((session) => [session.id, session])), [work.sessions]);

  const counts = useMemo(
    () => ({
      all: expenses.length,
      paid: expenses.filter((expense) => expense.status === "paid").length,
      pending: expenses.filter((expense) => expense.status === "pending").length,
      planned: expenses.filter((expense) => expense.status === "planned").length,
      evidence: expenses.filter((expense) => expense.status !== "planned" && !expense.evidenceChecked).length
    }),
    [expenses]
  );

  const visible = useMemo(() => {
    const list = expenses.filter((expense) => {
      if (filter === "all") return true;
      if (filter === "evidence") return expense.status !== "planned" && !expense.evidenceChecked;
      return expense.status === filter;
    });
    return [...list].sort((left, right) => {
      const leftKey = left.spentAt || "0000-00-00";
      const rightKey = right.spentAt || "0000-00-00";
      if (leftKey === rightKey) return (right.createdAt || "").localeCompare(left.createdAt || "");
      return rightKey.localeCompare(leftKey);
    });
  }, [expenses, filter]);

  const startAdd = () => {
    setAdding(true);
    setEditingId("");
    setImporting(false);
    setDraft(emptyDraft());
  };

  const saveDraft = () => {
    const patch = draftToPatch(draft);
    if (!patch.description.trim() && !patch.vendor.trim()) {
      notify("적요나 거래처를 하나는 적어 주세요.");
      return;
    }
    if (!patch.amount) {
      notify("금액을 숫자로 적어 주세요.");
      return;
    }
    const result = editing
      ? updateExpense(work, editing.id, patch, { now: new Date() })
      : addExpenses(work, [patch], new Date());
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    setAdding(false);
    setEditingId("");
    setDraft(emptyDraft());
    notify(editing ? "지출 기록을 고쳤습니다." : `지출 ${formatWon(patch.amount)}을 원장에 더했습니다.`);
  };

  const startEdit = (expense: ProjectExpense) => {
    setAdding(false);
    setImporting(false);
    setEditingId(expense.id);
    setDraft(draftFrom(expense));
  };

  const remove = (expense: ProjectExpense) => {
    const label = expense.description || expense.vendor || "지출";
    if (!window.confirm(`${label} ${formatWon(expense.amount)} 기록을 지울까요? 지출 기록은 되돌릴 수 없습니다.`)) return;
    const result = removeExpense(work, expense.id, new Date());
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    if (editingId === expense.id) {
      setEditingId("");
      setDraft(emptyDraft());
    }
    notify("지출 기록을 지웠습니다.");
  };

  const toggleEvidence = (expense: ProjectExpense) => {
    const result = updateExpense(work, expense.id, { evidenceChecked: !expense.evidenceChecked }, { now: new Date() });
    if (result.error) {
      notify(result.error);
      return;
    }
    onUpdateWork(result.work);
    notify(expense.evidenceChecked ? "증빙 확인을 해제했습니다." : "증빙 확인으로 표시했습니다.");
  };

  const importExpenses = (inputs: ExpenseInput[]) => {
    const result = addExpenses(work, inputs, new Date());
    if (result.error) {
      notify(result.error);
      if (!result.added) return;
    }
    if (result.added) {
      onUpdateWork(result.work);
      setImporting(false);
      notify(`지출 ${result.added}건을 원장에 더했습니다.${result.skipped ? ` ${result.skipped}건은 상한을 넘어 넣지 못했습니다.` : ""}`);
    }
  };

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(expensesToTsv(expenses, plan.budgetLines));
      notify("지출 원장을 시트에 붙여넣을 수 있게 복사했습니다.");
    } catch {
      notify("복사하지 못했습니다. 브라우저가 클립보드를 막았는지 확인해 주세요.");
    }
  };

  const form = (
    <section className="pc-add pc-expense-form" aria-label={editing ? "지출 수정" : "지출 추가"}>
      <div className="block-head">
        <h3>{editing ? "지출 수정" : "지출 추가"}</h3>
        <button className="ghost-light-button" type="button" onClick={() => { setAdding(false); setEditingId(""); }}>
          닫기
        </button>
      </div>
      <div className="form-grid">
        <label className="field wide">
          <span>비목</span>
          <select value={draft.budgetLineId} onChange={(event) => setDraft({ ...draft, budgetLineId: event.target.value })}>
            <option value="">비목 미지정</option>
            {plan.budgetLines.map((line) => (
              <option key={line.id} value={line.id}>{lineLabel(line)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>지출일</span>
          <input type="date" value={draft.spentAt} onChange={(event) => setDraft({ ...draft, spentAt: event.target.value })} />
        </label>
        <label className="field">
          <span>금액</span>
          <input
            inputMode="numeric"
            value={draft.amount}
            placeholder="48000"
            onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
          />
        </label>
        <label className="field">
          <span>거래처</span>
          <input value={draft.vendor} placeholder="예: 양양문구" onChange={(event) => setDraft({ ...draft, vendor: event.target.value })} />
        </label>
        <label className="field">
          <span>상태</span>
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ExpenseStatusId })}>
            {EXPENSE_STATUSES.map((status) => <option key={status.id} value={status.id}>{status.label}</option>)}
          </select>
        </label>
        <label className="field wide">
          <span>적요</span>
          <input value={draft.description} placeholder="예: 3회차 준비물(포스트잇·마커)" onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </label>
        <label className="field">
          <span>회차 (선택)</span>
          <select value={draft.sessionId} onChange={(event) => setDraft({ ...draft, sessionId: event.target.value })}>
            <option value="">회차 없음</option>
            {work.sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.sequence}회차 · {session.title}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>증빙 참조</span>
          <input value={draft.evidenceRef} placeholder="예: 카드전표 11/03 · 영수증 #12" onChange={(event) => setDraft({ ...draft, evidenceRef: event.target.value })} />
        </label>
        <label className="field wide">
          <span>증빙 메모</span>
          <input value={draft.evidenceNote} placeholder="예: 원본 사무국 보관, 세금계산서 별도" onChange={(event) => setDraft({ ...draft, evidenceNote: event.target.value })} />
        </label>
        <label className="pc-check-inline wide">
          <input type="checkbox" checked={draft.evidenceChecked} onChange={(event) => setDraft({ ...draft, evidenceChecked: event.target.checked })} />
          <span>증빙 확인 완료 (금액·증 빙이 맞는지 확인했음)</span>
        </label>
      </div>
      <div className="draft-actions">
        <button className="primary-button" type="button" onClick={saveDraft}>{editing ? "저장" : "원장에 더하기"}</button>
        <button className="ghost-light-button" type="button" onClick={() => { setAdding(false); setEditingId(""); }}>닫기</button>
      </div>
    </section>
  );

  return (
    <div className="pc-budget">
      <div className="pc-stat-row" aria-label="예산·집행 요약">
        <div className="pc-stat is-wide"><span>계획액</span><strong>{formatWon(ledger.total.plan)}</strong></div>
        <div className="pc-stat"><span>집행액(완료+예정)</span><strong>{formatWon(ledger.total.spent)}</strong></div>
        <div className={`pc-stat ${ledger.total.balance < 0 ? "is-danger" : ""}`}><span>잔액</span><strong>{formatWon(ledger.total.balance)}</strong></div>
        <div className="pc-stat"><span>집행률</span><strong>{ledger.total.plan ? `${ledger.total.rate}%` : "—"}</strong></div>
        <button
          className={`pc-stat pc-stat-button ${ledger.evidence.missing ? "is-warning" : ""}`}
          type="button"
          onClick={() => setFilter("evidence")}
          aria-label="증빙 미확인 지출 보기"
        >
          <span>증빙 미확인</span><strong>{ledger.evidence.missing}건</strong>
        </button>
      </div>

      {funding.rateMismatch && (
        <p className="pc-notice is-warning">
          재원 비율 합계가 {funding.rateSum}%입니다. 국비·지방비·자부담 비율을 100%로 맞춰 주세요.
        </p>
      )}

      <div className="block-head">
        <h3>비목별 계획 · 집행 · 잔액</h3>
        <span className="block-count">지출 {ledger.expenseCount}건 · 비목 {ledger.lineCount}개</span>
      </div>

      {ledger.overRows.length > 0 && (
        <p className="pc-notice is-danger">
          계획보다 많이 쓴 비목이 있습니다: {ledger.overRows.join(", ")}. 전용·추경이 가능한지 확인하고, 아니면 다른 비목에서 옮겨 적으세요.
        </p>
      )}

      {ledger.rows.length === 0 ? (
        <div className="office-empty">
          <strong>아직 예산 비목도, 지출도 없습니다.</strong>
          <span>아래 ‘계획 비목 편집’에서 비목을 채우거나 구글 시트·CSV를 붙여넣으면 계획액이 잡힙니다. 지출은 원장에 한 건씩 적거나 시트에서 한 번에 가져올 수 있습니다.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stacked-table pc-ledger-table">
            <thead>
              <tr>
                <th>비목</th>
                <th>계획액</th>
                <th>집행액</th>
                <th>잔액</th>
                <th>집행률</th>
                <th>알림</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.map((row) => (
                <tr key={row.category} className={row.over ? "is-over" : ""}>
                  <td data-label="비목">
                    <strong>{row.category}</strong>
                    <small className="pc-cell-note">지출 {row.count}건{row.planned ? ` · 계획만 ${formatWon(row.planned)}` : ""}</small>
                  </td>
                  <td data-label="계획액">{formatWon(row.plan)}</td>
                  <td data-label="집행액">
                    <strong>{formatWon(row.spent)}</strong>
                    <small className="pc-cell-note">완료 {formatWon(row.paid)} · 예정 {formatWon(row.pending)}</small>
                  </td>
                  <td data-label="잔액" className={row.balance < 0 ? "is-negative" : ""}>{formatWon(row.balance)}</td>
                  <td data-label="집행률">
                    <span className="pc-rate">{row.plan ? `${row.rate}%` : "—"}</span>
                    <span className="pc-rate-bar" role="presentation">
                      <i
                        className={row.over ? "is-over" : ""}
                        style={{ width: `${Math.min(100, row.plan ? Math.round((row.spent / row.plan) * 100) : row.spent ? 100 : 0)}%` }}
                      />
                    </span>
                  </td>
                  <td data-label="알림">
                    {row.over ? (
                      <span className="pc-state-chip is-blocked">초과 {formatWon(row.spent - row.plan)}</span>
                    ) : row.plan === 0 ? (
                      <span className="pc-state-chip is-new">계획 없음</span>
                    ) : (
                      <span className="pc-state-chip is-kept">여유</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td data-label="합계">합계</td>
                <td data-label="계획액">{formatWon(ledger.total.plan)}</td>
                <td data-label="집행액">{formatWon(ledger.total.spent)}</td>
                <td data-label="잔액" className={ledger.total.balance < 0 ? "is-negative" : ""}>{formatWon(ledger.total.balance)}</td>
                <td data-label="집행률">{ledger.total.plan ? `${ledger.total.rate}%` : "—"}</td>
                <td data-label="알림">{ledger.total.over ? "초과" : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="block-note">
        집행액 = 집행 완료 + 지출 예정입니다. 계획만 세운 지출{ledger.plannedOnly ? ` ${formatWon(ledger.plannedOnly)}` : ""}은 잔액에서 빼지 않고 참고로만 셉니다.
        {ledger.unassignedCount > 0 ? ` 비목을 찾지 못한 지출 ${ledger.unassignedCount}건은 ‘비목 미지정’으로 묶어 합계에는 넣었습니다.` : ""}
      </p>

      {ledger.rows.some((row) => row.lines.length > 0) && (
        <details className="pc-line-detail">
          <summary>세목별로 보기</summary>
          <ul>
            {ledger.rows.map((row) => (
              row.lines.length > 0 && (
                <li key={row.category}>
                  <strong>{row.category}</strong>
                  <ul>
                    {row.lines.map((line) => (
                      <li key={line.id} className={line.over ? "is-over" : ""}>
                        <span>{line.item || "세목 없음"}</span>
                        <span>계획 {formatWon(line.plan)} · 집행 {formatWon(line.spent)} · 잔액 {formatWon(line.balance)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            ))}
          </ul>
        </details>
      )}

      <div className="block-head">
        <h3>지출 원장</h3>
        <span className="block-count">
          증빙 확인 {ledger.evidence.checked}/{ledger.evidence.total}
          {ledger.evidence.missing > 0 ? ` · 미확인 ${formatWon(ledger.evidence.missingAmount)}` : ""}
        </span>
      </div>

      <div className="pc-toolbar">
        <div className="pc-filter-chips" role="group" aria-label="지출 거르기">
          {([
            ["all", `전체 ${counts.all}`],
            ["paid", `집행 완료 ${counts.paid}`],
            ["pending", `지출 예정 ${counts.pending}`],
            ["planned", `계획만 ${counts.planned}`],
            ["evidence", `증빙 미확인 ${counts.evidence}`]
          ] as Array<[LedgerFilter, string]>).map(([id, label]) => (
            <button
              key={id}
              className={`pc-chip ${filter === id ? "is-on" : ""} ${id === "evidence" && counts.evidence ? "is-warning" : ""}`}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pc-toolbar-actions">
          <button className="primary-button" type="button" onClick={startAdd} aria-expanded={adding}>
            {adding ? "추가 접기" : "지출 추가"}
          </button>
          <button className="secondary-button" type="button" onClick={() => { setImporting((current) => !current); setAdding(false); setEditingId(""); }} aria-expanded={importing}>
            시트·CSV 가져오기
          </button>
          {expenses.length > 0 && (
            <button className="ghost-light-button" type="button" onClick={() => { void copyTsv(); }}>시트로 복사</button>
          )}
        </div>
      </div>

      {adding && form}
      {editing && form}
      {importing && (
        <ExpenseImportPanel
          budgetLines={plan.budgetLines}
          expenses={expenses}
          onImport={importExpenses}
          notify={notify}
          onClose={() => setImporting(false)}
        />
      )}

      {expenses.length === 0 ? (
        <div className="office-empty">
          <strong>아직 지출 기록이 없습니다.</strong>
          <span>지출을 추가하거나 엑셀·구글 시트 지출 내역을 그대로 붙여넣어 한 번에 가져오세요. 증빙 확인은 나중에 한 번에 체크할 수 있습니다.</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="office-empty">
          <strong>{filter === "evidence" ? "증빙 미확인이 없습니다." : "이 상태의 지출이 없습니다."}</strong>
          <span>{filter === "evidence" ? "집행 완료·지출 예정 지출의 증빙을 모두 확인했습니다." : "다른 거르기를 눌러 전체 지출을 보세요."}</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="stacked-table pc-expense-table">
            <thead>
              <tr>
                <th>지출일</th>
                <th>비목</th>
                <th>적요</th>
                <th>거래처</th>
                <th>금액</th>
                <th>상태</th>
                <th>증빙</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((expense) => {
                const line = lineById.get(expense.budgetLineId);
                const session = sessionById.get(expense.sessionId);
                return (
                  <tr key={expense.id} className={expense.status === "planned" ? "is-planned" : ""}>
                    <td data-label="지출일">{expense.spentAt ? formatDay(expense.spentAt) : "날짜 없음"}</td>
                    <td data-label="비목">
                      {line ? lineLabel(line) : <span className="pc-cell-muted">비목 미지정</span>}
                      {session && <small className="pc-cell-note">{session.sequence}회차</small>}
                    </td>
                    <td data-label="적요">
                      <button className="pc-task-title" type="button" onClick={() => startEdit(expense)}>{expense.description || "적요 없음"}</button>
                    </td>
                    <td data-label="거래처">{expense.vendor || "—"}</td>
                    <td data-label="금액"><strong>{formatWon(expense.amount)}</strong></td>
                    <td data-label="상태">
                      <span className={`pc-task-status is-expense-${expense.status}`}>{expenseStatusLabel(expense.status)}</span>
                    </td>
                    <td data-label="증빙">
                      {expense.status === "planned" ? (
                        <span className="pc-cell-muted">해당 없음</span>
                      ) : (
                        <label className="pc-evidence">
                          <input type="checkbox" checked={expense.evidenceChecked} onChange={() => toggleEvidence(expense)} />
                          <span className={expense.evidenceChecked ? "is-checked" : ""}>
                            {expense.evidenceChecked ? "확인" : "미확인"}
                          </span>
                          {expense.evidenceRef && <small className="pc-cell-note">{expense.evidenceRef}</small>}
                        </label>
                      )}
                    </td>
                    <td data-label="관리">
                      <div className="pc-row-actions">
                        <button className="ghost-light-button" type="button" onClick={() => startEdit(expense)}>수정</button>
                        <button className="ghost-light-button" type="button" onClick={() => remove(expense)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} data-label="합계">보이는 지출 {visible.length}건 합계</td>
                <td data-label="금액"><strong>{formatWon(visible.reduce((sum, expense) => sum + expense.amount, 0))}</strong></td>
                <td colSpan={3} data-label="" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="pc-note-with-link">
        <p className="block-note">
          증빙 원본(영수증·세금계산서)은 이 브라우저에 올리지 않습니다. 확인 여부와 어디에 두었는지만 적어 두고, 원본은 사무국·Drive에 보관하세요.
        </p>
        <button className="block-link" type="button" onClick={() => onNavigate("grantChecklist")}>정산 증빙 화면에서 누락 보기</button>
      </div>

      <details className="pc-plan-editor">
        <summary>
          <span>계획 비목 편집</span>
          <small>비목 {summary.lineCount}개 · 계획액 {formatWon(summary.total)} · 예산 편성 화면과 같은 데이터</small>
        </summary>
        <div className="pc-plan-editor-body">
          <div className="pc-stat-row" aria-label="재원 구성">
            <div className="pc-stat"><span>국비</span><strong>{formatWon(funding.subsidy)}</strong></div>
            <div className="pc-stat"><span>지방비</span><strong>{formatWon(funding.local)}</strong></div>
            <div className="pc-stat"><span>자부담</span><strong>{formatWon(funding.self)}</strong></div>
          </div>
          {summary.byCategory.length > 0 && (
            <ul className="pc-budget-bars">
              {summary.byCategory.map((item) => (
                <li key={item.category}>
                  <div className="pc-budget-bar-head">
                    <strong>{item.category}</strong>
                    <span>{formatWon(item.total)} · {item.share}%</span>
                  </div>
                  <div className="pc-budget-bar" role="presentation">
                    <i style={{ width: `${maxCategory ? Math.round((item.total / maxCategory) * 100) : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <BudgetImportPanel lines={plan.budgetLines} onChange={onChangeLines} notify={notify} />
          {summary.rows.length > 0 && (
            <div className="table-wrap">
              <table className="stacked-table pc-budget-table">
                <thead>
                  <tr>
                    <th>비목</th>
                    <th>세목</th>
                    <th>단가</th>
                    <th>수량</th>
                    <th>금액</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.slice(0, 20).map((row) => (
                    <tr key={row.id}>
                      <td data-label="비목">{row.category || "미분류"}</td>
                      <td data-label="세목">{row.item || "—"}</td>
                      <td data-label="단가">{formatWon(Number(row.unitCost) || 0)}</td>
                      <td data-label="수량">{row.quantity || "—"}</td>
                      <td data-label="금액"><strong>{formatWon(row.amount)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} data-label="합계">합계</td>
                    <td data-label="합계 금액"><strong>{formatWon(summary.total)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {summary.rows.length > 20 && <p className="block-note">전체 {summary.rows.length}개 중 20개만 보여 줍니다. 전체 표는 예산 편성 화면에서 보세요.</p>}
          <p className="block-note">
            {meta.name} · 계획액은 예산 편성의 비목 합계 하나입니다. 여기서 고친 비목은 예산 편성 화면과 결과보고에 바로 반영됩니다.
          </p>
          <div className="pc-note-with-link">
            <button className="block-link" type="button" onClick={() => onNavigate("grantBudget")}>예산 편성 화면에서 편집</button>
            {onOpenTab && (
              <button className="block-link" type="button" onClick={() => onOpenTab("sessions")}>회차·인원 열기</button>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
