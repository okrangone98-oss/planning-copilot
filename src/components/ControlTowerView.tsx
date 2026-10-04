import { useRef, useState } from "react";
import { parseControlTowerSnapshot } from "../../scripts/agent-office/lib/control-tower-snapshot.mjs";
import type { ControlTowerApprovalStatus, ControlTowerSnapshot, ControlTowerState, HarnessStatus, SectionId } from "../types";

const statusLabels: Record<HarnessStatus, string> = {
  QUEUED: "대기",
  RUNNING: "실행 중",
  WAITING_APPROVAL: "승인 대기",
  SUCCEEDED: "완료",
  NEEDS_ATTENTION: "확인 필요",
  FAILED: "실패",
  CANCELLED: "취소"
};

const jobLabels = {
  "daily-briefing": "Google Workspace 아침 보고",
  "agent-office-command": "AI 사무국 명령"
} as const;

type Props = {
  state: ControlTowerState;
  onImport: (snapshot: ControlTowerSnapshot) => void;
  onApprovalChange: (id: string, status: ControlTowerApprovalStatus) => void;
  onClear: () => void;
  onNavigate: (section: SectionId) => void;
};

export function ControlTowerView({ state, onImport, onApprovalChange, onClear, onNavigate }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const snapshot = state.snapshot;

  const importFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setError("snapshot 파일은 1MB 이하만 가져올 수 있습니다.");
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError("JSON 파일을 읽을 수 없습니다.");
      return;
    }
    const parsed = parseControlTowerSnapshot(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError("");
    onImport(parsed.value);
  };

  const approvalStatus = (id: string, initial: string) => {
    const overlay = state.approvals[snapshot?.run.id + ":" + id];
    if (overlay) return overlay === "approved" ? "승인됨" : "보류됨";
    return initial === "pending" ? "승인 대기" : initial === "approved" ? "원본 승인" : "원본 보류";
  };

  return (
    <div className="control-tower">
      <div className="control-import-row">
        <div>
          <strong>로컬 실행 기록 가져오기</strong>
          <span>하네스가 만든 snapshot.json을 선택하세요. 가져온 내용은 이 브라우저에만 저장됩니다.</span>
        </div>
        <div className="control-actions">
          <input
            ref={inputRef}
            className="control-file-input"
            type="file"
            accept=".json,application/json"
            aria-label="snapshot JSON 파일 선택"
            onChange={(event) => {
              void importFile(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <button className="primary-button" type="button" onClick={() => inputRef.current?.click()}>파일 선택</button>
          {snapshot && <button className="ghost-light-button" type="button" onClick={onClear}>기록 지우기</button>}
        </div>
      </div>

      <div
        className={"control-dropzone" + (dragging ? " is-dragging" : "")}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void importFile(event.dataTransfer.files?.[0]);
        }}
      >
        <span>snapshot.json을 여기에 끌어 놓아도 됩니다</span>
      </div>

      {error && <p className="control-error" role="alert">{error}</p>}

      {!snapshot ? (
        <div className="office-empty">
          <strong>불러온 실행 기록이 없습니다.</strong>
          <span>터미널에서 하네스 작업을 실행한 뒤 reports/private/runs 안의 snapshot.json을 가져오세요.</span>
          <div className="control-command-list">
            <code>npm run office:harness -- --job daily-briefing --mock</code>
            <code>npm run office:harness -- --job agent-office-command --command "홍보 콘텐츠 기획"</code>
          </div>
        </div>
      ) : (
        <>
          <section className="control-overview" aria-label="실행 요약">
            <div><span>작업 종류</span><strong>{jobLabels[snapshot.run.jobType]}</strong></div>
            <div><span>실행 상태</span><strong className={"harness-status status-" + snapshot.run.status.toLowerCase()}>{statusLabels[snapshot.run.status]}</strong></div>
            <div><span>단계 완료</span><strong>{snapshot.steps.filter((step) => step.status === "SUCCEEDED" || step.status === "WAITING_APPROVAL").length} / {snapshot.steps.length}</strong></div>
            <div><span>승인 대기</span><strong>{snapshot.approvals.filter((item) => item.status === "pending" && !state.approvals[snapshot.run.id + ":" + item.id]).length}건</strong></div>
          </section>

          <section className="control-run-heading">
            <div>
              <h3>{snapshot.run.summary}</h3>
              <p>{snapshot.run.id} · 시작 {new Date(snapshot.run.startedAt).toLocaleString("ko-KR")}{snapshot.run.finishedAt ? " · 종료 " + new Date(snapshot.run.finishedAt).toLocaleString("ko-KR") : ""}</p>
            </div>
            <span className="control-job-label">{jobLabels[snapshot.run.jobType]}</span>
          </section>

          <section className="control-section">
            <h3>실행 단계</h3>
            <ol className="control-step-list">
              {snapshot.steps.map((step) => (
                <li key={step.id}>
                  <span className={"harness-status status-" + step.status.toLowerCase()}>{statusLabels[step.status]}</span>
                  <div><strong>{step.label}</strong>{step.message && <p>{step.message}</p>}</div>
                </li>
              ))}
            </ol>
          </section>

          {snapshot.alerts.length > 0 && (
            <section className="control-section">
              <h3>확인 알림</h3>
              <ul className="control-alert-list">
                {snapshot.alerts.map((alert) => <li className={"alert-" + alert.severity} key={alert.id}>{alert.message}</li>)}
              </ul>
            </section>
          )}

          <section className="control-section">
            <div className="control-section-heading"><h3>검토·승인</h3><span>결정은 현재 브라우저에만 기록됩니다.</span></div>
            {snapshot.approvals.length ? (
              <div className="control-approval-list">
                {snapshot.approvals.map((item) => {
                  const saved = state.approvals[snapshot.run.id + ":" + item.id];
                  const decided = item.status !== "pending" || saved === "approved" || saved === "blocked";
                  return (
                    <article className="control-approval-item" key={item.id}>
                      <div><strong>{item.title}</strong><span>{approvalStatus(item.id, item.status)}</span><p>{item.summary || "요약 정보가 없습니다."}</p></div>
                      <div className="control-actions">
                        <button className="secondary-button" type="button" disabled={decided} onClick={() => onApprovalChange(item.id, "approved")}>승인 기록</button>
                        <button className="ghost-light-button" type="button" disabled={decided} onClick={() => onApprovalChange(item.id, "blocked")}>보류 기록</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : <p className="control-muted">이 실행에는 별도 승인 항목이 없습니다.</p>}
          </section>

          <section className="control-section">
            <h3>산출물</h3>
            {snapshot.artifacts.length ? (
              <ul className="control-reference-list">
                {snapshot.artifacts.map((artifact) => <li key={artifact.id}><strong>{artifact.name}</strong><code>{artifact.path}</code></li>)}
              </ul>
            ) : <p className="control-muted">연결된 산출물이 없습니다.</p>}
          </section>

          {snapshot.sources.length > 0 && (
            <section className="control-section">
              <h3>참고 출처</h3>
              <ul className="control-reference-list">
                {snapshot.sources.map((source, index) => <li key={source.sourceUrl + index}><a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceType} 출처 열기</a>{source.projectId && <span>프로젝트 {source.projectId}</span>}</li>)}
              </ul>
            </section>
          )}

          <div className="control-actions control-navigation">
            <button className="secondary-button" type="button" onClick={() => onNavigate("agentOffice")}>AI 사무국 열기</button>
            <button className="secondary-button" type="button" onClick={() => onNavigate("approvalInbox")}>기존 승인함 열기</button>
          </div>
          <p className="control-safety-note">이 화면은 실행 기록을 보여주고 로컬 승인 상태만 저장합니다. 이메일 발송, 문서 수정, 공문 제출은 수행하지 않습니다.</p>
        </>
      )}
    </div>
  );
}
