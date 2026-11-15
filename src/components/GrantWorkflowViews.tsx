import { useMemo, useState } from "react";
import type { GrantBudgetLine, GrantChecklistItem, GrantPlan, GrantPreset, ProjectData } from "../types";
import { budgetSummary, checklistSummary, emptyBudgetLine, formatWon, groupChecklist, lineAmount, reportSummary, toText } from "../lib/grantWorkflow.mjs";
import { attendanceReport, expenseSummary, type ProjectWork } from "../lib/projectOperations.mjs";
import { BudgetImportPanel } from "./BudgetImportPanel";

type GrantViewProps = {
  plan: GrantPlan;
  onChange: (patch: Partial<GrantPlan>) => void;
  notify: (message: string) => void;
};

/** 다른 사업의 지출·증빙 누락 요약(정산 화면에서 사업을 넘겨 볼 때). */
export type EvidenceRollup = {
  projectId: string;
  projectName: string;
  total: number;
  missing: number;
  amount: number;
};

const CATEGORY_SUGGESTIONS = ["인건비", "운영비", "사업비", "홍보비", "여비", "일반수용비", "시설·장비비", "기타"];

/**
 * 단가 입력칸을 벗어날 때 1,100,000 처럼 읽기 쉬운 숫자로 바꾼다.
 * "25만원" 같은 손글씨 표기는 뜻이 달라질 수 있으므로 그대로 둔다.
 */
function formatAmountInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /만|천/.test(trimmed)) return value;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return value;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function NumberField({
  label,
  value,
  onChange,
  placeholder = "",
  type = "text",
  wide = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={type === "text" ? "numeric" : undefined} />
    </label>
  );
}

