import { useEffect, useMemo, useState } from "react";
import { agentRoles } from "./data/agentRoles";
import { ControlTowerView } from "./components/ControlTowerView";
import { exampleProject } from "./data/exampleProject";
import { analyzeNotice, formatKnowledgeResults, generateCoaching, projectSearchQuery, searchKnowledgeDocs } from "./lib/analysis";
import { generateDraftText } from "./lib/draft";
import { extractTextFromFile } from "./lib/fileText";
import { absorbModelResponse, buildModelPrompt } from "./lib/prompts";
import { listOllamaModels, modelLabel, modelProviderOptions, modelSafetyNote, runModelPrompt } from "./lib/modelRouter";
import { buildOfficeContext, buildOfficeModelPrompt } from "./lib/agentOfficePrompt.mjs";
import { roleSummary, runOffice } from "./lib/agentOffice";
import { clearControlTowerState, loadControlTowerState, saveControlTowerApproval, saveControlTowerSnapshot } from "./lib/controlTowerStorage";
import {
  clearProject,
  createArchive,
  downloadTextFile,
  loadDriveEndpoint,
  loadKnowledgeDocs,
  loadModelSettings,
  loadOfficeSession,
  loadProject,
  loadApprovalItems,
  loadProjectMemory,
  safeFileName,
  saveDriveEndpoint,
  saveKnowledgeDocs,
  saveModelSettings,
  saveOfficeSession,
  saveApprovalItems,
  saveProject,
  saveProjectMemory
} from "./lib/storage";
import { buildMermaid } from "./lib/visuals";
import { emptyProject, type AgentDraft, type ApprovalItem, type ApprovalStatus, type ControlTowerApprovalStatus, type ControlTowerSnapshot, type ControlTowerState, type KnowledgeDoc, type ModelSettings, type ModelRunResult, type OfficeResult, type ProjectData, type ProjectMemoryEntry, type SectionId } from "./types";

const navGroups: Array<{ title: string; items: Array<{ id: SectionId; label: string }> }> = [
  {
    title: "업무 홈",
    items: [
      { id: "agentOffice", label: "AI 사무국" },
      { id: "controlTower", label: "업무 관제탑" }
    ]
  },
  {
    title: "프로젝트",
    items: [
      { id: "cowork", label: "질문 받기" },
      { id: "idea", label: "아이디어 인터뷰" },
      { id: "problem", label: "문제정의" },
      { id: "logic", label: "논리모형" },
      { id: "metrics", label: "성과지표" },
      { id: "execution", label: "실행설계" },
      { id: "blueprint", label: "서비스 블루프린트" }
    ]
  },
  {
    title: "자료·근거",
    items: [
      { id: "notice", label: "공고 해석" },
      { id: "ragRoom", label: "사례 모으기" },
      { id: "sample", label: "샘플 분해" },
      { id: "projectMemory", label: "프로젝트 기억" }
    ]
  },
  {
    title: "산출물·검토",
    items: [
      { id: "draft", label: "초안 조립" },
      { id: "visuals", label: "시각자료" },
      { id: "approvalInbox", label: "승인함" },
      { id: "aiBridge", label: "외부 AI 질문" }
    ]
  },
  {
    title: "설정·연결",
    items: [
      { id: "modelSettings", label: "모델 설정" },
      { id: "integrations", label: "프로젝트 링크" },
      { id: "driveBackup", label: "백업" }
    ]
  }
];

const navItems = navGroups.flatMap((group) => group.items);
const quickOfficeCommands = [
  "2026 청년 관광두레 플러스사업 지원 전략 짜줘",
  "다음 주 의기양양 두레동아리 홍보 콘텐츠 기획해줘",
  "로컬브랜드 협업 제안 메일과 사업개요 만들어줘",
  "오늘 자료를 바탕으로 아침 보고서와 실행 체크리스트 만들어줘"
];

const APPS_SCRIPT_TEMPLATE = `const ARCHIVE_FOLDER = 'Planning Copilot Archive';
const ARCHIVE_FILE = 'planning-copilot-archive.json';

function doPost(e) {
  const payload = e.parameter.payload || '{}';
  const folder = getOrCreateFolder_(ARCHIVE_FOLDER);
  const files = folder.getFilesByName(ARCHIVE_FILE);
  const blob = Utilities.newBlob(payload, 'application/json', ARCHIVE_FILE);

  if (files.hasNext()) {
    files.next().setContent(payload);
  } else {
    folder.createFile(blob);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}`;

