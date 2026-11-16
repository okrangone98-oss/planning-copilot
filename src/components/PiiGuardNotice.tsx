import { useMemo, useState } from "react";
import { describePiiScan, scanPii } from "../lib/piiGuard.mjs";
import type { PiiOptions, PiiScan } from "../lib/piiGuard.mjs";

/**
 * 외부로 나가기 전에 개인정보를 먼저 보여 주는 배지.
 * 스캔은 브라우저 안에서만 하고, 켜 두면 [연락처_1] 형태로 가린 텍스트가 전송된다.
 */
export function PiiGuardNotice({
  text,
  enabled,
  onToggle,
  title = "개인정보 가드",
  note,
  options,
  compact = false
}: {
  text: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  title?: string;
  note?: string;
  options?: PiiOptions;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scan: PiiScan = useMemo(() => scanPii(text, options), [text, options]);
  const hasFindings = scan.total > 0;

  return (
    <section className={`pii-guard ${hasFindings ? "has-findings" : "is-clean"} ${compact ? "is-compact" : ""}`} aria-label={title}>
      <div className="pii-guard-head">
        <div className="pii-guard-title">
          <strong>{title}</strong>
          <span>{describePiiScan(scan)}</span>
        </div>
        <label className="pii-guard-toggle">
          <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
          <span>마스킹 후 보내기</span>
        </label>
      </div>

      {hasFindings && (
        <div className="pii-guard-badges" aria-label="탐지 종류">
          {scan.types.map((type) => (
            <span className="pii-badge" key={type.key}>
              {type.badge} {type.count}
            </span>
          ))}
          <button className="pii-guard-more" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
            {open ? "탐지 목록 접기" : "탐지 목록 보기"}
          </button>
        </div>
      )}

      {open && hasFindings && (
        <ul className="pii-guard-list">
          {scan.findings.slice(0, 40).map((finding, index) => (
            <li key={`${finding.type}-${finding.start}-${index}`}>
              <span className={`pii-kind is-${finding.type}`}>{finding.badge}</span>
              <span className="pii-preview">{finding.preview}</span>
              {finding.placeholder && <code>{finding.placeholder}</code>}
            </li>
          ))}
          {scan.findings.length > 40 && <li className="pii-guard-more-row">… {scan.findings.length - 40}건 더 있습니다. 전송할 때는 모두 가려집니다.</li>}
        </ul>
      )}

      {note && <p className="pii-guard-note">{note}</p>}
      {!enabled && hasFindings && (
        <p className="pii-guard-warning" role="alert">
          지금은 마스킹이 꺼져 있어 원문이 그대로 전송됩니다. 외부 AI·메신저로 보낼 때는 켜 두는 것을 권합니다.
        </p>
      )}
    </section>
  );
}
