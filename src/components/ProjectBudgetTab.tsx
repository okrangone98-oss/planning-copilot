import type { GrantBudgetLine, GrantPlan, SectionId } from "../types";
import type { ProjectMeta } from "../lib/projectWorkspace.mjs";
import { budgetSummary, formatWon } from "../lib/grantWorkflow.mjs";
import { BudgetImportPanel } from "./BudgetImportPanel";

/**
 * 예산·집행 탭.
 * 금액의 유일한 원천은 grantPlan.budgetLines이고, 이 화면은 그 합계를 보여 주기만 한다(복제 합산 없음).
 * 표 편집과 시트 가져오기는 기존 부품(BudgetImportPanel·예산 편성 화면)을 그대로 쓴다.
 */
export function ProjectBudgetTab({
  meta,
  plan,
  onChangeLines,
  notify,
  onNavigate
}: {
  meta: ProjectMeta;
  plan: GrantPlan;
  onChangeLines: (lines: GrantBudgetLine[]) => void;
  notify: (message: string) => void;
  onNavigate: (section: SectionId) => void;
}) {
  const summary = budgetSummary(plan);
  const funding = summary.funding;
  const maxCategory = summary.byCategory.reduce((max, item) => Math.max(max, item.total), 0);

  return (
    <div className="pc-budget">
      <div className="pc-stat-row" aria-label="예산 요약">
        <div className="pc-stat is-wide"><span>계획액</span><strong>{formatWon(summary.total)}</strong></div>
        <div className="pc-stat"><span>비목</span><strong>{summary.lineCount}</strong></div>
        <div className="pc-stat"><span>국비</span><strong>{formatWon(funding.subsidy)}</strong></div>
        <div className="pc-stat"><span>지방비</span><strong>{formatWon(funding.local)}</strong></div>
        <div className="pc-stat"><span>자부담</span><strong>{formatWon(funding.self)}</strong></div>
      </div>

      {funding.rateMismatch && (
        <p className="pc-notice is-warning">
          재원 비율 합계가 {funding.rateSum}%입니다. 국비·지방비·자부담 비율을 100%로 맞춰 주세요.
        </p>
      )}

      <div className="block-head">
        <h3>비목별 합계</h3>
        <button className="block-link" type="button" onClick={() => onNavigate("grantBudget")}>예산 편성 화면에서 편집</button>
      </div>
      {summary.byCategory.length === 0 ? (
        <div className="office-empty">
          <strong>아직 예산 비목이 없습니다.</strong>
          <span>구글 시트·CSV를 그대로 붙여넣거나 예산 편성 화면에서 비목을 채우세요. 여기 합계와 예산 편성 화면은 같은 데이터를 봅니다.</span>
        </div>
      ) : (
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
        {meta.name} · 계획액은 위 합계 하나입니다. 지출 원장(집행·잔액)과 증빙 인덱스는 2단계에서 이 화면에 붙습니다.
      </p>
    </div>
  );
}