/** 단가 입력칸: 쉬는 동안은 "250,000"처럼 콤마로, 입력 중에는 친 그대로 둔다. */
function AmountInput({
  value,
  onChange,
  ariaLabel,
  placeholder = "250,000"
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const display = focused ? value : formatAmountInput(value);
  return (
    <input
      value={display}
      placeholder={placeholder}
      inputMode="numeric"
      aria-label={ariaLabel}
      onFocus={() => {
        setFocused(true);
        if (display !== value) onChange(display);
      }}
      onChange={(event) => onChange(event.target.value)}
      onBlur={(event) => {
        setFocused(false);
        onChange(formatAmountInput(event.target.value));
      }}
    />
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder = "",
  wide = false,
  rows = 4
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  wide?: boolean;
  rows?: number;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function PlanHeaderFields({ plan, onChange }: GrantViewProps) {
  return (
    <div className="form-grid">
      <label className="field">
        <span>사업명</span>
        <input value={plan.programName} onChange={(event) => onChange({ programName: event.target.value })} placeholder="예: 2026 양양 두레동아리 활동지원" />
      </label>
      <label className="field">
        <span>회계연도</span>
        <input value={plan.fundingYear} onChange={(event) => onChange({ fundingYear: event.target.value })} placeholder="2026" inputMode="numeric" />
      </label>
      <label className="field">
        <span>지원·발주기관</span>
        <input value={plan.agency} onChange={(event) => onChange({ agency: event.target.value })} placeholder="농림축산식품부 · 양양군" />
      </label>
      <label className="field">
        <span>재원</span>
        <input value={plan.fundingSource} onChange={(event) => onChange({ fundingSource: event.target.value })} placeholder="국고보조금" />
      </label>
    </div>
  );
}

export function GrantBudgetView({
  plan,
  onChange,
  onApplyPreset,
  presets,
  hasWork,
  notify,
  project
}: GrantViewProps & {
  presets: GrantPreset[];
  hasWork: boolean;
  onApplyPreset: (presetId: string) => void;
  project: ProjectData;
}) {
  const summary = useMemo(() => budgetSummary(plan), [plan]);
  const [selectedPreset, setSelectedPreset] = useState(plan.presetId || presets[0]?.id || "");
  // 모바일 아코디언: 기본은 요약 1줄, 연 행만 상세 입력을 보여 준다. 새로 추가한 행은 펼친 채로 시작한다.
  const [openRows, setOpenRows] = useState<string[]>([]);
  const rowKey = (line: GrantBudgetLine, index: number) => line.id || `row-${index}`;
  const isRowOpen = (line: GrantBudgetLine, index: number) => openRows.includes(rowKey(line, index));
  const toggleRow = (line: GrantBudgetLine, index: number) => {
    const key = rowKey(line, index);
    setOpenRows((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const updateLine = (index: number, patch: Partial<GrantBudgetLine>) => {
    const next = plan.budgetLines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line));
    onChange({ budgetLines: next });
  };

  const removeLine = (index: number) => {
    const key = rowKey(plan.budgetLines[index], index);
    setOpenRows((current) => current.filter((item) => item !== key));
    onChange({ budgetLines: plan.budgetLines.filter((_, lineIndex) => lineIndex !== index) });
  };

  const addLine = () => {
    const line = emptyBudgetLine(`line-${Date.now()}`);
    onChange({ budgetLines: [...plan.budgetLines, line] });
    setOpenRows((current) => [...current, line.id]);
  };

  const apply = () => {
    if (!selectedPreset) {
      notify("적용할 프리셋을 골라 주세요.");
      return;
    }
    if (hasWork && !window.confirm("현재 예산표·체크 상태가 있는 항목은 프리셋 값으로 바뀝니다. 같은 항목의 점검 상태와 메모는 유지합니다. 계속할까요?")) return;
    onApplyPreset(selectedPreset);
  };

  const fillNameFromProject = () => {
    if (plan.programName.trim()) {
      notify("이미 사업명이 있습니다. 필요하면 직접 고쳐 주세요.");
      return;
    }
    onChange({ programName: project.projectName });
    notify("프로젝트명을 사업명으로 가져왔습니다.");
  };

  return (
    <div className="grant-layout">
      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>프리셋 선택</strong>
            <span>국고보조사업 기준 비목·증빙·결과보고 골격을 한 번에 채웁니다. 적용 후 자유롭게 고칠 수 있습니다.</span>
          </div>
          <button className="secondary-button" type="button" onClick={apply}>프리셋 적용</button>
        </div>
        <div className="grant-preset-grid">
          {presets.map((preset) => (
            <button
              className={`grant-preset-card ${selectedPreset === preset.id ? "is-active" : ""}`}
              key={preset.id}
              type="button"
              onClick={() => setSelectedPreset(preset.id)}
            >
              <strong>{preset.name}</strong>
              <span>{preset.summary}</span>
              <small>비목 {preset.budgetLines.length} · 증빙 {preset.checklist.length} · 보고서 {preset.reportSections.length}섹션</small>
            </button>
          ))}
        </div>
      </section>

      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>사업 기본 정보</strong>
            <span>교부 결정서·협약서와 같은 표기로 적어 두면 결과보고와 내보내기에 그대로 씁니다.</span>
          </div>
          <button className="ghost-light-button" type="button" onClick={fillNameFromProject}>프로젝트명 가져오기</button>
        </div>
        <PlanHeaderFields plan={plan} onChange={onChange} notify={notify} />
        <div className="form-grid">
          <NumberField label="국비(%)" value={plan.subsidyRate} onChange={(subsidyRate) => onChange({ subsidyRate })} placeholder="70" />
          <NumberField label="지방비(%)" value={plan.localRate} onChange={(localRate) => onChange({ localRate })} placeholder="20" />
          <NumberField label="자부담(%)" value={plan.selfRate} onChange={(selfRate) => onChange({ selfRate })} placeholder="10" />
          <label className="field">
            <span>프리셋</span>
            <input value={plan.presetName || "직접 구성"} readOnly />
          </label>
        </div>
      </section>

      <section className="grant-summary" aria-label="예산 요약">
        <div><span>예산 총액</span><strong>{formatWon(summary.total)}</strong></div>
        <div><span>국비</span><strong>{formatWon(summary.funding.subsidy)}</strong></div>
        <div><span>지방비</span><strong>{formatWon(summary.funding.local)}</strong></div>
        <div><span>자부담</span><strong>{formatWon(summary.funding.self)}</strong></div>
        <div><span>비목</span><strong>{summary.lineCount}개</strong></div>
      </section>
      {summary.funding.rateMismatch && (
        <p className="grant-warning">입력한 비율 합이 {summary.funding.rateSum}%입니다. 합이 100%가 아니면 자부담을 잔액으로 계산합니다.</p>
      )}

      <BudgetImportPanel
        lines={plan.budgetLines}
        onChange={(budgetLines) => onChange({ budgetLines })}
        notify={notify}
      />

      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>비목별 예산 편성표</strong>
            <span>단가는 숫자로, 수량은 "8" 또는 "8회"로 적어도 됩니다. 금액은 자동 계산됩니다.</span>
          </div>
          <button className="secondary-button" type="button" onClick={addLine}>항목 추가</button>
        </div>
        {plan.budgetLines.length ? (
          <>
            <datalist id="grant-category-list">
              {CATEGORY_SUGGESTIONS.map((category) => <option key={category} value={category} />)}
            </datalist>
            {/* 데스크톱·태블릿: 한눈에 비교하는 표 */}
            <div className="budget-desktop table-wrap grant-table-wrap">
              <table className="grant-table">
                <thead>
                  <tr>
                    <th>비목</th>
                    <th>세목</th>
                    <th>단가</th>
                    <th>수량</th>
                    <th>금액</th>
                    <th>산출근거</th>
                    <th>비고</th>
                    <th aria-label="삭제" />
                  </tr>
                </thead>
                <tbody>
                  {plan.budgetLines.map((line, index) => (
                    <tr key={line.id || index}>
                      <td data-label="비목">
                        <input list="grant-category-list" value={line.category} placeholder="인건비" aria-label={`${index + 1}행 비목`} onChange={(event) => updateLine(index, { category: event.target.value })} />
                      </td>
                      <td data-label="세목">
                        <input value={line.item} placeholder="외래강사비" aria-label={`${index + 1}행 세목`} onChange={(event) => updateLine(index, { item: event.target.value })} />
                      </td>
                      <td data-label="단가">
                        <AmountInput
                          value={line.unitCost}
                          ariaLabel={`${index + 1}행 단가`}
                          onChange={(unitCost) => updateLine(index, { unitCost })}
                        />
                      </td>
                      <td data-label="수량">
                        <input value={line.quantity} placeholder="8회" aria-label={`${index + 1}행 수량`} onChange={(event) => updateLine(index, { quantity: event.target.value })} />
                      </td>
                      <td className="grant-amount" data-label="금액">{formatWon(lineAmount(line))}</td>
                      <td data-label="산출근거">
                        <input value={line.basis} placeholder="250,000원 × 8회" aria-label={`${index + 1}행 산출근거`} onChange={(event) => updateLine(index, { basis: event.target.value })} />
                      </td>
                      <td data-label="비고">
                        <input value={line.note} placeholder="메모" aria-label={`${index + 1}행 비고`} onChange={(event) => updateLine(index, { note: event.target.value })} />
                      </td>
                      <td className="grant-row-actions" data-label="">
                        <button className="ghost-light-button grant-row-remove" type="button" onClick={() => removeLine(index)} aria-label={`${index + 1}행 ${line.item || "항목"} 삭제`}>삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 모바일·좁은 화면: 비목·세목·금액 요약 1줄 + 탭해서 상세 입력 */}
            <ul className="budget-accordion" aria-label="비목별 예산 편성표 요약">
              {plan.budgetLines.map((line, index) => {
                const open = isRowOpen(line, index);
                return (
                  <li className={`budget-acc-item ${open ? "is-open" : ""}`} key={line.id || index}>
                    <button
                      className="budget-acc-head"
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggleRow(line, index)}
                    >
                      <span className="budget-acc-main">
                        <strong>{line.category || "비목 미입력"}</strong>
                        <span>{line.item || "세목 미입력"}</span>
                      </span>
                      <span className="budget-acc-amount">{formatWon(lineAmount(line))}</span>
                      <span className="budget-acc-caret" aria-hidden="true" />
                    </button>
                    {open && (
                      <div className="budget-acc-body">
                        <label className="budget-acc-field">
                          <span>비목</span>
                          <input list="grant-category-list" value={line.category} placeholder="인건비" aria-label={`${index + 1}행 비목(모바일)`} onChange={(event) => updateLine(index, { category: event.target.value })} />
                        </label>
                        <label className="budget-acc-field">
                          <span>세목</span>
                          <input value={line.item} placeholder="외래강사비" aria-label={`${index + 1}행 세목(모바일)`} onChange={(event) => updateLine(index, { item: event.target.value })} />
                        </label>
                        <label className="budget-acc-field">
                          <span>단가</span>
                          <AmountInput
                            value={line.unitCost}
                            ariaLabel={`${index + 1}행 단가(모바일)`}
                            onChange={(unitCost) => updateLine(index, { unitCost })}
                          />
                        </label>
                        <label className="budget-acc-field">
                          <span>수량</span>
                          <input value={line.quantity} placeholder="8회" aria-label={`${index + 1}행 수량(모바일)`} onChange={(event) => updateLine(index, { quantity: event.target.value })} />
                        </label>
                        <label className="budget-acc-field wide">
                          <span>산출근거</span>
                          <input value={line.basis} placeholder="250,000원 × 8회" aria-label={`${index + 1}행 산출근거(모바일)`} onChange={(event) => updateLine(index, { basis: event.target.value })} />
                        </label>
                        <label className="budget-acc-field wide">
                          <span>비고</span>
                          <input value={line.note} placeholder="메모" aria-label={`${index + 1}행 비고(모바일)`} onChange={(event) => updateLine(index, { note: event.target.value })} />
                        </label>
                        <div className="budget-acc-foot">
                          <span>금액 {formatWon(lineAmount(line))}</span>
                          <button className="ghost-light-button grant-row-remove" type="button" onClick={() => removeLine(index)} aria-label={`${index + 1}행 ${line.item || "항목"} 삭제`}>삭제</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="office-empty">
            <strong>편성된 비목이 없습니다.</strong>
            <span>위에서 프리셋을 적용하거나 항목 추가로 직접 편성표를 만드세요.</span>
          </div>
        )}
        {summary.byCategory.length > 0 && (
          <div className="grant-category-summary">
            {summary.byCategory.map((entry) => (
              <span key={entry.category}>{entry.category} {formatWon(entry.total)} · {entry.share}%</span>
            ))}
          </div>
        )}
      </section>

      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>추진 일정·마감</strong>
            <span>여기에 적은 날짜가 내보내기 문서의 마감 요약과 후속 할 일이 됩니다.</span>
          </div>
        </div>
        <div className="form-grid">
          <label className="field"><span>신청·교부 마감</span><input type="date" value={plan.schedule.applyDeadline} onChange={(event) => onChange({ schedule: { ...plan.schedule, applyDeadline: event.target.value } })} /></label>
          <label className="field"><span>사업 시작</span><input type="date" value={plan.schedule.projectStart} onChange={(event) => onChange({ schedule: { ...plan.schedule, projectStart: event.target.value } })} /></label>
          <label className="field"><span>사업 종료</span><input type="date" value={plan.schedule.projectEnd} onChange={(event) => onChange({ schedule: { ...plan.schedule, projectEnd: event.target.value } })} /></label>
          <label className="field"><span>정산 마감</span><input type="date" value={plan.schedule.settlementDeadline} onChange={(event) => onChange({ schedule: { ...plan.schedule, settlementDeadline: event.target.value } })} /></label>
          <label className="field"><span>결과보고 마감</span><input type="date" value={plan.schedule.reportDeadline} onChange={(event) => onChange({ schedule: { ...plan.schedule, reportDeadline: event.target.value } })} /></label>
        </div>
        <TextField label="일정 메모" value={plan.schedule.memo} onChange={(memo) => onChange({ schedule: { ...plan.schedule, memo } })} rows={3} wide placeholder="예: 군 담당자 제출은 마감 3일 전, 증빙 원본은 사무국 보관" />
      </section>

      <TextField label="예산·정산 메모" value={plan.memo} onChange={(memo) => onChange({ memo })} rows={5} wide placeholder="예: 비목 간 전용은 총액 20% 이내, 강사비 단가 인상은 사전 승인 필요" />
    </div>
  );
}

export function GrantChecklistView({
  plan,
  work,
  evidenceRollup,
  activeProjectId,
  onOpenBudget,
  onChange,
  notify
}: GrantViewProps & {
  /** 현재 사업의 지출 원장. 없으면 누락 요약을 건너뛴다. */
  work?: ProjectWork | null;
  /** 사업별 지출·증빙 누락(현재 사업 포함). */
  evidenceRollup?: EvidenceRollup[];
  activeProjectId?: string;
  /** 사업의 예산·집행 탭을 연다. 없으면 요약만 보여 준다. */
  onOpenBudget?: (projectId: string) => void;
}) {
  const summary = useMemo(() => checklistSummary(plan), [plan]);
  const groups = useMemo(() => groupChecklist(plan), [plan]);
  const ledger = useMemo(() => expenseSummary(work, plan), [work, plan]);
  const [filter, setFilter] = useState<"all" | "open" | "required">("all");
  const [newItem, setNewItem] = useState({ group: "", label: "" });
  const rollup = (evidenceRollup || []).filter((item) => item.missing > 0);

  const updateItem = (id: string, patch: Partial<GrantChecklistItem>) => {
    onChange({ checklist: plan.checklist.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };

  const visible = (item: GrantChecklistItem) => {
    if (filter === "open") return !item.checked;
    if (filter === "required") return item.required;
    return true;
  };

  const addItem = () => {
    const label = newItem.label.trim();
    if (!label) {
      notify("추가할 점검 항목을 입력해 주세요.");
      return;
    }
    onChange({
      checklist: [
        ...plan.checklist,
        {
          id: `check-custom-${Date.now()}`,
          group: newItem.group.trim() || "직접 추가",
          label,
          basis: "",
          required: true,
          checked: false,
          note: ""
        }
      ]
    });
    setNewItem({ group: newItem.group, label: "" });
    notify("점검 항목을 추가했습니다.");
  };

  const checkAllInGroup = (groupTitle: string, checked: boolean) => {
    onChange({
      checklist: plan.checklist.map((item) => (toText(item.group, 60) === groupTitle ? { ...item, checked } : item))
    });
  };

  return (
    <div className="grant-layout">
      <section className="grant-block pc-evidence-rollup" aria-label="지출·증빙 누락 요약">
        <div className="grant-block-head">
          <div>
            <strong>지출·증빙 누락</strong>
            <span>예산·집행 탭의 지출 원장과 같은 데이터입니다. 증빙 확인을 하지 않은 지출만 골라 보여 줍니다.</span>
          </div>
          {onOpenBudget && (
            <button className="secondary-button" type="button" onClick={() => onOpenBudget(activeProjectId || "")}>
              지출 원장 열기
            </button>
          )}
        </div>
        {ledger.expenseCount === 0 ? (
          <p className="block-note">
            이 사업에는 아직 지출 기록이 없습니다. 사업 상세 → `예산·집행`에서 지출을 적거나 엑셀·시트 내역을 붙여넣으면 여기에 누락이 모입니다.
          </p>
        ) : (
          <>
            <div className="grant-summary" aria-label="지출·증빙 요약">
              <div><span>지출</span><strong>{ledger.expenseCount}건</strong></div>
              <div><span>증빙 대상</span><strong>{ledger.evidence.total}건</strong></div>
              <div className={ledger.evidence.missing ? "is-warning" : ""}><span>증빙 미확인</span><strong>{ledger.evidence.missing}건</strong></div>
              <div><span>미확인 금액</span><strong>{formatWon(ledger.evidence.missingAmount)}</strong></div>
            </div>
            {ledger.evidence.items.length > 0 && (
              <ul className="pc-evidence-list">
                {ledger.evidence.items.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <span className="pc-evidence-date">{item.spentAt || "날짜 없음"}</span>
                    <span className="pc-evidence-main">{item.description || item.vendor || "지출"}</span>
                    <span className="pc-evidence-meta">{item.category} · {formatWon(item.amount)}</span>
                  </li>
                ))}
                {ledger.evidence.items.length > 8 && (
                  <li className="pc-evidence-more">외 {ledger.evidence.items.length - 8}건은 예산·집행 탭에서 확인하세요.</li>
                )}
              </ul>
            )}
            {rollup.length > 1 && (
              <ul className="pc-evidence-projects">
                {rollup.map((item) => (
                  <li key={item.projectId}>
                    <button
                      className={`ghost-light-button ${item.projectId === activeProjectId ? "is-on" : ""}`}
                      type="button"
                      onClick={() => onOpenBudget?.(item.projectId)}
                    >
                      {item.projectName} · 미확인 {item.missing}건 ({formatWon(item.amount)})
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="grant-summary" aria-label="증빙 점검 요약">
        <div><span>전체 항목</span><strong>{summary.total}</strong></div>
        <div><span>확인 완료</span><strong>{summary.done}</strong></div>
        <div><span>필수 완료</span><strong>{summary.requiredDone}/{summary.requiredTotal}</strong></div>
        <div><span>남은 필수</span><strong>{summary.requiredMissing.length}</strong></div>
        <div><span>진행률</span><strong>{summary.percent}%</strong></div>
      </section>
      <div className="grant-progress" role="progressbar" aria-valuenow={summary.percent} aria-valuemin={0} aria-valuemax={100} aria-label="증빙 점검 진행률">
        <i style={{ width: `${summary.percent}%` }} />
      </div>

      <div className="grant-filter-row">
        <div className="grant-filter-buttons">
          <button className={`secondary-button ${filter === "all" ? "is-on" : ""}`} type="button" onClick={() => setFilter("all")}>전체</button>
          <button className={`secondary-button ${filter === "open" ? "is-on" : ""}`} type="button" onClick={() => setFilter("open")}>미완료</button>
          <button className={`secondary-button ${filter === "required" ? "is-on" : ""}`} type="button" onClick={() => setFilter("required")}>필수만</button>
        </div>
        <span className="muted-inline">체크 상태는 이 브라우저에 저장됩니다. 증빙 원본은 로컬·Drive에 두세요.</span>
      </div>

      {groups.length ? (
        groups.map((group) => {
          const items = group.items.filter(visible);
          if (!items.length) return null;
          return (
            <section className="grant-check-group" key={group.title}>
              <div className="grant-check-group-head">
                <strong>{group.title}</strong>
                <div className="grant-check-group-actions">
                  <span>{group.items.filter((item) => item.checked).length}/{group.items.length}</span>
                  <button className="ghost-light-button" type="button" onClick={() => checkAllInGroup(group.title, true)}>전체 확인</button>
                  <button className="ghost-light-button" type="button" onClick={() => checkAllInGroup(group.title, false)}>해제</button>
                </div>
              </div>
              <ul className="grant-check-list">
                {items.map((item) => (
                  <li key={item.id} className={item.checked ? "is-checked" : ""}>
                    <label className="grant-check-main">
                      <input type="checkbox" checked={item.checked} onChange={(event) => updateItem(item.id, { checked: event.target.checked })} />
                      <span>
                        <strong>{item.label}</strong>
                        {item.required && <em className="grant-chip">필수</em>}
                        {item.basis && <small>{item.basis}</small>}
                      </span>
                    </label>
                    <input
                      className="grant-check-note"
                      value={item.note}
                      placeholder="확인 메모(담당·보관 위치 등)"
                      onChange={(event) => updateItem(item.id, { note: event.target.value })}
                    />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <div className="office-empty">
          <strong>점검 항목이 없습니다.</strong>
          <span>예산 편성 화면에서 프리셋을 적용하거나 아래에서 직접 항목을 추가하세요.</span>
        </div>
      )}

      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>점검 항목 추가</strong>
            <span>기관 양식에만 있는 항목은 여기에 더해 두면 내보내기 체크리스트에 함께 들어갑니다.</span>
          </div>
          <button className="secondary-button" type="button" onClick={addItem}>항목 추가</button>
        </div>
        <div className="form-grid">
          <label className="field"><span>구분</span><input value={newItem.group} placeholder="예: 정산 마감" onChange={(event) => setNewItem({ ...newItem, group: event.target.value })} /></label>
          <label className="field"><span>점검 항목</span><input value={newItem.label} placeholder="예: 군 담당자 정산서 접수 확인" onChange={(event) => setNewItem({ ...newItem, label: event.target.value })} /></label>
        </div>
      </section>
    </div>
  );
}

function sectionDraftFromProject(project: ProjectData, title: string) {
  const t = title.replace(/\s/g, "");
  if (/추진배경|사업배경/.test(t)) return [project.problemSituation, project.whyNow].filter(Boolean).join("\n");
  if (/사업개요/.test(t)) return [project.coreIdea, project.targetUsers, project.milestones].filter(Boolean).join("\n");
  if (/운영결과|추진실적|추진경과/.test(t)) return [project.activities, project.outputs].filter(Boolean).join("\n");
  if (/주요성과/.test(t)) return [project.shortOutcomes, project.longOutcomes].filter(Boolean).join("\n");
  if (/문제점|개선/.test(t)) return [project.riskPlan, project.missingEvidence].filter(Boolean).join("\n");
  if (/예산집행/.test(t)) return project.budgetPlan;
  if (/향후|확산/.test(t)) return project.longOutcomes;
  return "";
}

export function GrantReportView({
  plan,
  onChange,
  notify,
  project,
  work,
  onNavigate
}: GrantViewProps & {
  project: ProjectData;
  /** 회차·지출 원장. 있으면 참석 연인원·예산/집행/잔액을 자동으로 채워 보여 준다. */
  work?: ProjectWork | null;
  onNavigate: (section: "grantBudget" | "grantChecklist") => void;
}) {
  const summary = useMemo(() => reportSummary(plan), [plan]);
  const attendance = useMemo(() => attendanceReport(work), [work]);
  const ledger = useMemo(() => expenseSummary(work, plan), [work, plan]);
  const [targetSection, setTargetSection] = useState("");

  const suggestedSection = useMemo(() => {
    const sections = plan.reportSections || [];
    const byKeyword = sections.find((section) => /운영\s*결과|추진\s*실적|사업\s*실적|주요\s*성과|예산\s*집행/.test(section.title));
    if (byKeyword) return byKeyword;
    return sections.find((section) => !section.content.trim()) || sections[0] || null;
  }, [plan.reportSections]);
  const effectiveTargetId = targetSection || suggestedSection?.id || "";

  /** 결과보고에 넣을 요약 문단. 숫자는 회차·지출 원장에서 계산하고, 빠진 것을 함께 적는다. */
  const autoSummary = useMemo(() => {
    if (!work) return "";
    const lines = ["[자동 집계 · 회차·예산에서 계산]"];
    if (attendance.sessionTotal) {
      lines.push(
        `· 회차: 전체 ${attendance.sessionTotal}회 · 집계 대상 ${attendance.tracked}회 · 완료 ${attendance.doneSessions}회${attendance.cancelled ? ` · 취소 ${attendance.cancelled}회` : ""}`
      );
      lines.push(
        attendance.tracked
          ? `· 참석 연인원: ${attendance.attended}명 (완료 회차 ${attendance.attendedDone}명)`
          : "· 참석 연인원: 인원을 기록한 회차가 없습니다(0명이 아니라 집계 제외)"
      );
      if (attendance.missingCount) lines.push(`  - 참석을 적지 않은 ${attendance.missingCount}회차는 합계에 넣지 않았습니다.`);
      if (attendance.untracked) lines.push(`  - 인원 기록을 꺼 둔 ${attendance.untracked}회차는 집계 제외입니다.`);
    }
    if (ledger.expenseCount || ledger.total.plan) {
      lines.push(
        `· 예산: 편성 ${formatWon(ledger.total.plan)} / 집행 ${formatWon(ledger.total.spent)} (완료 ${formatWon(ledger.total.paid)} · 예정 ${formatWon(ledger.total.pending)}) / 잔액 ${formatWon(ledger.total.balance)}${ledger.total.plan ? ` (집행률 ${ledger.total.rate}%)` : ""}`
      );
      lines.push(`· 증빙: 대상 ${ledger.evidence.total}건 중 ${ledger.evidence.checked}건 확인${ledger.evidence.missing ? `, 미확인 ${ledger.evidence.missing}건(${formatWon(ledger.evidence.missingAmount)})` : ""}`);
    }
    lines.push("· 제출 전 실제 증빙·출석부와 대조해 수치를 확인해 주세요.");
    return lines.join("\n");
  }, [work, attendance, ledger]);

  const insertSummary = () => {
    if (!autoSummary) return;
    const target = (plan.reportSections || []).find((section) => section.id === effectiveTargetId);
    if (!target) {
      notify("넣을 섹션을 골라 주세요. 결과보고 골격이 없으면 예산 편성에서 프리셋을 적용하세요.");
      return;
    }
    if (target.content.includes("[자동 집계")) {
      notify(`‘${target.title}’에 이미 자동 집계가 있습니다. 새 수치로 바꾸려면 그 부분을 지우고 다시 넣어 주세요.`);
      return;
    }
    const content = target.content.trim() ? `${target.content.trim()}\n\n${autoSummary}` : autoSummary;
    onChange({ reportSections: plan.reportSections.map((section) => (section.id === target.id ? { ...section, content } : section)) });
    notify(`‘${target.title}’ ${target.content.trim() ? "끝에" : "에"} 운영 실적·예산 수치를 넣었습니다. 문장은 직접 다듬어 주세요.`);
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(autoSummary);
      notify("운영 실적·예산 요약을 복사했습니다.");
    } catch {
      notify("복사하지 못했습니다. 브라우저가 클립보드를 막았는지 확인해 주세요.");
    }
  };

  const updateSection = (id: string, content: string) => {
    onChange({ reportSections: plan.reportSections.map((section) => (section.id === id ? { ...section, content } : section)) });
  };

  const prefillFromProject = () => {
    if (!plan.reportSections.length) {
      notify("먼저 결과보고 골격을 만들어 주세요. 예산 편성 화면에서 프리셋을 적용하면 만들어집니다.");
      return;
    }
    let filled = 0;
    const next = plan.reportSections.map((section) => {
      if (section.content.trim()) return section;
      const draft = sectionDraftFromProject(project, section.title).trim();
      if (!draft) return section;
      filled += 1;
      return { ...section, content: `${draft}\n\n> 프로젝트 입력값에서 가져온 초안입니다. 수치와 사실을 확인한 뒤 고쳐 주세요.` };
    });
    onChange({ reportSections: next });
    notify(filled ? `${filled}개 섹션을 프로젝트 입력값으로 채웠습니다.` : "프로젝트에 옮길 입력값이 없습니다.");
  };

  return (
    <div className="grant-layout">
      <section className="grant-summary" aria-label="결과보고 요약">
        <div><span>섹션</span><strong>{summary.total}</strong></div>
        <div><span>작성</span><strong>{summary.written}</strong></div>
        <div><span>미작성</span><strong>{summary.missing.length}</strong></div>
        <div><span>진행률</span><strong>{summary.percent}%</strong></div>
      </section>
      <div className="grant-progress" role="progressbar" aria-valuenow={summary.percent} aria-valuemin={0} aria-valuemax={100} aria-label="결과보고 작성률">
        <i style={{ width: `${summary.percent}%` }} />
      </div>

      <div className="coach-bar">
        <div><strong>프로젝트 입력값으로 초안 채우기</strong><span>문제정의·실행설계·성과지표에 적어 둔 내용을 비어 있는 섹션에만 넣습니다. 기존 글은 건드리지 않습니다.</span></div>
        <button className="secondary-button" type="button" onClick={prefillFromProject}>초안 채우기</button>
      </div>

      {work && (attendance.sessionTotal > 0 || ledger.expenseCount > 0) && (
        <section className="grant-block pc-report-auto" aria-label="운영 실적 자동 반영">
          <div className="grant-block-head">
            <div>
              <strong>운영 실적·예산 자동 반영</strong>
              <span>회차 탭의 참석 연인원과 예산·집행 탭의 계획/집행/잔액을 그대로 계산합니다. 넣기 전에 숫자가 맞는지 먼저 보세요.</span>
            </div>
            <span className="block-count">{attendance.tracked ? `집계 대상 ${attendance.tracked}회` : "인원 기록 없음"}</span>
          </div>
          <div className="grant-summary" aria-label="운영 실적 요약">
            <div><span>참석 연인원</span><strong>{attendance.tracked ? `${attendance.attended}명` : "—"}</strong></div>
            <div><span>완료 회차 참석</span><strong>{attendance.doneSessions ? `${attendance.attendedDone}명` : "—"}</strong></div>
            <div><span>편성 예산</span><strong>{formatWon(ledger.total.plan)}</strong></div>
            <div><span>집행액</span><strong>{formatWon(ledger.total.spent)}</strong></div>
            <div className={ledger.total.balance < 0 ? "is-warning" : ""}><span>잔액</span><strong>{formatWon(ledger.total.balance)}</strong></div>
            <div className={ledger.evidence.missing ? "is-warning" : ""}><span>증빙 미확인</span><strong>{ledger.evidence.missing}건</strong></div>
          </div>
          {(attendance.missingCount > 0 || attendance.untracked > 0 || !attendance.tracked) && (
            <p className="pc-notice is-warning">
              {!attendance.tracked
                ? "인원을 기록한 회차가 없습니다. 참석 0명이 아니라 집계 제외입니다. 회차 탭에서 ‘인원 켜기’로 기록하면 여기에 들어옵니다."
                : [
                  attendance.missingCount ? `참석을 적지 않은 ${attendance.missingCount}회차는 합계에서 빼 두었습니다(0명으로 세지 않음).` : "",
                  attendance.untracked ? `인원 기록을 꺼 둔 ${attendance.untracked}회차는 집계 제외입니다.` : ""
                ].filter(Boolean).join(" ")}
            </p>
          )}
          {autoSummary && <pre className="pc-auto-text">{autoSummary}</pre>}
          <div className="pc-auto-actions">
            <label className="field">
              <span>넣을 섹션</span>
              <select value={effectiveTargetId} onChange={(event) => setTargetSection(event.target.value)}>
                {(plan.reportSections || []).map((section) => (
                  <option key={section.id} value={section.id}>{section.title}{section.content.trim() ? " (작성함)" : " (비어 있음)"}</option>
                ))}
              </select>
            </label>
            <div className="draft-actions">
              <button className="primary-button" type="button" onClick={insertSummary} disabled={!plan.reportSections.length}>섹션에 넣기</button>
              <button className="secondary-button" type="button" onClick={() => { void copySummary(); }}>복사</button>
            </div>
          </div>
          <p className="block-note">넣으면 기존 글은 지우지 않고 섹션 끝에 덧붙입니다. 넣은 뒤에는 직접 문장을 다듬어 주세요.</p>
        </section>
      )}

      {plan.reportSections.length ? (
        plan.reportSections.map((section) => (
          <label className="field grant-report-section" key={section.id}>
            <span>{section.title}{section.hint ? ` · ${section.hint}` : ""}</span>
            <textarea
              rows={6}
              value={section.content}
              placeholder={section.hint ? `${section.hint} 내용을 적어 주세요.` : "내용을 적어 주세요."}
              onChange={(event) => updateSection(section.id, event.target.value)}
            />
          </label>
        ))
      ) : (
        <div className="office-empty">
          <strong>결과보고 골격이 없습니다.</strong>
          <span>예산 편성 화면에서 프리셋을 적용하면 기관 양식에 맞는 섹션이 만들어집니다.</span>
          <button className="secondary-button office-empty-action" type="button" onClick={() => onNavigate("grantBudget")}>
            프리셋으로 골격 만들기 →
          </button>
        </div>
      )}
    </div>
  );
}
