import { useMemo, useState } from "react";
import type { GrantPlan, ProjectData } from "../types";
import { downloadTextFile, safeFileName } from "../lib/storage";
import { buildNotionPasteMarkdown, buildWorkbrainFileName, buildWorkbrainMarkdown, WORKSPACE_LINKS, type WorkbrainExportOptions } from "../lib/davidWorkbrainExport.mjs";

type ExportState = {
  domain: "company" | "personal" | "shared";
  targetFolder: "01_회사_사업" | "outputs";
  status: string;
  tags: string;
  deadline: string;
  includeBudget: boolean;
  includeChecklist: boolean;
  includeReport: boolean;
  includeDraft: boolean;
  includeFollowUps: boolean;
};

const initialState: ExportState = {
  domain: "company",
  targetFolder: "01_회사_사업",
  status: "draft",
  tags: "planning-copilot, 국고보조사업, 예산정산",
  deadline: "",
  includeBudget: true,
  includeChecklist: true,
  includeReport: true,
  includeDraft: false,
  includeFollowUps: true
};

/** 초안 조립·양식 채우기에서 넘어온 초안이 있으면 ‘사업계획서 초안’을 미리 켜 둔다. */
function createInitialState(hasDraft: boolean): ExportState {
  return { ...initialState, includeDraft: hasDraft };
}

export function WorkbrainExportView({
  plan,
  project,
  notify
}: {
  plan: GrantPlan;
  project: ProjectData;
  notify: (message: string) => void;
}) {
  const [state, setState] = useState<ExportState>(() => createInitialState(Boolean(project.draftOutput.trim())));

  const options = useMemo<WorkbrainExportOptions>(() => ({
    domain: state.domain,
    targetFolder: state.targetFolder,
    status: state.status,
    deadline: state.deadline || plan.schedule?.reportDeadline || plan.schedule?.settlementDeadline,
    tags: state.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    includeBudget: state.includeBudget,
    includeChecklist: state.includeChecklist,
    includeReport: state.includeReport,
    includeDraft: state.includeDraft,
    includeFollowUps: state.includeFollowUps
  }), [state, plan.schedule]);

  const markdown = useMemo(
    () => buildWorkbrainMarkdown({ plan, project, options }),
    [plan, project, options]
  );
  const fileName = useMemo(
    () => buildWorkbrainFileName({ programName: plan.programName, title: project.projectName }),
    [plan.programName, project.projectName]
  );

  const copyMarkdown = () => {
    navigator.clipboard.writeText(markdown).then(() => notify("david-workbrain 형식 Markdown을 복사했습니다."));
  };

  const copyNotion = () => {
    navigator.clipboard.writeText(buildNotionPasteMarkdown(markdown)).then(() => notify("Notion 붙여넣기용 Markdown을 복사했습니다."));
  };

  const download = () => {
    downloadTextFile(markdown, safeFileName(fileName, "workbrain-note.md"), "text/markdown;charset=utf-8");
    notify("Markdown 파일을 내려받았습니다.");
  };

  return (
    <div className="grant-layout">
      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>공용 두뇌로 보내는 느슨한 연계</strong>
            <span>
              앱을 하나로 합치지 않습니다. planning-copilot은 계획·예산·정산을 만들고, david-workbrain이 지식·SOP·템플릿을 맡고,
              my-workbench에서 지시와 승인을 관리합니다. 이 화면은 그 사이를 Markdown으로 잇는 역할만 합니다.
            </span>
          </div>
        </div>
        <div className="integration-grid workspace-links">
          {WORKSPACE_LINKS.map((link) => (
            <div className="integration-card" key={link.label}>
              <strong>{link.label}</strong>
              <span>{link.role}</span>
              <a className="secondary-button link-button" href={link.url} target="_blank" rel="noreferrer">{link.label} 열기</a>
            </div>
          ))}
        </div>
      </section>

      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>내보내기 설정</strong>
            <span>david-workbrain의 `01_회사_사업/` 또는 `outputs/`에 그대로 넣을 수 있는 YAML frontmatter를 만듭니다.</span>
          </div>
          <div className="draft-actions">
            <button className="secondary-button" type="button" onClick={copyMarkdown}>Markdown 복사</button>
            <button className="secondary-button" type="button" onClick={copyNotion}>Notion용 복사</button>
            <button className="primary-button" type="button" onClick={download}>.md 내려받기</button>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>넣을 폴더</span>
            <select value={state.targetFolder} onChange={(event) => setState({ ...state, targetFolder: event.target.value as ExportState["targetFolder"] })}>
              <option value="01_회사_사업">01_회사_사업</option>
              <option value="outputs">outputs</option>
            </select>
          </label>
          <label className="field">
            <span>domain</span>
            <select value={state.domain} onChange={(event) => setState({ ...state, domain: event.target.value as ExportState["domain"] })}>
              <option value="company">company</option>
              <option value="personal">personal</option>
              <option value="shared">shared</option>
            </select>
          </label>
          <label className="field">
            <span>status</span>
            <input value={state.status} onChange={(event) => setState({ ...state, status: event.target.value })} placeholder="draft" />
          </label>
          <label className="field">
            <span>마감일</span>
            <input type="date" value={state.deadline} onChange={(event) => setState({ ...state, deadline: event.target.value })} />
          </label>
          <label className="field wide">
            <span>태그(쉼표로 구분)</span>
            <input value={state.tags} onChange={(event) => setState({ ...state, tags: event.target.value })} placeholder="planning-copilot, 국고보조사업, 예산정산" />
          </label>
        </div>
        <div className="grant-check-options">
          {([
            ["includeBudget", "예산 편성표"],
            ["includeChecklist", "정산 증빙 체크리스트"],
            ["includeReport", "결과보고서 초안"],
            ["includeDraft", "사업계획서 초안"],
            ["includeFollowUps", "후속 할 일"]
          ] as const).map(([key, label]) => (
            <label key={key} className="grant-inline-check">
              <input type="checkbox" checked={state[key]} onChange={(event) => setState({ ...state, [key]: event.target.checked })} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="grant-warning">개인정보·정산 증빙 원본 파일은 내보내지 않습니다. 요약과 체크 상태, 할 일만 담습니다. 원본은 로컬·Drive에 두세요.</p>
      </section>

      <section className="grant-block">
        <div className="grant-block-head">
          <div>
            <strong>미리보기 · {fileName}</strong>
            <span>YAML frontmatter, 메타데이터 표, 추진 일정·마감 요약, 체크리스트, 후속 할 일이 한 문서에 들어갑니다.</span>
          </div>
        </div>
        <textarea className="draft-output export-preview" rows={26} value={markdown} readOnly />
      </section>
    </div>
  );
}
