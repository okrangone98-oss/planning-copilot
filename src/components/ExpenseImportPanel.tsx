import { useMemo, useState } from "react";
import type { GrantBudgetLine } from "../types";
import { formatWon } from "../lib/grantWorkflow.mjs";
import { EXPENSE_IMPORT_SAMPLE, parseExpenseTable, toExpenseInputs } from "../lib/expenseImport.mjs";
import type { ExpenseInput } from "../lib/expenseImport.mjs";
import type { ProjectExpense } from "../lib/projectOperations.mjs";

function sameExpense(left: { spentAt: string; amount: number; description: string }, right: ProjectExpense) {
  return left.spentAt === right.spentAt
    && Math.round(Number(left.amount) || 0) === right.amount
    && left.description.trim() === right.description.trim();
}

/**
 * 지출 내역 가져오기 — 엑셀·구글 시트에서 표를 그대로 복사해 붙여넣거나 CSV를 붙여넣는다.
 * 읽은 결과는 먼저 보여 주고(건수·합계·경고), 사용자가 눌렀을 때만 원장에 더한다.
 * 기존 지출을 지우는 '바꾸기'는 두지 않는다(돈이 나간 기록은 실수로 사라지면 안 된다).
 */
export function ExpenseImportPanel({
  budgetLines,
  expenses,
  onImport,
  notify,
  onClose
}: {
  budgetLines: GrantBudgetLine[];
  expenses: ProjectExpense[];
  onImport: (inputs: ExpenseInput[]) => void;
  notify: (message: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const parsed = useMemo(() => (text.trim() ? parseExpenseTable(text) : null), [text]);
  const resolved = useMemo(
    () => (parsed ? toExpenseInputs(parsed.rows, budgetLines) : { inputs: [] as ExpenseInput[], unmatched: [] as Array<{ description: string; amount: number }> }),
    [parsed, budgetLines]
  );
  const fresh = useMemo(
    () => (skipDuplicates ? resolved.inputs.filter((input) => !expenses.some((expense) => sameExpense(input, expense))) : resolved.inputs),
    [resolved.inputs, expenses, skipDuplicates]
  );
  const duplicates = resolved.inputs.length - fresh.length;
  const totalAmount = fresh.reduce((sum, input) => sum + input.amount, 0);

  const apply = () => {
    if (!fresh.length) {
      notify("원장에 더할 지출이 없습니다. 붙여넣은 표를 확인해 주세요.");
      return;
    }
    onImport(fresh);
    setText("");
  };

  return (
    <section className="pc-add pc-expense-import" aria-label="지출 내역 가져오기">
      <div className="block-head">
        <h3>지출 내역 가져오기</h3>
        <button className="ghost-light-button" type="button" onClick={onClose}>닫기</button>
      </div>
      <p className="block-note">
        엑셀·구글 시트에서 지출 표를 그대로 복사해 붙여넣으세요(탭·쉼표·Markdown 표 모두 됩니다).
        머리글은 사용일자·거래처·적요·금액·비목·상태·증빙을 알아봅니다. 읽은 결과를 먼저 보여 주고, 누를 때만 더합니다.
      </p>
      <label className="field wide">
        <span>붙여넣기</span>
        <textarea
          rows={7}
          value={text}
          placeholder={EXPENSE_IMPORT_SAMPLE}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="draft-actions">
        <button className="ghost-light-button" type="button" onClick={() => setText(EXPENSE_IMPORT_SAMPLE)}>예시 채우기</button>
        <label className="pc-check-inline">
          <input type="checkbox" checked={skipDuplicates} onChange={(event) => setSkipDuplicates(event.target.checked)} />
          <span>같은 날짜·금액·적요는 건너뛰기</span>
        </label>
      </div>

      {parsed && (
        <div className="pc-import-preview" aria-live="polite">
          <div className="pc-import-summary">
            <span>읽은 줄 <strong>{parsed.rowCount}</strong></span>
            <span>합계 <strong>{formatWon(parsed.totalAmount)}</strong></span>
            <span>더할 건 <strong>{fresh.length}</strong></span>
            {duplicates > 0 && <span>중복 <strong>{duplicates}</strong></span>}
            {resolved.unmatched.length > 0 && <span className="is-warning">비목 미지정 <strong>{resolved.unmatched.length}</strong></span>}
          </div>
          {parsed.rowCount > 0 && (
            <div className="table-wrap">
              <table className="stacked-table pc-import-table">
                <thead>
                  <tr>
                    <th>사용일자</th>
                    <th>거래처</th>
                    <th>적요</th>
                    <th>금액</th>
                    <th>비목</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 6).map((row, index) => {
                    const line = budgetLines.find((item) => item.id === resolved.inputs[index]?.budgetLineId);
                    return (
                      <tr key={index}>
                        <td data-label="사용일자">{row.spentAt || "—"}</td>
                        <td data-label="거래처">{row.vendor || "—"}</td>
                        <td data-label="적요">{row.description || "—"}</td>
                        <td data-label="금액">{formatWon(row.amount)}</td>
                        <td data-label="비목">{line?.category || "미지정"}</td>
                        <td data-label="상태">{row.status === "paid" ? "집행 완료" : row.status === "pending" ? "지출 예정" : "계획만"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {parsed.rows.length > 6 && <p className="block-note">전체 {parsed.rows.length}줄 중 6줄만 보여 줍니다. 가져오면 전부 들어갑니다.</p>}
          {parsed.warnings.length > 0 && (
            <ul className="pc-warning-list">
              {parsed.warnings.slice(0, 6).map((warning, index) => <li key={index}>{warning}</li>)}
              {parsed.warnings.length > 6 && <li>그 밖에 {parsed.warnings.length - 6}건의 안내가 있습니다.</li>}
            </ul>
          )}
          <div className="draft-actions">
            <button className="primary-button" type="button" onClick={apply} disabled={!fresh.length}>
              지출 {fresh.length}건 · {formatWon(totalAmount)} 원장에 더하기
            </button>
            <button className="ghost-light-button" type="button" onClick={() => setText("")} disabled={!text}>비우기</button>
          </div>
        </div>
      )}
    </section>
  );
}