function Field({
  label,
  value,
  onChange,
  rows = 5,
  wide = false,
  placeholder = "",
  monospace = false,
  onKeyDown
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  wide?: boolean;
  placeholder?: string;
  monospace?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} spellCheck={!monospace} />
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder = "",
  wide = false,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  wide?: boolean;
  type?: string;
}) {
  return (
    <label className={`field ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function LinkButton({ href, label }: { href: string; label: string }) {
  if (!href) return <span className="muted-link">연결 전</span>;
  return (
    <a className="secondary-button link-button" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function TableEditor({
  headers,
  rows,
  onChange,
  addLabel
}: {
  headers: string[];
  rows: string[][];
  onChange: (rows: string[][]) => void;
  addLabel: string;
}) {
  const updateCell = (rowIndex: number, cellIndex: number, value: string) => {
    const next = rows.map((row) => [...row]);
    next[rowIndex][cellIndex] = value;
    onChange(next);
  };
  return (
    <>
      <div className="table-tools">
        <button className="secondary-button" type="button" onClick={() => onChange([...rows, headers.map(() => "")])}>
          {addLabel}
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headers.map((header, cellIndex) => (
                  <td key={header}>
                    <input value={row[cellIndex] || ""} placeholder={header} onChange={(event) => updateCell(rowIndex, cellIndex, event.target.value)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function App() {
  const [project, setProject] = useState<ProjectData>(() => loadProject());
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>(() => loadKnowledgeDocs());
  const [section, setSection] = useState<SectionId>("agentOffice");
  const [expandedNavGroup, setExpandedNavGroup] = useState("업무 홈");
  const [toast, setToast] = useState("");
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeType, setKnowledgeType] = useState("");
  const [knowledgeText, setKnowledgeText] = useState("");
  const [driveEndpoint, setDriveEndpoint] = useState(() => loadDriveEndpoint());
  const [visualSvg, setVisualSvg] = useState("");
  const [officeCommand, setOfficeCommand] = useState(() => loadOfficeSession().command);
  const [officeResult, setOfficeResult] = useState<OfficeResult | null>(() => loadOfficeSession().result);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(() => loadModelSettings());
  const [modelTestPrompt, setModelTestPrompt] = useState("오늘 할 일을 5개 체크리스트로 정리해줘.");
  const [modelTestResult, setModelTestResult] = useState<ModelRunResult | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelsBusy, setOllamaModelsBusy] = useState(false);
  const [approvalItems, setApprovalItems] = useState<ApprovalItem[]>(() => loadApprovalItems());
  const [memoryEntries, setMemoryEntries] = useState<ProjectMemoryEntry[]>(() => loadProjectMemory());
  const [memoryNote, setMemoryNote] = useState("");
  const [controlTowerState, setControlTowerState] = useState<ControlTowerState>(() => loadControlTowerState());

  const sectionTitle = useMemo(() => navItems.find((item) => item.id === section)?.label || "", [section]);

  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    saveKnowledgeDocs(knowledgeDocs);
  }, [knowledgeDocs]);

  useEffect(() => {
    const activeGroup = navGroups.find((group) => group.items.some((item) => item.id === section));
    if (activeGroup) setExpandedNavGroup(activeGroup.title);
  }, [section]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (section !== "visuals" || !project.visualMermaid) return;
    renderVisual(project.visualMermaid);
  }, [section, project.visualMermaid]);

  useEffect(() => {
    saveOfficeSession(officeCommand, officeResult);
  }, [officeCommand, officeResult]);

  useEffect(() => {
    saveModelSettings(modelSettings);
  }, [modelSettings]);

  useEffect(() => {
    saveApprovalItems(approvalItems);
  }, [approvalItems]);

  useEffect(() => {
    saveProjectMemory(memoryEntries);
  }, [memoryEntries]);

  const updateProject = (patch: Partial<ProjectData>) => setProject((current) => ({ ...current, ...patch }));
  const notify = (message: string) => setToast(message);

  const readFile = (file: File, onText: (text: string) => void) => {
    extractTextFromFile(file)
      .then(({ text, warning }) => {
        if (warning) notify(warning);
        if (!text) return;
        onText(text);
      })
      .catch(() => notify("파일을 읽지 못했습니다. 문서 내용을 복사해 붙여넣어 주세요."));
  };

  const runNoticeAnalysis = () => {
    if (!project.noticeText.trim()) {
      notify("먼저 공고문 내용을 붙여넣어 주세요.");
      return;
    }
    const analyzed = { ...project, ...analyzeNotice(project) };
    updateProject({ ...analyzeNotice(project), ...generateCoaching(analyzed) });
    notify("공고문을 분석하고 다음 질문을 만들었습니다.");
  };

  const addKnowledgeDoc = () => {
    if (!knowledgeText.trim()) {
      notify("저장할 문서 내용을 입력해 주세요.");
      return;
    }
    setKnowledgeDocs([
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        title: knowledgeTitle || "이름 없는 사례",
        type: knowledgeType || "사례",
        text: knowledgeText,
        createdAt: new Date().toISOString()
      },
      ...knowledgeDocs
    ]);
    setKnowledgeTitle("");
    setKnowledgeType("");
    setKnowledgeText("");
    notify("사례를 저장했습니다.");
  };

  const searchKnowledge = () => {
    const query = projectSearchQuery(project);
    if (!query.trim()) {
      notify("검색할 공고문이나 아이디어를 먼저 입력해 주세요.");
      return;
    }
    updateProject({ ragResults: formatKnowledgeResults(searchKnowledgeDocs(knowledgeDocs, query)) });
    notify("관련 사례를 찾았습니다.");
  };

  const renderVisual = async (code: string) => {
    if (!code.trim()) {
      setVisualSvg("");
      return;
    }
    try {
      const mermaid = (await import("mermaid")).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        flowchart: { htmlLabels: true, curve: "basis" },
        themeVariables: {
          primaryColor: "#eef8f5",
          primaryTextColor: "#18202a",
          primaryBorderColor: "#1f7a68",
          lineColor: "#657386",
          secondaryColor: "#fff7f2",
          tertiaryColor: "#f4f7fb"
        }
      });
      const { svg } = await mermaid.render(`visual-${Date.now()}`, code);
      setVisualSvg(svg);
    } catch (error) {
      setVisualSvg(`<div class="visual-error">다이어그램을 그리지 못했습니다. 코드 문법을 확인해 주세요.<br>${String(error)}</div>`);
    }
  };

  const generateVisual = async () => {
    const code = buildMermaid(project);
    updateProject({ visualMermaid: code });
    await renderVisual(code);
    notify("시각자료 초안을 만들었습니다.");
  };

  const downloadArchive = () => {
    downloadTextFile(JSON.stringify(createArchive(project, knowledgeDocs, approvalItems, memoryEntries), null, 2), `${safeFileName(project.projectName, "planning-copilot")}-archive-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    notify("백업 파일을 내려받았습니다.");
  };

  const backupToDrive = () => {
    if (!driveEndpoint.trim()) {
      notify("Google Drive 연결 주소를 입력해 주세요.");
      return;
    }
    saveDriveEndpoint(driveEndpoint);
    const iframeName = "driveBackupTarget";
    let iframe = document.querySelector<HTMLIFrameElement>(`iframe[name="${iframeName}"]`);
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.name = iframeName;
      iframe.hidden = true;
      document.body.appendChild(iframe);
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = driveEndpoint;
    form.target = iframeName;
    form.hidden = true;
    const payload = document.createElement("input");
    payload.type = "hidden";
    payload.name = "payload";
    payload.value = JSON.stringify(createArchive(project, knowledgeDocs, approvalItems, memoryEntries));
    form.appendChild(payload);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    notify("Google Drive 백업을 요청했습니다.");
  };

  const restoreArchive = (file: File) => {
    readFile(file, (text) => {
      try {
        const archive = JSON.parse(text);
        setProject({ ...emptyProject, ...archive.project });
        setKnowledgeDocs(Array.isArray(archive.knowledgeDocs) ? archive.knowledgeDocs : []);
        notify("백업 파일을 복원했습니다.");
      } catch {
        notify("백업 파일을 읽지 못했습니다.");
      }
    });
  };

  const copyText = (text: string, message: string) => {
    navigator.clipboard.writeText(text).then(() => notify(message));
  };

  const runAgentOffice = async (command = officeCommand) => {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) {
      notify("AI 사무국에 맡길 명령을 입력해 주세요.");
      return;
    }
    if (modelBusy) return;
    setOfficeCommand(normalizedCommand);

    const result = runOffice(normalizedCommand);
    if (modelSettings.provider === "simulation") {
      result.execution = { mode: "simulation", status: "completed", contextSources: ["사용자 명령"] };
      setOfficeResult(result);
      notify("템플릿 모드 보고서를 만들었습니다.");
      return;
    }

    const context = buildOfficeContext(project, searchKnowledgeDocs(knowledgeDocs, normalizedCommand, 3));
    const prompt = buildOfficeModelPrompt({ command: normalizedCommand, tasks: result.tasks, context });
    const modelName = modelSettings.ollamaModel.trim() || "이름 미입력";
    setModelBusy(true);
    try {
      const modelResult = await runModelPrompt(prompt, modelSettings);
      if (!modelResult.ok) throw new Error(modelResult.error || "Ollama 실행에 실패했습니다.");
      result.execution = { mode: "ollama", status: "completed", model: modelName, contextSources: context.sourceLabels };
      result.report.markdown = formatOllamaOfficeReport(normalizedCommand, modelName, context.sourceLabels, modelResult.output, context.truncated);
      setOfficeResult(result);
      notify("Ollama가 통합 초안을 만들었습니다. 실행 전 내용을 검토해 주세요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ollama 실행에 실패했습니다.";
      result.execution = { mode: "ollama", status: "failed", model: modelName, contextSources: context.sourceLabels, error: message };
      result.report.markdown = formatOllamaOfficeFailure(normalizedCommand, modelName, message, result.report.markdown);
      setOfficeResult(result);
      notify(`Ollama 실행 실패: ${message}`);
    } finally {
      setModelBusy(false);
    }
  };

  const useQuickOfficeCommand = (command: string) => {
    setOfficeCommand(command);
    void runAgentOffice(command);
  };

  const importControlSnapshot = (snapshot: ControlTowerSnapshot) => {
    try {
      setControlTowerState(saveControlTowerSnapshot(snapshot));
      notify("실행 기록을 가져왔습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "실행 기록을 저장하지 못했습니다.");
    }
  };

  const updateControlApproval = (id: string, status: ControlTowerApprovalStatus) => {
    try {
      setControlTowerState(saveControlTowerApproval(controlTowerState.snapshot?.run.id || "", id, status));
      notify(status === "approved" ? "브라우저에 승인 상태를 기록했습니다." : "브라우저에 보류 상태를 기록했습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "승인 상태를 저장하지 못했습니다.");
    }
  };

  const clearControlSnapshot = () => {
    if (!window.confirm("이 브라우저에 저장한 관제탑 실행 기록을 지울까요?")) return;
    clearControlTowerState();
    setControlTowerState({ snapshot: null, approvals: {} });
    notify("관제탑 실행 기록을 지웠습니다.");
  };

  const sendOfficePromptToAiBridge = () => {
    if (!officeResult) {
      notify("먼저 AI 사무국을 실행해 주세요.");
      return;
    }
    // 결과를 복사해서 다른 탭에 다시 붙이는 시간을 줄이기 위해, 모델 질문 칸으로 직접 보낸다.
    updateProject({ modelPrompt: officeResult.promptPackage.unifiedPrompt });
    setSection("aiBridge");
    notify("GPT 질문 패키지를 AI 질문 탭으로 보냈습니다.");
  };

  const sendOfficeReportToDraft = () => {
    if (!officeResult) {
      notify("먼저 AI 사무국을 실행해 주세요.");
      return;
    }
    updateProject({ draftOutput: officeResult.report.markdown });
    setSection("draft");
    notify("아침 보고서를 초안 조립 탭으로 보냈습니다.");
  };

  const copyOfficeDrafts = () => {
    if (!officeResult) {
      notify("먼저 AI 사무국을 실행해 주세요.");
      return;
    }
    const drafts = officeResult.drafts
      .filter((draft) => draft.agentId !== "chief")
      .map((draft) => `# ${roleSummary(draft.agentId)}\n\n${draft.content}`)
      .join("\n\n---\n\n");
    copyText(drafts, "에이전트별 초안을 복사했습니다.");
  };

  const downloadOfficeReport = () => {
    if (!officeResult) {
      notify("먼저 AI 사무국을 실행해 주세요.");
      return;
    }
    downloadTextFile(officeResult.report.markdown, `${safeFileName(officeResult.report.command, "agent-office-report")}.md`, "text/markdown;charset=utf-8");
    notify("아침 보고서를 Markdown으로 내려받았습니다.");
  };

  const updateModelSettings = (patch: Partial<ModelSettings>) => setModelSettings((current) => ({ ...current, ...patch }));

  const runSelectedModel = async (prompt: string) => {
    if (modelBusy) return;
    setModelBusy(true);
    try {
      const result = await runModelPrompt(prompt, modelSettings);
      setModelTestResult(result);
      notify(result.ok ? `${modelLabel(result.provider)} 응답을 받았습니다.` : `모델 실행 실패: ${result.error || "확인 필요"}`);
      return result;
    } finally {
      setModelBusy(false);
    }
  };

  const refreshOllamaModels = async () => {
    if (ollamaModelsBusy) return;
    setOllamaModelsBusy(true);
    try {
      const models = await listOllamaModels(modelSettings);
      setOllamaModels(models);
      notify(models.length ? `Ollama 모델 ${models.length}개를 확인했습니다.` : "설치된 Ollama 모델이 없습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Ollama 모델 목록을 가져오지 못했습니다.");
    } finally {
      setOllamaModelsBusy(false);
    }
  };

  const addApprovalItem = (item: Omit<ApprovalItem, "id" | "status" | "createdAt" | "updatedAt">, status: ApprovalStatus = "draft") => {
    const now = new Date().toISOString();
    setApprovalItems((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        status,
        createdAt: now,
        updatedAt: now,
        ...item
      },
      ...current
    ]);
    notify("승인함에 추가했습니다.");
  };

  const updateApprovalStatus = (id: string, status: ApprovalStatus) => {
    setApprovalItems((current) => current.map((item) => item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item));
  };

  const removeApprovalItem = (id: string) => {
    setApprovalItems((current) => current.filter((item) => item.id !== id));
    notify("승인함에서 삭제했습니다.");
  };

  const saveCurrentMemory = () => {
    const title = project.projectName || officeResult?.report.command || "이름 없는 프로젝트";
    const reportMemory = officeResult?.execution?.status === "failed" ? ""
      : officeResult?.execution?.mode === "ollama" ? officeResult.report.markdown
        : officeResult?.report.highlights.join("\n");
    const summary = memoryNote.trim() || project.aiSynthesis || reportMemory || project.draftOutput || "";
    if (!summary.trim()) {
      notify("저장할 프로젝트 기억이 없습니다.");
      return;
    }
    setMemoryEntries((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        projectName: project.projectName || "미지정 프로젝트",
        title,
        summary,
        source: officeResult?.execution?.mode === "ollama" && officeResult.execution.status === "completed" ? "Ollama 통합 초안" : officeResult ? "템플릿 또는 수동 검토 메모" : "수동 메모",
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
    setMemoryNote("");
    notify("프로젝트 기억에 저장했습니다.");
  };

  const addOfficeReportToApproval = () => {
    if (!officeResult) {
      notify("먼저 AI 사무국을 실행해 주세요.");
      return;
    }
    addApprovalItem({ title: `${officeResult.report.command} 아침 보고서`, type: "report", content: officeResult.report.markdown, source: "AI 사무국" }, "reviewing");
  };

  const addOfficePromptToApproval = () => {
    if (!officeResult) {
      notify("먼저 AI 사무국을 실행해 주세요.");
      return;
    }
    addApprovalItem({ title: `${officeResult.report.command} GPT 질문`, type: "prompt", content: officeResult.promptPackage.unifiedPrompt, source: "GPT 질문 패키지" });
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="업무 영역">
        <div className="brand-block">
          <p className="eyebrow">Planning Copilot</p>
          <h1>로컬기획 사무국</h1>
        </div>
        <TextInput label="프로젝트명" value={project.projectName} onChange={(projectName) => updateProject({ projectName })} placeholder="예: 생활문화 혁신 지원사업" />
        <nav className="step-nav" aria-label="업무 영역">
          {navGroups.map((group) => (
            <section className="nav-group" key={group.title}>
              <button
                className={`nav-group-toggle ${group.items.some((item) => item.id === section) ? "is-current" : ""}`}
                type="button"
                aria-expanded={expandedNavGroup === group.title}
                onClick={() => setExpandedNavGroup((current) => current === group.title ? "" : group.title)}
              >
                <span>{group.title}</span>
                <span className="nav-group-meta"><small>{group.items.length}</small><i aria-hidden="true" /></span>
              </button>
              {expandedNavGroup === group.title && <div className="nav-group-items">
                {group.items.map((item) => (
                  <button key={item.id} className={`nav-item ${section === item.id ? "is-active" : ""}`} type="button" onClick={() => { setSection(item.id); setExpandedNavGroup(group.title); }}>
                    {item.label}
                  </button>
                ))}
              </div>}
            </section>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="secondary-button" type="button" onClick={() => { setProject(exampleProject); notify("예시를 불러왔습니다."); }}>
            예시 불러오기
          </button>
          <button className="ghost-button" type="button" onClick={() => { if (window.confirm("현재 입력값을 초기화할까요?")) { clearProject(); setProject(emptyProject); notify("초기화했습니다."); } }}>
            초기화
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{project.projectName || "새 프로젝트"}</p>
            <h2>{sectionTitle}</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => { saveProject(project); notify("저장했습니다."); }}>저장</button>
            <button className="primary-button" type="button" onClick={() => {
              const content = project.draftOutput || generateDraftText(project);
              downloadTextFile(content, `${safeFileName(project.projectName, "planning-copilot-draft")}.md`, "text/markdown;charset=utf-8");
              notify("Markdown 파일을 내보냈습니다.");
            }}>Markdown 내보내기</button>
          </div>
        </header>

        {section === "controlTower" && (
          <Panel title="업무 관제탑" description="로컬 하네스의 실행 기록을 가져와 단계, 알림, 산출물과 검토 대상을 한곳에서 확인합니다.">
            <ControlTowerView
              state={controlTowerState}
              onImport={importControlSnapshot}
              onApprovalChange={updateControlApproval}
              onClear={clearControlSnapshot}
              onNavigate={setSection}
            />
          </Panel>
        )}

        {section === "agentOffice" && (
          <Panel title="AI 로컬기획 사무국" description="명령을 업무 단위로 나누고, 템플릿 또는 내 컴퓨터의 Ollama로 검토 가능한 통합 초안을 만듭니다.">
            <div className="model-status-bar office-mode-notice">
              <strong>현재 실행 경로: {modelLabel(modelSettings.provider)}</strong>
              <span>{modelSafetyNote(modelSettings)}</span>
            </div>
            <div className="coach-bar">
              <div><strong>업무 요청</strong><span>역할은 검토 관점을 정리하는 용도입니다. Ollama를 선택하면 단일 모델 호출이 최종 보고서를 작성합니다.</span></div>
              <button className="primary-button" type="button" onClick={() => { void runAgentOffice(); }} disabled={modelBusy}>{modelBusy ? "Ollama 실행 중" : "사무국 실행"}</button>
            </div>
            <div className="quick-command-grid" aria-label="빠른 명령 예시">
              {quickOfficeCommands.map((command) => (
                <button className="quick-command" key={command} type="button" onClick={() => useQuickOfficeCommand(command)}>
                  {command}
                </button>
              ))}
            </div>
            <Field
              label="명령 입력"
              value={officeCommand}
              onChange={setOfficeCommand}
              rows={4}
              wide
              placeholder="다음 주 의기양양 두레동아리 홍보 콘텐츠 기획해줘"
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void runAgentOffice();
              }}
            />
            {officeResult ? (
              <OfficeResultView
                result={officeResult}
                onCopyReport={() => copyText(officeResult.report.markdown, "아침 보고서를 복사했습니다.")}
                onCopyPrompt={() => copyText(officeResult.promptPackage.unifiedPrompt, "GPT 질문 패키지를 복사했습니다.")}
                onCopyDrafts={copyOfficeDrafts}
                onSendPrompt={sendOfficePromptToAiBridge}
                onSendReport={sendOfficeReportToDraft}
                onDownloadReport={downloadOfficeReport}
                onAddReportToApproval={addOfficeReportToApproval}
                onAddPromptToApproval={addOfficePromptToApproval}
              />
            ) : (
              <div className="office-empty">
                <strong>아직 실행 결과가 없습니다.</strong>
                <span>명령을 입력하고 사무국 실행을 누르면 작업 분해, 담당 에이전트, 초안, 아침 보고서가 표시됩니다.</span>
              </div>
            )}
          </Panel>
        )}

        {section === "modelSettings" && (
          <Panel title="모델 설정" description="브라우저에 API 키를 저장하지 않습니다. 실제 모델 사용은 loopback 주소의 Ollama만 지원하고, 기본값은 안전한 템플릿 모드입니다.">
            <div className="model-status-bar">
              <strong>현재 경로: {modelLabel(modelSettings.provider)}</strong>
              <span>{modelSafetyNote(modelSettings)}</span>
            </div>
            <div className="model-provider-grid">
              {modelProviderOptions.map((option) => (
                <button className={`provider-card ${modelSettings.provider === option.id ? "is-active" : ""}`} key={option.id} type="button" onClick={() => updateModelSettings({ provider: option.id })}>
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
            <div className="form-grid">
              {modelSettings.provider === "ollama" && <>
                <TextInput label="Ollama 로컬 주소" value={modelSettings.ollamaBaseUrl} onChange={(ollamaBaseUrl) => updateModelSettings({ ollamaBaseUrl })} placeholder="http://127.0.0.1:11434" />
                <TextInput label="Ollama 모델 이름" value={modelSettings.ollamaModel} onChange={(ollamaModel) => updateModelSettings({ ollamaModel })} placeholder="예: llama3.1" />
                <div className="ollama-model-controls">
                  <button className="secondary-button" type="button" onClick={() => { void refreshOllamaModels(); }} disabled={ollamaModelsBusy}>{ollamaModelsBusy ? "모델 확인 중" : "설치된 모델 확인"}</button>
                  {ollamaModels.length > 0 && <label className="field">
                    <span>설치 모델 선택</span>
                    <select value={modelSettings.ollamaModel} onChange={(event) => updateModelSettings({ ollamaModel: event.target.value })}>
                      {!ollamaModels.includes(modelSettings.ollamaModel) && modelSettings.ollamaModel && <option value={modelSettings.ollamaModel}>{modelSettings.ollamaModel} · 목록 외 입력</option>}
                      <option value="">모델 선택</option>
                      {ollamaModels.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                  </label>}
                </div>
              </>}
              <Field label="모델 테스트 프롬프트" value={modelTestPrompt} onChange={setModelTestPrompt} rows={6} wide />
            </div>
            <div className="draft-actions bridge-actions">
              <button className="primary-button" type="button" onClick={() => runSelectedModel(modelTestPrompt)} disabled={modelBusy}>{modelBusy ? "실행 중" : "선택 모델 테스트"}</button>
              <button className="secondary-button" type="button" onClick={() => { if (project.modelPrompt) runSelectedModel(project.modelPrompt); else notify("AI 질문 탭에 프롬프트가 없습니다."); }}>AI 질문으로 실행</button>
            </div>
            {modelTestResult && <textarea className="draft-output office-report-output" rows={16} value={modelTestResult.ok ? modelTestResult.output : modelTestResult.error || "실패"} readOnly />}
          </Panel>
        )}

        {section === "approvalInbox" && (
          <Panel title="승인함" description="AI가 만든 보고서, 메일, 콘텐츠, 질문을 바로 실행하지 않고 검토 상태로 관리합니다.">
            <div className="approval-summary">
              <span>전체 {approvalItems.length}</span>
              <span>검토중 {approvalItems.filter((item) => item.status === "reviewing").length}</span>
              <span>승인 {approvalItems.filter((item) => item.status === "approved").length}</span>
              <span>보류 {approvalItems.filter((item) => item.status === "blocked").length}</span>
            </div>
            <div className="approval-list">
              {approvalItems.length ? approvalItems.map((item) => (
                <article className="approval-item" key={item.id}>
                  <div className="approval-head"><strong>{item.title}</strong><span>{item.type} · {item.status}</span></div>
                  <pre>{item.content}</pre>
                  <div className="approval-actions">
                    <button className="secondary-button" type="button" onClick={() => updateApprovalStatus(item.id, "reviewing")}>검토중</button>
                    <button className="secondary-button" type="button" onClick={() => updateApprovalStatus(item.id, "approved")}>승인</button>
                    <button className="secondary-button" type="button" onClick={() => updateApprovalStatus(item.id, "blocked")}>보류</button>
                    <button className="ghost-light-button" type="button" onClick={() => removeApprovalItem(item.id)}>삭제</button>
                  </div>
                </article>
              )) : <div className="office-empty"><strong>승인 대기 항목이 없습니다.</strong><span>AI 사무국 결과에서 보고서나 GPT 질문을 승인함에 추가해 보세요.</span></div>}
            </div>
          </Panel>
        )}

        {section === "projectMemory" && (
          <Panel title="프로젝트 기억" description="확정 사실, 좋은 문장, 다음 액션을 프로젝트 단위로 저장합니다.">
            <div className="coach-bar">
              <div><strong>현재 프로젝트 저장</strong><span>민감자료 원본은 로컬/Drive에 두고, 앱에는 요약과 확정 사실만 남깁니다.</span></div>
              <button className="primary-button" type="button" onClick={saveCurrentMemory}>기억 저장</button>
            </div>
            <Field label="추가 메모" value={memoryNote} onChange={setMemoryNote} rows={6} wide placeholder="예: 관광두레 신청 마감은 6월 30일 11시, 양양은 우대지역..." />
            <div className="memory-list">
              {memoryEntries.length ? memoryEntries.map((entry) => (
                <article className="memory-card" key={entry.id}>
                  <strong>{entry.title}</strong>
                  <span>{entry.projectName} · {entry.source} · {new Date(entry.createdAt).toLocaleString()}</span>
                  <p>{entry.summary}</p>
                </article>
              )) : <div className="office-empty"><strong>저장된 프로젝트 기억이 없습니다.</strong><span>확정된 사실과 다음 액션을 저장하면 반복 설명이 줄어듭니다.</span></div>}
            </div>
          </Panel>
        )}

        {section === "notice" && (
          <Panel title="공고문이 원하는 답을 먼저 읽습니다" description="지원사업의 목적, 평가기준, 필수 조건, 차별화 기회를 정리합니다.">
            <div className="coach-bar">
              <div><strong>공고문 자동 분석</strong><span>공고문을 붙여넣거나 파일을 올린 뒤 분석을 누르세요.</span></div>
              <button className="primary-button" type="button" onClick={runNoticeAnalysis}>공고문 분석</button>
            </div>
            <label className="file-drop">
              <span>공고문 파일 첨부</span>
              <input type="file" accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.html,.htm,.json,.xml" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file, (text) => { updateProject({ noticeText: text }); notify("파일 내용을 불러왔습니다. 공고문 분석을 눌러 주세요."); });
                event.currentTarget.value = "";
              }} />
              <small>PDF, DOCX, HWPX, TXT 파일을 읽습니다. 스캔 이미지 PDF는 추후 OCR 단계에서 보완합니다.</small>
            </label>
            <div className="form-grid">
              <Field label="공고문 핵심 내용" value={project.noticeText} onChange={(noticeText) => updateProject({ noticeText })} rows={8} wide />
              <Field label="정책 목적" value={project.policyGoal} onChange={(policyGoal) => updateProject({ policyGoal })} />
              <Field label="평가 포인트" value={project.evaluationFocus} onChange={(evaluationFocus) => updateProject({ evaluationFocus })} />
              <Field label="필수 조건" value={project.requirements} onChange={(requirements) => updateProject({ requirements })} />
              <Field label="차별화 기회" value={project.advantageSignals} onChange={(advantageSignals) => updateProject({ advantageSignals })} />
            </div>
          </Panel>
        )}

        {section === "cowork" && (
          <Panel title="다음에 답해야 할 질문을 정리합니다" description="보완 질문, 작성 전략, 부족한 근거를 정리합니다.">
            <div className="coach-bar">
              <div><strong>질문 다시 만들기</strong><span>현재 내용에 맞춰 공동기획 질문을 생성합니다.</span></div>
              <button className="primary-button" type="button" onClick={() => { updateProject(generateCoaching(project)); notify("다음 질문을 다시 만들었습니다."); }}>질문 생성</button>
            </div>
            <div className="form-grid">
              <Field label="분석 메모" value={project.agentMemo} onChange={(agentMemo) => updateProject({ agentMemo })} rows={6} />
              <Field label="다음 질문" value={project.nextQuestions} onChange={(nextQuestions) => updateProject({ nextQuestions })} rows={6} />
              <Field label="작성 전략" value={project.writingStrategy} onChange={(writingStrategy) => updateProject({ writingStrategy })} rows={6} />
              <Field label="부족한 근거" value={project.missingEvidence} onChange={(missingEvidence) => updateProject({ missingEvidence })} rows={6} />
            </div>
          </Panel>
        )}

        {section === "ragRoom" && (
          <Panel title="좋은 사례를 모아 둡니다" description="저장한 사례에서 현재 사업과 맞는 참고 내용을 찾아옵니다.">
            <div className="coach-bar">
              <div><strong>내 자료에서 찾기</strong><span>브라우저 안에 저장된 사례에서 관련 내용을 찾습니다.</span></div>
              <button className="primary-button" type="button" onClick={searchKnowledge}>관련 사례 찾기</button>
            </div>
            <div className="form-grid">
              <TextInput label="문서 제목" value={knowledgeTitle} onChange={setKnowledgeTitle} placeholder="예: 우수 선정 사업계획서 샘플" />
              <TextInput label="문서 종류" value={knowledgeType} onChange={setKnowledgeType} placeholder="선정사례, 공고문, 평가표" />
              <Field label="문서 내용" value={knowledgeText} onChange={setKnowledgeText} rows={8} wide />
            </div>
            <div className="draft-actions bridge-actions">
              <label className="secondary-button file-button">파일에서 추가<input type="file" accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.html,.htm,.json,.xml" hidden onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readFile(file, (text) => { setKnowledgeTitle(knowledgeTitle || file.name); setKnowledgeText(text); notify("파일 내용을 사례 입력칸에 불러왔습니다."); });
                event.currentTarget.value = "";
              }} /></label>
              <button className="secondary-button" type="button" onClick={addKnowledgeDoc}>사례 저장</button>
              <button className="ghost-light-button" type="button" onClick={() => { if (window.confirm("저장한 사례를 모두 지울까요?")) setKnowledgeDocs([]); }}>사례 모두 지우기</button>
            </div>
            <Field label="찾고 싶은 내용" value={project.ragQuery} onChange={(ragQuery) => updateProject({ ragQuery })} rows={4} wide />
            <Field label="찾은 참고 내용" value={project.ragResults} onChange={(ragResults) => updateProject({ ragResults })} rows={12} wide />
            <div className="knowledge-library">
              {knowledgeDocs.length ? knowledgeDocs.map((doc) => <div className="knowledge-item" key={doc.id}><strong>{doc.title}</strong><span>{doc.type} · {doc.text.length.toLocaleString()}자 · {new Date(doc.createdAt).toLocaleDateString()}</span></div>) : <div className="knowledge-item"><strong>저장한 사례가 없습니다.</strong><span>좋은 사업계획서, 공고문, 평가표를 추가해 보세요.</span></div>}
            </div>
          </Panel>
        )}

        {section === "aiBridge" && (
          <Panel title="AI에게 물어볼 좋은 질문을 만듭니다" description="무료 기능만으로 어려운 판단은 최신 AI에게 복사해 물어볼 수 있도록 정리합니다.">
            <div className="coach-bar">
              <div><strong>질문 생성</strong><span>현재 공고, 아이디어, 사례 검색 결과를 하나의 깊은 질문으로 만듭니다.</span></div>
              <button className="primary-button" type="button" onClick={() => { updateProject({ modelPrompt: buildModelPrompt(project, knowledgeDocs) }); notify("AI에게 물어볼 질문을 만들었습니다."); }}>AI 질문 생성</button>
            </div>
            <div className="form-grid">
              <Field label="AI에 복사할 질문" value={project.modelPrompt} onChange={(modelPrompt) => updateProject({ modelPrompt })} rows={14} wide />
              <Field label="AI 답변 붙여넣기" value={project.modelResponse} onChange={(modelResponse) => updateProject({ modelResponse })} rows={12} wide />
              <Field label="반영 메모" value={project.aiSynthesis} onChange={(aiSynthesis) => updateProject({ aiSynthesis })} rows={8} wide />
            </div>
            <div className="draft-actions bridge-actions">
              <button className="secondary-button" type="button" onClick={() => copyText(project.modelPrompt || buildModelPrompt(project, knowledgeDocs), "AI 질문을 복사했습니다.")}>질문 복사</button>
              <button className="secondary-button" type="button" onClick={() => { if (!project.modelResponse) notify("먼저 AI 답변을 붙여넣어 주세요."); else updateProject({ aiSynthesis: absorbModelResponse(project.modelResponse) }); }}>답변 반영 메모화</button>
            </div>
          </Panel>
        )}

        {section === "visuals" && (
          <Panel title="시각자료 초안을 만듭니다" description="Mermaid로 논리모형, 추진 흐름, 성과 연결을 먼저 만듭니다.">
            <div className="coach-bar">
              <div><strong>오픈소스 시각화</strong><span>문장을 구조도로 바꾸는 첫 단계입니다.</span></div>
              <button className="primary-button" type="button" onClick={generateVisual}>시각자료 생성</button>
            </div>
            <div className="visual-layout">
              <Field label="다이어그램 코드" value={project.visualMermaid} onChange={(visualMermaid) => updateProject({ visualMermaid })} rows={18} monospace />
              <div className="visual-preview-wrap"><div className="visual-preview" dangerouslySetInnerHTML={{ __html: visualSvg || "시각자료 생성 버튼을 누르면 미리보기가 표시됩니다." }} /></div>
            </div>
            <div className="draft-actions bridge-actions">
              <button className="secondary-button" type="button" onClick={() => renderVisual(project.visualMermaid)}>미리보기 새로고침</button>
              <button className="secondary-button" type="button" onClick={() => copyText(project.visualMermaid, "다이어그램 코드를 복사했습니다.")}>코드 복사</button>
              <button className="secondary-button" type="button" onClick={() => { if (!visualSvg.includes("<svg")) notify("먼저 시각자료를 생성해 주세요."); else downloadTextFile(visualSvg, `${safeFileName(project.projectName, "planning-copilot-visual")}.svg`, "image/svg+xml;charset=utf-8"); }}>SVG 받기</button>
            </div>
          </Panel>
        )}

        {section === "integrations" && (
          <Panel title="프로젝트 링크" description="외부 서비스 링크와 메모를 이 프로젝트에 보관합니다. API 동기화나 자동 생성을 수행하지 않습니다.">
            <div className="form-grid">
              <TextInput label="Jira 작업 링크" value={project.jiraUrl} onChange={(jiraUrl) => updateProject({ jiraUrl })} type="url" placeholder="https://your-domain.atlassian.net/browse/..." />
              <TextInput label="Notion 페이지 링크" value={project.notionUrl} onChange={(notionUrl) => updateProject({ notionUrl })} type="url" placeholder="https://www.notion.so/..." />
              <TextInput label="Google Sheet 링크" value={project.spreadsheetUrl} onChange={(spreadsheetUrl) => updateProject({ spreadsheetUrl })} type="url" placeholder="https://docs.google.com/spreadsheets/..." />
              <TextInput label="Google Drive 폴더 링크" value={project.driveFolderUrl} onChange={(driveFolderUrl) => updateProject({ driveFolderUrl })} type="url" placeholder="https://drive.google.com/drive/folders/..." />
              <Field label="링크 메모" value={project.integrationMemo} onChange={(integrationMemo) => updateProject({ integrationMemo })} rows={6} wide placeholder="예: Jira는 할 일, Notion은 회의 기록, Sheet는 지표, Drive는 원본 문서 보관" />
            </div>
            <div className="integration-grid">
              <div className="integration-card"><strong>Jira</strong><span>작업 티켓과 진행상태</span><LinkButton href={project.jiraUrl} label="Jira 열기" /></div>
              <div className="integration-card"><strong>Notion</strong><span>회의, 아이디어, 리서치 노트</span><LinkButton href={project.notionUrl} label="Notion 열기" /></div>
              <div className="integration-card"><strong>Sheet</strong><span>성과지표, 예산, 일정</span><LinkButton href={project.spreadsheetUrl} label="Sheet 열기" /></div>
              <div className="integration-card"><strong>Drive</strong><span>공고문, 원본 사례, 제출 파일</span><LinkButton href={project.driveFolderUrl} label="Drive 열기" /></div>
            </div>
            <div className="open-source-note">
              <strong>현재 범위</strong>
              <span>현재는 링크 저장과 외부 페이지 열기만 지원합니다. Jira·Notion·Sheets·Drive 데이터의 자동 읽기, 쓰기, 동기화는 구현되어 있지 않습니다.</span>
            </div>
          </Panel>
        )}

        {section === "driveBackup" && (
          <Panel title="작업을 백업합니다" description="현재 프로젝트, 저장한 사례, AI 답변 메모를 파일 또는 Google Drive로 보관합니다.">
            <div className="coach-bar">
              <div><strong>현재 저장 구조</strong><span>빠른 작업 데이터는 브라우저에 저장하고, 원본 파일은 Google Drive에 보관하는 구조를 권장합니다.</span></div>
              <button className="primary-button" type="button" onClick={downloadArchive}>백업 파일 받기</button>
            </div>
            <div className="form-grid">
              <TextInput label="Google Drive 연결 주소" value={driveEndpoint} onChange={(value) => { setDriveEndpoint(value); saveDriveEndpoint(value); }} type="url" wide placeholder="https://script.google.com/macros/s/.../exec" />
              <details className="setup-details wide"><summary>Google Drive 연결 코드 보기</summary><Field label="연결 코드" value={APPS_SCRIPT_TEMPLATE} onChange={() => {}} rows={18} wide /></details>
            </div>
            <div className="draft-actions bridge-actions">
              <button className="secondary-button" type="button" onClick={() => copyText(APPS_SCRIPT_TEMPLATE, "연결 코드를 복사했습니다.")}>연결 코드 복사</button>
              <button className="secondary-button" type="button" onClick={backupToDrive}>Google Drive에 백업</button>
              <label className="secondary-button file-button">백업 파일 가져오기<input type="file" accept=".json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) restoreArchive(file); event.currentTarget.value = ""; }} /></label>
            </div>
          </Panel>
        )}

        {section === "sample" && <SimpleGrid title="좋은 문서의 구조를 우리 사업 기준으로 바꿉니다" description="문장을 베끼지 않고 구조, 논리, 평가자 신호를 가져옵니다." fields={[
          ["참고 문서/출처", "sampleSource"], ["좋았던 구조", "sampleStructure"], ["평가자에게 주는 신호", "sampleSignals"], ["우리 사업에 적용할 방식", "sampleAdaptation"]
        ]} project={project} update={updateProject} />}
        {section === "idea" && <SimpleGrid title="작성자의 아이디어를 선명하게 만듭니다" description="현장 경험과 고유 관점을 정책 언어로 번역합니다." fields={[
          ["핵심 아이디어", "coreIdea"], ["대상자", "targetUsers"], ["현장 근거", "fieldEvidence"], ["작성자의 고유 관점", "founderInsight"]
        ]} project={project} update={updateProject} />}
        {section === "problem" && <SimpleGrid title="문제를 사업의 언어로 정의합니다" description="증상, 원인, 기존 해결책의 한계, 지금 필요한 이유를 분리합니다." fields={[
          ["문제 상황", "problemSituation"], ["원인 분석", "rootCauses"], ["기존 해결책의 한계", "existingLimits"], ["지금 필요한 이유", "whyNow"]
        ]} project={project} update={updateProject} />}
        {section === "logic" && <SimpleGrid title="사업의 인과관계를 설계합니다" description="투입에서 중장기성과까지 평가자가 이해할 수 있는 변화 경로를 만듭니다." fields={[
          ["투입", "inputs"], ["활동", "activities"], ["산출", "outputs"], ["단기성과", "shortOutcomes"], ["중장기성과", "longOutcomes"]
        ]} project={project} update={updateProject} logic />}
        {section === "metrics" && <Panel title="성과지표는 사업 목적의 증거입니다" description="과정, 산출, 결과, 확산 지표를 구분하고 측정 방법까지 설계합니다."><TableEditor headers={["구분", "지표명", "목표값", "측정 방법"]} rows={project.metricsTable} onChange={(metricsTable) => updateProject({ metricsTable })} addLabel="지표 추가" /></Panel>}
        {section === "execution" && <SimpleGrid title="실행 가능한 계획으로 바꿉니다" description="일정, 역할, 예산, 위험 대응을 구체화합니다." fields={[
          ["추진 단계", "milestones"], ["추진 체계", "teamSystem"], ["예산 설계", "budgetPlan"], ["위험 대응", "riskPlan"]
        ]} project={project} update={updateProject} />}
        {section === "blueprint" && <Panel title="서비스 디자인 관점으로 운영 경험을 봅니다" description="사용자 여정과 운영 접점을 분리하면 실행계획의 현실감이 높아집니다."><TableEditor headers={["단계", "사용자 행동", "접점", "운영 방식", "실패 가능성"]} rows={project.blueprintTable} onChange={(blueprintTable) => updateProject({ blueprintTable })} addLabel="접점 추가" /></Panel>}
        {section === "draft" && (
          <Panel title="공고 양식에 맞는 초안으로 조립합니다" description="입력한 내용을 사업계획서의 기본 골격으로 정리합니다.">
            <div className="draft-actions">
              <button className="primary-button" type="button" onClick={() => { updateProject({ draftOutput: generateDraftText(project) }); notify("초안을 생성했습니다."); }}>초안 생성</button>
              <button className="secondary-button" type="button" onClick={() => copyText(project.draftOutput || generateDraftText(project), "초안을 복사했습니다.")}>초안 복사</button>
            </div>
            <textarea className="draft-output" rows={24} value={project.draftOutput} onChange={(event) => updateProject({ draftOutput: event.target.value })} />
          </Panel>
        )}
      </section>
      <div className={`toast ${toast ? "is-visible" : ""}`} role="status" aria-live="polite">{toast}</div>
    </main>
  );
}

function OfficeResultView({
  result,
  onCopyReport,
  onCopyPrompt,
  onCopyDrafts,
  onSendPrompt,
  onSendReport,
  onDownloadReport,
  onAddReportToApproval,
  onAddPromptToApproval
}: {
  result: OfficeResult;
  onCopyReport: () => void;
  onCopyPrompt: () => void;
  onCopyDrafts: () => void;
  onSendPrompt: () => void;
  onSendReport: () => void;
  onDownloadReport: () => void;
  onAddReportToApproval: () => void;
  onAddPromptToApproval: () => void;
}) {
  const activeAgentIds = Array.from(new Set(result.tasks.map((task) => task.agentId)));
  const activeRoles = agentRoles.filter((role) => activeAgentIds.includes(role.id));
  const visibleDrafts = result.drafts.filter((draft) => draft.agentId !== "chief");
  const execution = result.execution;

  return (
    <div className="office-results">
      <div className={`office-execution-note ${execution?.status === "failed" ? "has-error" : ""}`} role={execution?.status === "failed" ? "alert" : "status"}>
        <strong>{execution?.mode === "ollama"
          ? execution.status === "completed" ? `Ollama 단일 실행 완료 · ${execution.model || "모델"}` : "Ollama 실행 실패"
          : execution?.mode === "simulation" ? "규칙 기반 템플릿 결과" : "이전 저장 세션 · 실행 경로 확인 불가"}</strong>
        <span>{execution?.mode === "ollama"
          ? execution.status === "completed"
            ? "실제 모델이 생성한 내용은 아침 보고서입니다. 작업 분해와 역할별 초안은 규칙 기반 참고 자료이며, 병렬 에이전트 실행이 아닙니다."
            : `${execution.error || "모델 응답을 받지 못했습니다."} 아래 역할별 초안은 템플릿 결과이며 실제 모델 생성물이 아닙니다.`
          : "AI 모델을 호출하지 않았습니다. 역할 분배와 각 초안은 규칙 기반 예시입니다."}</span>
        {execution?.contextSources.length ? <small>{execution.mode === "ollama" ? "Ollama 입력 자료" : "템플릿 입력"}: {execution.contextSources.join(" · ")}</small> : null}
      </div>
      <section className="office-action-bar" aria-label="사무국 결과 활용">
        <div>
          <strong>다음 작업으로 바로 보내기</strong>
          <span>보고서를 복사하거나 다른 탭으로 넘겨 후속 작업 시간을 줄입니다.</span>
        </div>
        <div className="office-action-buttons">
          <button className="secondary-button" type="button" onClick={onCopyDrafts}>초안 전체 복사</button>
          <button className="secondary-button" type="button" onClick={onCopyPrompt}>GPT 질문 복사</button>
          <button className="secondary-button" type="button" onClick={onSendPrompt}>AI 질문 탭으로</button>
          <button className="secondary-button" type="button" onClick={onSendReport}>초안 조립으로</button>
          <button className="secondary-button" type="button" onClick={onAddReportToApproval}>보고서 승인함</button>
          <button className="secondary-button" type="button" onClick={onAddPromptToApproval}>질문 승인함</button>
          <button className="ghost-light-button" type="button" onClick={onDownloadReport}>보고서 받기</button>
        </div>
      </section>

      <section className="office-block">
        <div className="office-block-title"><span>① 작업 분해</span></div>
        <div className="table-wrap office-table-wrap">
          <table>
            <thead>
              <tr><th>ID</th><th>담당</th><th>작업</th><th>선행</th></tr>
            </thead>
            <tbody>
              {result.tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.id}</td>
                  <td>{roleSummary(task.agentId)}</td>
                  <td>{task.title}<br /><span className="muted-inline">{task.input}</span></td>
                  <td>{task.dependsOn.join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="office-block">
        <div className="office-block-title"><span>② 담당 에이전트</span></div>
        <div className="agent-role-grid">
          {activeRoles.map((role) => (
            <article className="agent-role-card" key={role.id}>
              <strong>{role.name}</strong>
              <span>{role.role}</span>
              <small>{role.outputFormat}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="office-block">
        <div className="office-block-title"><span>{execution?.mode === "ollama" ? "③ 역할별 참고 템플릿" : "③ 역할별 템플릿 초안"}</span></div>
        <div className="office-draft-list">
          {visibleDrafts.map((draft) => (
            <article className="office-draft" key={draft.taskId}>
              <div><strong>{roleSummary(draft.agentId)}</strong><span>{draftStatusLabel(draft)}</span></div>
              <pre>{draft.content}</pre>
            </article>
          ))}
        </div>
      </section>

      <section className="office-block">
        <div className="office-block-title">
          <span>④ 아침 보고서</span>
          <button className="secondary-button" type="button" onClick={onCopyReport}>보고서 복사</button>
        </div>
        <textarea className="draft-output office-report-output" rows={24} value={result.report.markdown} readOnly />
      </section>

      <section className="office-block">
        <div className="office-block-title">
          <span>⑤ 외부 AI 질문 패키지 · 선택</span>
          <button className="secondary-button" type="button" onClick={onCopyPrompt}>통합 질문 복사</button>
        </div>
        <div className="prompt-package">
          <div className="prompt-guide">
            {result.promptPackage.usageGuide.map((guide) => (
              <span key={guide}>{guide}</span>
            ))}
          </div>
          <Field label="유료 GPT/Claude에 복사할 통합 질문" value={result.promptPackage.unifiedPrompt} onChange={() => {}} rows={18} wide />
          <div className="role-prompt-grid">
            {result.promptPackage.rolePrompts.map((item) => (
              <article className="role-prompt-card" key={`${item.agentId}-${item.title}`}>
                <strong>{item.title}</strong>
                <textarea rows={10} value={item.prompt} readOnly />
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function formatOllamaOfficeReport(command: string, model: string, sources: string[], output: string, truncated: boolean) {
  const sourceLines = sources.length ? sources.map((source) => `- ${source}`).join("\n") : "- 사용자 명령만 사용";
  return `# AI 사무국 통합 보고서\n\n- 요청: ${command}\n- 실행 경로: Ollama 로컬 모델 ${model} · 단일 호출\n- 입력 자료:\n${sourceLines}${truncated ? "\n- 안내: 입력 길이 제한에 따라 일부 자료가 생략됨" : ""}\n\n---\n\n${output.trim()}\n\n---\n\n> 검토 전 초안입니다. 정책·일정·예산·기관 정보와 출처 표시를 확인한 뒤 사용하세요. 외부 발송·게시·제출은 수행하지 않았습니다.\n`;
}

function formatOllamaOfficeFailure(command: string, model: string, error: string, templateReport: string) {
  return `# Ollama 통합 초안 생성 실패\n\n- 요청: ${command}\n- 모델: ${model}\n- 오류: ${error}\n\n> 아래 내용은 규칙 기반 템플릿 보고서이며 Ollama가 생성한 결과가 아닙니다. 연결과 모델 이름을 확인한 뒤 다시 실행하세요.\n\n---\n\n${templateReport}`;
}

function draftStatusLabel(draft: AgentDraft) {
  const status = draft.reviewStatus === "approved" ? "승인" : draft.reviewStatus === "revised" ? "수정 권고" : "반려";
  return draft.reviewNote ? `${status} · ${draft.reviewNote}` : status;
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="panel is-visible">
      <div className="section-intro"><h3>{title}</h3><p>{description}</p></div>
      {children}
    </section>
  );
}

function SimpleGrid({
  title,
  description,
  fields,
  project,
  update,
  logic = false
}: {
  title: string;
  description: string;
  fields: Array<[string, keyof ProjectData]>;
  project: ProjectData;
  update: (patch: Partial<ProjectData>) => void;
  logic?: boolean;
}) {
  return (
    <Panel title={title} description={description}>
      <div className={logic ? "logic-board" : "form-grid"}>
        {fields.map(([label, key]) => (
          <Field key={String(key)} label={label} value={String(project[key] || "")} onChange={(value) => update({ [key]: value } as Partial<ProjectData>)} rows={logic ? 6 : 5} />
        ))}
      </div>
    </Panel>
  );
}
