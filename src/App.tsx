import { useEffect, useMemo, useState } from "react";
import { agentRoles } from "./data/agentRoles";
import { grantPresets } from "./data/grantPresets";import { ControlTowerView } from "./components/ControlTowerView";
import { GrantBudgetView, GrantChecklistView, GrantReportView } from "./components/GrantWorkflowViews";
import { GrantStepFlow } from "./components/GrantStepFlow";
import { WorkHomeView } from "./components/WorkHomeView";
import { WorkbrainExportView } from "./components/WorkbrainExportView";
import { TemplateFillView } from "./components/TemplateFillView";
import { ProjectBoardView } from "./components/ProjectBoardView";
import { PiiGuardNotice } from "./components/PiiGuardNotice";
import { exampleProject } from "./data/exampleProject";
import { analyzeNotice, formatKnowledgeResults, generateCoaching, projectSearchQuery, searchKnowledgeDocs } from "./lib/analysis";
import { generateDraftText } from "./lib/draft";
import { extractDocument } from "./lib/fileText";
import {
  buildRuleBasedFill,
  buildTemplateFillPrompt,
  checkStructureCoverage,
  describeSampleSupport,
  normalizeProfile,
  parseSampleTemplate,
  summarizeSchema,
  type TemplateProfile,
  type SampleBlock,
  type TemplateSchema
} from "./lib/sampleTemplateParser.mjs";
import { createEmptyTemplateSession, loadTemplateSession, saveTemplateSession, type TemplateSession } from "./lib/templateStorage";
import { absorbModelResponse, buildDraftPolishPrompt, buildModelPrompt } from "./lib/prompts";
import { currentModelName, listOllamaModels, modelLabel, modelProviderOptions, modelSafetyNote, runModelPrompt } from "./lib/modelRouter";
import { providerConfig, remoteModelField, validateApiKey, ADVANCED_MODEL_PROVIDERS, PRIMARY_MODEL_PROVIDERS, isAdvancedModelProvider, providerAvailabilityNote } from "./lib/modelSafety.mjs";
import { WORKSPACE_LINKS } from "./lib/davidWorkbrainExport.mjs";
import { applyPreset as applyGrantPreset, budgetSummary, createEmptyGrantPlan, formatWon, hasGrantWork, sanitizeGrantPlan } from "./lib/grantWorkflow.mjs";
import { findGrantPreset } from "./data/grantPresets";
import { buildOfficeContext, buildOfficeModelPrompt } from "./lib/agentOfficePrompt.mjs";
import { roleSummary, runOffice } from "./lib/agentOffice";
import { clearControlTowerState, loadControlTowerState, saveControlTowerApproval, saveControlTowerSnapshot } from "./lib/controlTowerStorage";
import {
  downloadTextFile,
  loadDriveEndpoint,
  loadKnowledgeDocs,
  loadModelSettings,
  loadOfficeSession,
  loadApprovalItems,
  loadProjectMemory,
  safeFileName,
  saveDriveEndpoint,
  saveKnowledgeDocs,
  saveModelSettings,
  saveOfficeSession,
  saveApprovalItems,
  saveProjectMemory
} from "./lib/storage";
import { maskPii } from "./lib/piiGuard.mjs";
import {
  addProject,
  duplicateProject as duplicateWorkspaceProject,
  findProject,
  projectProgress,
  removeProject as removeWorkspaceProject,
  dDayInfo,
  selectProject,
  updateProjectMeta,
  PROJECT_STATUSES,
  type ProjectMeta,
  type ProjectStatusId,
  type ProjectTypeId,
  type Workspace
} from "./lib/projectWorkspace.mjs";
import {
  copySlotData,
  exportWorkspaceArchive,
  importWorkspaceArchive,
  loadPiiMaskPreference,
  loadProjectData,
  loadSlotGrantPlan,
  loadWorkspaceBundle,
  loadWorkspaceForProject,
  removeSlotData,
  sanitizeProjectData,
  savePiiMaskPreference,
  saveProjectData,
  saveSlotGrantPlan,
  saveWorkspace
} from "./lib/workspaceStorage";
import { templateStorageKey } from "./lib/templateStorage";
import { buildMermaid } from "./lib/visuals";
import { emptyProject, type AgentDraft, type ApprovalItem, type ApprovalStatus, type ControlTowerApprovalStatus, type ControlTowerSnapshot, type ControlTowerState, type GrantPlan, type KnowledgeDoc, type ModelProvider, type ModelSettings, type ModelRunResult, type OfficeResult, type ProjectData, type ProjectMemoryEntry, type SectionId } from "./types";

// 사이드바에 남기는 메뉴는 실제로 매일 쓰는 10개다. 나머지 실험 화면은 코드·주소를 그대로 두고
// '실험실'을 열었을 때만 보여 준다(쓰지 않는 메뉴로 첫 화면을 채우지 않는다).
const navGroups: Array<{ title: string; items: Array<{ id: SectionId; label: string }> }> = [
  {
    title: "업무 홈",
    items: [
      { id: "home", label: "시작 화면" },
      { id: "projectBoard", label: "사업 관리" }
    ]
  },
  {
    title: "문서·예산 실무",
    items: [
      { id: "notice", label: "공고 해석" },
      { id: "templateFill", label: "샘플 양식 채우기" },
      { id: "grantBudget", label: "예산 편성" },
      { id: "grantChecklist", label: "정산 증빙" },
      { id: "grantReport", label: "결과보고" },
      { id: "workbrainExport", label: "워크브레인 내보내기" }
    ]
  },
  {
    title: "설정",
    items: [
      { id: "modelSettings", label: "모델·보안 설정" },
      { id: "driveBackup", label: "백업·가져오기" }
    ]
  }
];

// 실험실: 기본 화면에서 뺐지만 지우지는 않은 화면. 실제 작업 흐름에 섞이지 않게 따로 모아 둔다.
const labNavItems: Array<{ id: SectionId; label: string }> = [
  { id: "agentOffice", label: "AI 사무국" },
  { id: "controlTower", label: "업무 관제탑" },
  { id: "draft", label: "초안 조립" },
  { id: "aiBridge", label: "외부 AI 질문" },
  { id: "approvalInbox", label: "승인함" },
  { id: "projectMemory", label: "프로젝트 기억" },
  { id: "ragRoom", label: "사례 모으기" },
  { id: "sample", label: "샘플 분해" },
  { id: "visuals", label: "시각자료" },
  { id: "integrations", label: "프로젝트 링크" },
  { id: "cowork", label: "질문 받기" },
  { id: "idea", label: "아이디어 인터뷰" },
  { id: "problem", label: "문제정의" },
  { id: "logic", label: "논리모형" },
  { id: "metrics", label: "성과지표" },
  { id: "execution", label: "실행설계" },
  { id: "blueprint", label: "서비스 블루프린트" }
];

const navItems = [...navGroups.flatMap((group) => group.items), ...labNavItems];
const DEFAULT_NAV_GROUP = navGroups[0].title;

const PALETTES: Array<{ id: string; label: string }> = [
  { id: "forest", label: "현장 초록" },
  { id: "blue", label: "행정 파랑" },
  { id: "ink", label: "문서 먹색" }
];
const PALETTE_KEY = "planningCopilotPalette";
const LAB_KEY = "planningCopilotLabOpen";

// 모델 설정 화면: 브라우저에서 바로 쓰는 경로를 먼저, 차단·로컬 경로는 접이식 영역으로 내린다.
// 카드 순서는 안내 문구의 순서와 맞춘다: 템플릿 → 무료 3종 / 차단 3종 → 로컬 프록시 → Ollama.
function pickModelOptions(ids: readonly string[]) {
  return ids
    .map((id) => modelProviderOptions.find((option) => option.id === id))
    .filter((option): option is (typeof modelProviderOptions)[number] => Boolean(option));
}
const primaryModelOptions = pickModelOptions(PRIMARY_MODEL_PROVIDERS);
const advancedModelOptions = pickModelOptions(ADVANCED_MODEL_PROVIDERS);
const GRANT_SECTIONS: SectionId[] = ["grantBudget", "grantChecklist", "grantReport", "workbrainExport"];
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
        <table className="stacked-table">
          <thead>
            <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {headers.map((header, cellIndex) => (
                  <td key={header} data-label={header}>
                    <input
                      value={row[cellIndex] || ""}
                      placeholder={header}
                      aria-label={`${rowIndex + 1}행 ${header}`}
                      onChange={(event) => updateCell(rowIndex, cellIndex, event.target.value)}
                    />
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
  // 사업 보드와 현재 사업의 작업 데이터를 한 번에 읽는다. 예전 단일 저장 키에 작업이 있으면 첫 사업으로 옮긴다.
  const [initial] = useState(() => loadWorkspaceBundle());
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const [project, setProject] = useState<ProjectData>(initial.project);
  const [knowledgeDocs, setKnowledgeDocs] = useState<KnowledgeDoc[]>(() => loadKnowledgeDocs());
  const [section, setSection] = useState<SectionId>("home");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 색 팔레트는 사용자가 고른 것을 기억한다(기본: 현장 초록).
  const [palette, setPalette] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(PALETTE_KEY) || "";
      return PALETTES.some((item) => item.id === saved) ? saved : "forest";
    } catch {
      return "forest";
    }
  });
  // 실험실: 기본 메뉴에서 뺀 화면. 사용자가 열어 둔 상태를 기억한다.
  const [labOpen, setLabOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LAB_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [advancedModelOpen, setAdvancedModelOpen] = useState(false);
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
  const [grantPlan, setGrantPlan] = useState<GrantPlan>(initial.grantPlan);
  const [templateSession, setTemplateSession] = useState<TemplateSession>(() => loadTemplateSession(initial.workspace.activeProjectId));
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState("");
  // 개인정보 마스킹은 기본 켜짐. 끄면 그 선택을 기억하되, 켜라는 안내는 화면에 남긴다.
  const [piiMaskEnabled, setPiiMaskEnabled] = useState(() => loadPiiMaskPreference());
  // API 키는 이 탭의 메모리에만 둔다. localStorage·백업·아카이브 어디에도 저장하지 않는다.
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [remoteAck, setRemoteAck] = useState(false);
  const [freeRunOutput, setFreeRunOutput] = useState("");
  const [freeRunError, setFreeRunError] = useState("");

  const sectionTitle = useMemo(() => navItems.find((item) => item.id === section)?.label || "", [section]);
  // 내보낼 내용이 있는지: 홈 첫 화면에서 빈 프로젝트로 내보내기 하는 일을 막는다.
  const hasAnyWork = useMemo(
    () => hasGrantWork(grantPlan) || Boolean(project.projectName.trim() || project.noticeText.trim() || project.draftOutput.trim()),
    [grantPlan, project.projectName, project.noticeText, project.draftOutput]
  );

  // 외부 AI로 나갈 질문·프롬프트는 화면에서 미리 점검한다. (스캔은 브라우저 안에서만)
  const aiQuestionPreview = useMemo(() => project.modelPrompt || buildModelPrompt(project, knowledgeDocs), [project, knowledgeDocs]);
  const templatePromptPreview = useMemo(
    () => (templateSession.schema ? buildTemplateFillPrompt({ schema: templateSession.schema, profile: templateSession.profile }) : ""),
    [templateSession]
  );

  useEffect(() => {
    saveProjectData(workspace.activeProjectId, project);
  }, [project, workspace.activeProjectId]);

  useEffect(() => {
    saveKnowledgeDocs(knowledgeDocs);
  }, [knowledgeDocs]);

  useEffect(() => {
    // 색 팔레트는 문서 뿌리에 표시를 달아 CSS 토큰만 바꾼다.
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem(PALETTE_KEY, palette);
    } catch {
      /* 저장할 수 없는 환경(사생활 보호 모드)에서는 이번 화면에만 적용한다. */
    }
  }, [palette]);

  useEffect(() => {
    try {
      localStorage.setItem(LAB_KEY, labOpen ? "1" : "0");
    } catch {
      /* 위와 같은 이유로 무시한다. */
    }
  }, [labOpen]);

  useEffect(() => {
    // 실험실 화면으로 들어오면 그 그룹을 펼쳐 어디에 있는지 보이게 한다.
    if (labNavItems.some((item) => item.id === section)) setLabOpen(true);
  }, [section]);

  useEffect(() => {
    // 하단 고정 바로 다음 단계로 넘어갈 때, 새 화면이 중간부터 보이지 않게 맨 위에서 시작한다.
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [section]);

  useEffect(() => {
    if (isAdvancedModelProvider(modelSettings.provider)) setAdvancedModelOpen(true);
  }, [modelSettings.provider]);

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

  useEffect(() => {
    saveSlotGrantPlan(workspace.activeProjectId, grantPlan);
  }, [grantPlan, workspace.activeProjectId]);

  useEffect(() => {
    saveTemplateSession(templateSession, workspace.activeProjectId);
  }, [templateSession, workspace.activeProjectId]);

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  // 사업 카드의 이름·진행률은 현재 사업 입력값에서 다시 계산해 보드에 반영한다.
  useEffect(() => {
    const percent = projectProgress({ project, plan: grantPlan }).percent;
    const typedName = project.projectName.trim().slice(0, 80);
    setWorkspace((current) => {
      const target = findProject(current, current.activeProjectId);
      if (!target) return current;
      const patch: Partial<ProjectMeta> = {};
      if (target.progress !== percent) patch.progress = percent;
      if (typedName && target.name !== typedName) patch.name = typedName;
      if (!Object.keys(patch).length) return current;
      return updateProjectMeta(current, target.id, patch);
    });
  }, [project, grantPlan]);

  useEffect(() => {
    if (initial.migrated) setToast("예전 작업 데이터를 첫 사업으로 옮겼습니다. 사업 관리에서 확인해 주세요.");
  }, [initial.migrated]);

  const updateProject = (patch: Partial<ProjectData>) => setProject((current) => ({ ...current, ...patch }));
  const notify = (message: string) => setToast(message);

  /* ── 사업 보드: 생성·전환·복제·삭제 ─────────────────────────── */

  const activeMeta = findProject(workspace, workspace.activeProjectId);

  /** 사업을 옮기기 전에 지금 사업을 확실히 저장한다. (효과가 이미 저장하지만 전환 직전에 한 번 더 못박는다) */
  const persistActiveProject = () => {
    saveProjectData(workspace.activeProjectId, project);
    saveSlotGrantPlan(workspace.activeProjectId, grantPlan);
    saveTemplateSession(templateSession, workspace.activeProjectId);
  };

  const switchProject = (id: string) => {
    if (!id || id === workspace.activeProjectId) return;
    const target = findProject(workspace, id);
    if (!target) return;
    persistActiveProject();
    const next = loadWorkspaceForProject(id);
    setWorkspace((current) => selectProject(current, id));
    setProject(next.project);
    setGrantPlan(next.grantPlan);
    setTemplateSession(loadTemplateSession(id));
    setMobileNavOpen(false);
    notify(`‘${target.name}’ 사업으로 전환했습니다.`);
  };

  const createNewProject = (meta: { name: string; type: ProjectTypeId; status: ProjectStatusId; deadline: string }) => {
    const result = addProject(workspace, meta);
    if (!result.project) {
      notify(result.error || "사업을 만들지 못했습니다.");
      return;
    }
    persistActiveProject();
    saveProjectData(result.project.id, { ...emptyProject, projectName: result.project.name });
    saveSlotGrantPlan(result.project.id, createEmptyGrantPlan());
    setWorkspace(result.workspace);
    setProject({ ...emptyProject, projectName: result.project.name });
    setGrantPlan(createEmptyGrantPlan());
    setTemplateSession(createEmptyTemplateSession());
    notify(`‘${result.project.name}’ 사업을 만들었습니다. 이제 이 사업으로 작업합니다.`);
  };

  const duplicateProjectById = (id: string) => {
    const source = findProject(workspace, id);
    if (!source) return;
    const result = duplicateWorkspaceProject(workspace, id);
    if (!result.project) {
      notify(result.error || "사업을 복제하지 못했습니다.");
      return;
    }
    persistActiveProject();
    copySlotData(id, result.project.id);
    setWorkspace(result.workspace);
    setProject(loadProjectData(result.project.id));
    setGrantPlan(loadSlotGrantPlan(result.project.id));
    setTemplateSession(loadTemplateSession(id));
    notify(`‘${source.name}’ 사업을 ‘${result.project.name}’(으)로 복제했습니다.`);
  };

  const removeProjectById = (id: string) => {
    const target = findProject(workspace, id);
    if (!target) return;
    if (!window.confirm(`‘${target.name}’ 사업을 삭제할까요? 이 브라우저에 저장된 이 사업의 입력값·예산·정산·양식 작업이 함께 사라집니다.`)) return;
    const result = removeWorkspaceProject(workspace, id);
    if (!result.removed) {
      notify(result.error || "사업을 삭제하지 못했습니다.");
      return;
    }
    removeSlotData(id);
    try {
      localStorage.removeItem(templateStorageKey(id));
    } catch {
      // 이미 지워졌으면 그대로 둔다.
    }
    setWorkspace(result.workspace);
    if (workspace.activeProjectId === id) {
      const next = loadWorkspaceForProject(result.workspace.activeProjectId);
      setProject(next.project);
      setGrantPlan(next.grantPlan);
      setTemplateSession(loadTemplateSession(result.workspace.activeProjectId));
    }
    notify(`‘${target.name}’ 사업을 삭제했습니다.`);
  };

  const changeProjectMeta = (id: string, patch: Partial<ProjectMeta>) => {
    setWorkspace((current) => updateProjectMeta(current, id, patch));
  };

  /* ── 개인정보 가드 ────────────────────────────────────────── */

  const setPiiMask = (enabled: boolean) => {
    setPiiMaskEnabled(enabled);
    savePiiMaskPreference(enabled);
  };

  /** 외부 AI·복사로 나가는 텍스트를 보내기 직전에 가린다. */
  const maskForExternal = (text: string, label: string) => {
    if (!piiMaskEnabled) return text;
    const masked = maskPii(text);
    if (masked.total) notify(`${label}: 개인정보 ${masked.total}건(${masked.badgeText})을 [연락처_1] 형태로 가린 뒤 보냈습니다.`);
    return masked.text;
  };

  const readFile = (file: File, onText: (text: string) => void) => {
    extractDocument(file)
      .then(({ text, warning }) => {
        if (warning) notify(warning);
        if (!text) return;
        onText(text);
      })
      .catch(() => notify("파일을 읽지 못했습니다. 문서 내용을 복사해 붙여넣어 주세요."));
  };

  const importDocument = (file: File) => {
    if (project.noticeText.trim() && !window.confirm("공고 해석 화면에 이미 입력된 내용이 있습니다. 불러온 문서 내용으로 바꿀까요?")) return;
    readFile(file, (text) => {
      updateProject({ noticeText: text });
      setSection("notice");
      notify(`${file.name} 내용을 공고 해석 화면에 불러왔습니다. 내용을 확인하고 분석을 눌러 주세요.`);
    });
  };

  /* ── 샘플 양식 구조 파싱 · 맞춤 채우기 ───────────────────────── */

  const updateTemplateSession = (patch: Partial<TemplateSession>) =>
    setTemplateSession((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));

  const applyTemplateDocument = (
    document: { text: string; blocks: SampleBlock[]; format: string },
    fileName: string
  ) => {
    const schema: TemplateSchema = parseSampleTemplate({
      text: document.text,
      blocks: document.blocks,
      fileName,
      format: document.format
    });
    const summary = summarizeSchema(schema);
    setTemplateError("");
    updateTemplateSession({
      schema,
      result: "",
      profile: normalizeProfile({ ...templateSession.profile, projectName: templateSession.profile.projectName || project.projectName })
    });
    if (!summary.sections && !summary.tables && !summary.slots) {
      notify("양식 구조를 찾지 못했습니다. 목차 번호와 표를 확인하거나 내용을 붙여넣어 보세요.");
      return;
    }
    notify(`${fileName} 구조를 읽었습니다. 섹션 ${summary.sections}개 · 표 ${summary.tables}개 · 작성 항목 ${summary.slots}개`);
  };

  const parseTemplateFile = (file: File) => {
    const support = describeSampleSupport(file.name);
    if (!support.supported) {
      notify(support.message);
      return;
    }
    setTemplateBusy(true);
    extractDocument(file)
      .then((document) => {
        if (document.warning) notify(document.warning);
        if (!document.text) return;
        applyTemplateDocument(document, file.name);
      })
      .catch(() => notify("양식 파일을 읽지 못했습니다. 양식 내용을 복사해 붙여넣어 주세요."))
      .finally(() => setTemplateBusy(false));
  };

  const parseTemplateText = (text: string) => {
    if (!text.trim()) {
      notify("양식 내용을 붙여넣어 주세요.");
      return;
    }
    applyTemplateDocument({ text, blocks: [], format: "markdown" }, "붙여넣은 양식");
  };

  /** 프로젝트·예산 화면에 이미 있는 값을 양식 프로필로 가져온다. 직접 쓴 값은 덮어쓰지 않는다. */
  const collectProjectProfile = (): TemplateProfile => {
    const budget = budgetSummary(grantPlan);
    const schedule = [
      grantPlan.schedule?.projectStart ? `시작 ${grantPlan.schedule.projectStart}` : "",
      grantPlan.schedule?.projectEnd ? `종료 ${grantPlan.schedule.projectEnd}` : "",
      grantPlan.schedule?.reportDeadline ? `결과보고 ${grantPlan.schedule.reportDeadline}` : ""
    ].filter(Boolean).join(" · ");
    const current = templateSession.profile;
    return normalizeProfile({
      ...current,
      projectName: current.projectName || project.projectName,
      organization: current.organization || grantPlan.agency,
      audience: current.audience || project.targetUsers,
      summary: current.summary || [project.coreIdea, project.problemSituation, project.fieldEvidence].filter(Boolean).join("\n").slice(0, 700),
      budget: current.budget || (budget.total > 0 ? `총 ${formatWon(budget.total)}` : ""),
      schedule: current.schedule || schedule,
      evidence: current.evidence || project.requirements,
      notes: current.notes || project.evaluationFocus
    });
  };

  const useProjectValuesForTemplate = () => {
    updateTemplateSession({ profile: collectProjectProfile() });
    notify("프로젝트 입력값을 가져왔습니다. 빈 항목은 직접 채워 주세요.");
  };

  const runTemplateFill = async (mode: "ai" | "rule") => {
    const schema = templateSession.schema;
    if (!schema) {
      notify("먼저 샘플 양식을 올리거나 붙여넣어 구조를 읽어 주세요.");
      return;
    }
    if (templateBusy) return;
    setTemplateError("");

    if (mode === "rule") {
      updateTemplateSession({ result: buildRuleBasedFill({ schema, profile: templateSession.profile }) });
      notify("규칙 기반으로 양식을 채웠습니다. 빈칸은 ‘확인 필요’로 표시했습니다.");
      return;
    }

    if (modelSettings.provider === "simulation") {
      updateTemplateSession({ result: buildRuleBasedFill({ schema, profile: templateSession.profile }) });
      notify("템플릿 모드입니다. AI 호출 없이 규칙 기반으로 채웠습니다. 실제 AI로 채우려면 모델 설정에서 경로를 고르세요.");
      return;
    }

    const remoteConfig = providerConfig(modelSettings.provider);
    if (remoteConfig) {
      const keyCheck = validateApiKey(modelSettings.provider, apiKeys[modelSettings.provider] || "");
      if (!keyCheck.ok) {
        setTemplateError(keyCheck.message);
        notify(keyCheck.message);
        return;
      }
      if (!remoteAck) {
        setTemplateError("모델 설정에서 외부 전송 확인을 먼저 체크해 주세요.");
        notify("모델 설정에서 외부 전송 확인을 먼저 체크해 주세요.");
        return;
      }
    }

    setTemplateBusy(true);
    try {
      const prompt = maskForExternal(buildTemplateFillPrompt({ schema, profile: templateSession.profile }), "양식 채우기");
      const modelResult = await runModelPrompt(prompt, modelSettings, { apiKey: apiKeys[modelSettings.provider] || "" });
      if (!modelResult.ok) {
        // AI가 실패해도 작업이 멈추지 않게, 같은 양식 구조로 규칙 기반 초안을 먼저 채워 둔다.
        updateTemplateSession({ result: buildRuleBasedFill({ schema, profile: templateSession.profile }) });
        setTemplateError(modelResult.error || "모델 실행에 실패했습니다.");
        notify("AI 호출에 실패해 규칙 기반 초안으로 대신 채웠습니다. 프롬프트를 복사해 외부 AI로 이어갈 수 있습니다.");
        return;
      }
      updateTemplateSession({ result: modelResult.output });
      const coverage = checkStructureCoverage(schema, modelResult.output);
      if (coverage.total && coverage.ratio < 0.6) {
        notify(`AI 초안을 받았습니다. 양식 제목 ${coverage.total}개 중 ${coverage.matched}개만 확인되어 목차를 검토해 주세요.`);
      } else {
        notify(`${modelLabel(modelSettings.provider)}가 양식 구조에 맞춰 초안을 만들었습니다.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "모델 실행에 실패했습니다.";
      updateTemplateSession({ result: buildRuleBasedFill({ schema, profile: templateSession.profile }) });
      setTemplateError(message);
      notify(`AI 호출 실패: ${message}`);
    } finally {
      setTemplateBusy(false);
    }
  };

  const copyTemplatePrompt = () => {
    if (!templateSession.schema) {
      notify("먼저 샘플 양식을 읽어 주세요.");
      return;
    }
    copyText(maskForExternal(buildTemplateFillPrompt({ schema: templateSession.schema, profile: templateSession.profile }), "양식 채우기 프롬프트"), "양식 채우기 프롬프트를 복사했습니다. 외부 AI에 붙여넣어 주세요.");
  };

  const downloadTemplateResult = () => {
    if (!templateSession.result.trim()) {
      notify("먼저 양식을 채워 주세요.");
      return;
    }
    const name = safeFileName(templateSession.profile.projectName || templateSession.schema?.title || "template-filled", "template-filled");
    downloadTextFile(templateSession.result, `${name}.md`, "text/markdown;charset=utf-8");
    notify("양식에 맞춘 초안을 Markdown으로 내려받았습니다.");
  };

  const sendTemplateResultToDraft = () => {
    if (!templateSession.result.trim()) {
      notify("먼저 양식을 채워 주세요.");
      return;
    }
    updateProject({ draftOutput: templateSession.result });
    setSection("draft");
    notify("양식 초안을 초안 조립 화면으로 보냈습니다.");
  };

  const sendTemplateResultToWorkbrain = () => {
    if (!templateSession.result.trim()) {
      notify("먼저 양식을 채워 주세요.");
      return;
    }
    updateProject({ draftOutput: templateSession.result });
    setSection("workbrainExport");
    notify("워크브레인 내보내기로 보냈습니다. ‘사업계획서 초안’을 켜면 함께 들어갑니다.");
  };

  const addTemplateResultToApproval = () => {
    if (!templateSession.result.trim()) {
      notify("먼저 양식을 채워 주세요.");
      return;
    }
    addApprovalItem(
      {
        title: `${templateSession.profile.projectName || templateSession.schema?.title || "샘플 양식"} 양식 채운 초안`,
        type: "plan",
        content: templateSession.result,
        source: "샘플 양식 채우기"
      },
      "reviewing"
    );
  };

  const clearTemplateSchema = () => {
    if (!window.confirm("읽은 양식 구조와 결과를 지울까요? 올린 파일 자체는 삭제되지 않습니다.")) return;
    setTemplateSession(createEmptyTemplateSession());
    setTemplateError("");
    notify("읽은 양식을 지웠습니다.");
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

  const buildCurrentArchive = () => {
    persistActiveProject();
    return exportWorkspaceArchive({ workspace, knowledgeDocs, approvalItems, memoryEntries });
  };

  const downloadArchive = () => {
    const archive = buildCurrentArchive();
    downloadTextFile(JSON.stringify(archive, null, 2), `${safeFileName(project.projectName || activeMeta?.name || "planning-copilot", "planning-copilot")}-archive-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
    notify(`사업 ${workspace.projects.length}개를 백업 파일로 내려받았습니다. API 키는 담기지 않습니다.`);
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
    payload.value = JSON.stringify(buildCurrentArchive());
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
        const restored = importWorkspaceArchive(archive);
        const activeEntry = restored.entries.find((entry) => entry.id === restored.workspace.activeProjectId);
        setWorkspace(restored.workspace);
        setProject(activeEntry?.project ? sanitizeProjectData(activeEntry.project) : { ...emptyProject });
        setGrantPlan(activeEntry?.grantPlan ? sanitizeGrantPlan(activeEntry.grantPlan) : createEmptyGrantPlan());
        setTemplateSession(loadTemplateSession(restored.workspace.activeProjectId));
        setKnowledgeDocs(Array.isArray(archive.knowledgeDocs) ? archive.knowledgeDocs : []);
        setApprovalItems(Array.isArray(archive.approvalItems) ? archive.approvalItems : []);
        setMemoryEntries(Array.isArray(archive.memoryEntries) ? archive.memoryEntries : []);
        notify(restored.legacy
          ? "예전 백업 파일을 한 사업으로 복원했습니다."
          : `백업을 복원했습니다. 사업 ${restored.workspace.projects.length}개를 불러왔습니다.`);
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

    const remoteConfig = providerConfig(modelSettings.provider);
    if (remoteConfig) {
      const keyCheck = validateApiKey(modelSettings.provider, apiKeys[modelSettings.provider] || "");
      if (!keyCheck.ok) {
        notify(keyCheck.message);
        setSection("modelSettings");
        return;
      }
      if (!remoteAck) {
        notify("모델 설정에서 외부 전송 확인을 먼저 체크해 주세요.");
        setSection("modelSettings");
        return;
      }
    }

    const context = buildOfficeContext(project, searchKnowledgeDocs(knowledgeDocs, normalizedCommand, 3));
    const prompt = maskForExternal(buildOfficeModelPrompt({ command: normalizedCommand, tasks: result.tasks, context }), "AI 사무국 실행");
    const modelName = currentModelName(modelSettings) || "이름 미입력";
    setModelBusy(true);
    try {
      const modelResult = await runModelPrompt(prompt, modelSettings, { apiKey: apiKeys[modelSettings.provider] || "" });
      if (!modelResult.ok) throw new Error(modelResult.error || "모델 실행에 실패했습니다.");
      result.execution = { mode: modelSettings.provider, status: "completed", model: modelName, contextSources: context.sourceLabels };
      result.report.markdown = formatModelOfficeReport({
        command: normalizedCommand,
        providerLabel: modelLabel(modelSettings.provider),
        modelName,
        sources: context.sourceLabels,
        output: modelResult.output,
        truncated: context.truncated
      });
      setOfficeResult(result);
      notify(`${modelLabel(modelSettings.provider)}가 통합 초안을 만들었습니다. 실행 전 내용을 검토해 주세요.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "모델 실행에 실패했습니다.";
      result.execution = { mode: modelSettings.provider, status: "failed", model: modelName, contextSources: context.sourceLabels, error: message };
      result.report.markdown = formatModelOfficeFailure(normalizedCommand, modelName, message, result.report.markdown);
      setOfficeResult(result);
      notify(`모델 실행 실패: ${message}`);
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

  const updateGrantPlan = (patch: Partial<GrantPlan>) => setGrantPlan((current) => ({ ...current, ...patch }));

  const applyGrantPresetToPlan = (presetId: string) => {
    const preset = findGrantPreset(presetId);
    if (!preset) {
      notify("프리셋을 찾지 못했습니다.");
      return;
    }
    setGrantPlan(applyGrantPreset(preset, grantPlan));
    notify(`'${preset.name}' 프리셋을 적용했습니다.`);
  };

  const resetGrantPlan = () => {
    if (!window.confirm("예산·정산 작업을 처음 상태로 되돌릴까요? 이 브라우저의 예산·정산 내용이 사라집니다.")) return;
    setGrantPlan(createEmptyGrantPlan());
    notify("예산·정산 작업을 초기화했습니다.");
  };

  const runSelectedModel = async (prompt: string) => {
    if (modelBusy) return;
    const remoteConfig = providerConfig(modelSettings.provider);
    if (remoteConfig) {
      const keyCheck = validateApiKey(modelSettings.provider, apiKeys[modelSettings.provider] || "");
      if (!keyCheck.ok) {
        setModelTestResult({ provider: modelSettings.provider, ok: false, output: "", error: keyCheck.message });
        notify(keyCheck.message);
        return;
      }
      if (!remoteAck) {
        notify("모델 설정에서 외부 전송 확인을 먼저 체크해 주세요.");
        setSection("modelSettings");
        return;
      }
    }
    setModelBusy(true);
    try {
      const result = await runModelPrompt(maskForExternal(prompt, "모델 실행"), modelSettings, { apiKey: apiKeys[modelSettings.provider] || "" });
      setModelTestResult(result);
      notify(result.ok ? `${modelLabel(result.provider)} 응답을 받았습니다.` : `모델 실행 실패: ${result.error || "확인 필요"}`);
      return result;
    } finally {
      setModelBusy(false);
    }
  };

  const runFreeModelForSection = async (mode: "notice" | "draft") => {
    const prompt = mode === "notice" ? buildModelPrompt(project, knowledgeDocs) : buildDraftPolishPrompt(project);
    if (!prompt.trim()) {
      notify("먼저 프로젝트 입력값을 채워 주세요.");
      return;
    }
    setFreeRunError("");
    setFreeRunOutput("");
    const result = await runSelectedModel(prompt);
    if (result?.ok) setFreeRunOutput(result.output);
    else if (result) setFreeRunError(result.error || "모델 실행에 실패했습니다.");
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
    const executionMode = officeResult?.execution?.mode;
    const usedModel = Boolean(executionMode && executionMode !== "simulation");
    const reportMemory = officeResult?.execution?.status === "failed" ? ""
      : usedModel ? officeResult?.report.markdown || ""
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
        source: usedModel && executionMode && officeResult?.execution?.status === "completed" ? `${modelLabel(executionMode)} 통합 초안` : officeResult ? "템플릿 또는 수동 검토 메모" : "수동 메모",
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

  const renderProviderCard = (option: { id: ModelProvider; label: string; description: string }) => {
    const config = providerConfig(option.id);
    return (
      <button
        className={`provider-card ${modelSettings.provider === option.id ? "is-active" : ""}`}
        key={option.id}
        type="button"
        aria-pressed={modelSettings.provider === option.id}
        onClick={() => updateModelSettings({ provider: option.id })}
      >
        <strong>{option.label}</strong>
        <span>{option.description}</span>
        <small className={`cors-badge ${config ? `cors-${config.cors}` : "cors-local"}`}>{providerAvailabilityNote(option.id)}</small>
      </button>
    );
  };

  const apiKeyHandlers = {
    onApiKeyChange: (value: string) => setApiKeys((current) => ({ ...current, [modelSettings.provider]: value })),
    onClearApiKey: () => setApiKeys((current) => ({ ...current, [modelSettings.provider]: "" })),
    onSettingsChange: updateModelSettings,
    remoteAck,
    onRemoteAckChange: setRemoteAck
  };

  return (
    <main className={`app-shell ${mobileNavOpen ? "nav-open" : ""}`}>
      <aside className="sidebar" aria-label="업무 영역">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">기</span>
          <div className="brand-block">
            <p className="eyebrow">Planning Copilot</p>
            <h1>로컬기획 사무국</h1>
          </div>
          <button
            className="mobile-nav-toggle"
            type="button"
            aria-expanded={mobileNavOpen}
            aria-controls="sidebar-body"
            onClick={() => setMobileNavOpen((current) => !current)}
          >
            {mobileNavOpen ? "닫기" : "메뉴"}
          </button>
        </div>

        <div id="sidebar-body" className={`sidebar-body ${mobileNavOpen ? "" : "is-collapsed-mobile"}`}>
          <div className="project-switcher">
            <label className="field">
              <span>현재 사업</span>
              <select value={workspace.activeProjectId} onChange={(event) => switchProject(event.target.value)} aria-label="사업 전환">
                {workspace.projects.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            {activeMeta && (
              <p className="project-switcher-meta">
                <span className={`board-status is-${activeMeta.status}`}>{PROJECT_STATUSES.find((status) => status.id === activeMeta.status)?.label}</span>
                <span className={`board-dday is-${dDayInfo(activeMeta.deadline).tone}`}>{dDayInfo(activeMeta.deadline).label}</span>
                <span>진행 {activeMeta.progress}%</span>
              </p>
            )}
            <button className="secondary-button full" type="button" onClick={() => { setSection("projectBoard"); setMobileNavOpen(false); }}>
              사업 관리 · 새 사업
            </button>
          </div>

          <nav className="step-nav" aria-label="업무 메뉴">
            {navGroups.map((group) => (
              <section className="nav-group" key={group.title}>
                <p className="nav-group-title">{group.title}</p>
                <div className="nav-group-items">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      className={`nav-item ${section === item.id ? "is-active" : ""}`}
                      type="button"
                      aria-current={section === item.id ? "page" : undefined}
                      onClick={() => { setSection(item.id); setMobileNavOpen(false); }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
            ))}

            <section className="nav-group">
              <button className={`lab-toggle ${labOpen ? "is-open" : ""}`} type="button" aria-expanded={labOpen} onClick={() => setLabOpen((current) => !current)}>
                <span>실험실</span>
                <small>{labNavItems.length}개 · 기본 숨김</small>
              </button>
              {labOpen && (
                <div className="nav-group-items is-lab">
                  {labNavItems.map((item) => (
                    <button
                      key={item.id}
                      className={`nav-item ${section === item.id ? "is-active" : ""}`}
                      type="button"
                      aria-current={section === item.id ? "page" : undefined}
                      onClick={() => { setSection(item.id); setMobileNavOpen(false); }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          </nav>

          <div className="sidebar-actions">
            <button className="secondary-button full" type="button" onClick={() => { setProject(exampleProject); notify("예시를 불러왔습니다."); }}>
              예시 불러오기
            </button>
            <button className="ghost-light-button full" type="button" onClick={() => { if (window.confirm("현재 사업의 사업계획 입력값을 초기화할까요? 사업 목록·예산·다른 사업은 그대로 남습니다.")) { setProject({ ...emptyProject, projectName: project.projectName }); notify("현재 사업의 사업계획 입력값을 초기화했습니다. 예산·정산은 그대로입니다."); } }}>
              사업계획 입력값 초기화
            </button>
            <div className="palette-switch" role="radiogroup" aria-label="색 팔레트">
              {PALETTES.map((item) => (
                <button
                  key={item.id}
                  className={`palette-chip ${palette === item.id ? "is-selected" : ""}`}
                  type="button"
                  role="radio"
                  aria-checked={palette === item.id}
                  onClick={() => setPalette(item.id)}
                >
                  <span className={`palette-dot is-${item.id}`} aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <section className={GRANT_SECTIONS.includes(section) ? "workspace has-step-dock" : "workspace"}>
        <header className="topbar">
          <button className="mobile-menu-toggle" type="button" aria-label="업무 메뉴 열기" onClick={() => setMobileNavOpen(true)}>
            메뉴
          </button>
          <div className="topbar-title">
            <p className="eyebrow">{project.projectName || activeMeta?.name || "새 프로젝트"}</p>
            <h1>{sectionTitle}</h1>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" type="button" onClick={() => { saveProjectData(workspace.activeProjectId, project); saveSlotGrantPlan(workspace.activeProjectId, grantPlan); saveWorkspace(workspace); notify("저장했습니다."); }}>저장</button>
            {/* 시작 화면에서는 시작 카드 3개가 주인공이 되도록 내보내기를 낮춰 둔다. */}
            <button
              className={`topbar-export ${section === "home" ? "secondary-button" : "primary-button"}`}
              type="button"
              disabled={section === "home" && !hasAnyWork}
              title={section === "home" && !hasAnyWork ? "시작 카드에서 내용을 채우면 내보낼 수 있습니다." : undefined}
              onClick={() => {
                const content = project.draftOutput || generateDraftText(project);
                downloadTextFile(content, `${safeFileName(project.projectName, "planning-copilot-draft")}.md`, "text/markdown;charset=utf-8");
                notify("Markdown 파일을 내보냈습니다.");
              }}>Markdown 내보내기</button>
          </div>
        </header>

        <div className="page">
        {section === "home" && (
          <WorkHomeView
            projectName={project.projectName || activeMeta?.name || ""}
            plan={grantPlan}
            started={hasAnyWork}
            projects={workspace.projects}
            activeProjectId={workspace.activeProjectId}
            meta={activeMeta ?? undefined}
            onSelectProject={switchProject}
            onOpenProjectBoard={() => setSection("projectBoard")}
            onNavigate={setSection}
            onImportFile={importDocument}
            onImportTemplate={parseTemplateFile}
            onLoadExample={() => { setProject(exampleProject); notify("예시를 불러왔습니다."); }}
            templateSummary={templateSession.schema ? summarizeSchema(templateSession.schema) : null}
          />
        )}

        {section === "projectBoard" && (
          <Panel
            title="사업마다 입력값과 예산을 따로 보관합니다"
            description="정부·공모·자체 사업을 한 브라우저에 나눠 두고 전환해도 서로 섞이지 않습니다. 진행률은 계획서·예산·정산·결과보고를 합쳐 자동으로 계산합니다."
          >
            <ProjectBoardView
              workspace={workspace}
              project={project}
              grantPlan={grantPlan}
              onCreate={createNewProject}
              onSelect={switchProject}
              onDuplicate={duplicateProjectById}
              onRemove={removeProjectById}
              onUpdateMeta={changeProjectMeta}
              onRename={(name) => updateProject({ projectName: name })}
              onNavigate={setSection}
              onLoadExample={() => { setProject(exampleProject); notify("예시를 불러왔습니다."); }}
            />
          </Panel>
        )}

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
              <div><strong>업무 요청</strong><span>역할은 검토 관점을 정리하는 용도입니다. 모델 경로를 고르면 단일 모델 호출이 최종 보고서를 작성합니다.</span></div>
              <button className="primary-button" type="button" onClick={() => { void runAgentOffice(); }} disabled={modelBusy}>{modelBusy ? "모델 실행 중" : "사무국 실행"}</button>
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
                onCopyPrompt={() => copyText(maskForExternal(officeResult.promptPackage.unifiedPrompt, "GPT 질문 복사"), "GPT 질문 패키지를 복사했습니다.")}
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
          <Panel title="AI 연결은 직접 고르고, 키는 이 탭에만 둡니다" description="기본값은 안전한 템플릿 모드입니다. 브라우저에서 바로 호출되는 무료 경로 3종만 먼저 보여주고, 차단·로컬 설치는 아래 '고급 / 로컬 연결'에 모았습니다. API 키는 이 탭의 메모리에만 있고 localStorage·백업·Markdown 어디에도 저장하지 않습니다.">
            <div className="model-status-bar">
              <strong>현재 경로: {modelLabel(modelSettings.provider)} · {currentModelName(modelSettings) || "모델 미지정"}</strong>
              <span>{modelSafetyNote(modelSettings)}</span>
            </div>

            <section className="model-section" aria-label="바로 쓸 수 있는 모델 경로">
              <div className="model-section-head">
                <div>
                  <strong>바로 쓸 수 있는 경로</strong>
                  <span>템플릿 모드는 키 없이 동작합니다. 아래 무료 3종은 브라우저에서 바로 호출되는 것을 2026-11-15에 확인했습니다.</span>
                </div>
                <span className="model-section-count">{primaryModelOptions.length}개</span>
              </div>
              <div className="model-provider-grid">
                {primaryModelOptions.map(renderProviderCard)}
              </div>
              {!isAdvancedModelProvider(modelSettings.provider) && (
                <RemoteKeyBlock provider={modelSettings.provider} settings={modelSettings} apiKey={apiKeys[modelSettings.provider] || ""} {...apiKeyHandlers} />
              )}
            </section>

            <details
              className="advanced-model-details"
              open={advancedModelOpen}
              onToggle={(event) => setAdvancedModelOpen(event.currentTarget.open)}
            >
              <summary>
                <span>고급 / 로컬 연결</span>
                <small>브라우저 호출이 막힌 3종 · 로컬 프록시 · Ollama ({advancedModelOptions.length}개)</small>
              </summary>
              <div className="advanced-model-body">
                <p className="advanced-model-note">
                  K-EXAONE·GitHub Models·AMD Token Lab은 브라우저 직접 호출이 차단됩니다. 쓰려면 로컬 프록시로 중계하거나 질문을 복사해 외부 AI에서 실행하세요.
                  Ollama는 이 컴퓨터에 설치된 로컬 모델만 허용합니다.
                </p>
                <div className="model-provider-grid is-advanced">
                  {advancedModelOptions.map(renderProviderCard)}
                </div>
                {isAdvancedModelProvider(modelSettings.provider) && (
                  <RemoteKeyBlock provider={modelSettings.provider} settings={modelSettings} apiKey={apiKeys[modelSettings.provider] || ""} {...apiKeyHandlers} />
                )}
                {modelSettings.provider === "ollama" && (
                  <div className="form-grid">
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
                  </div>
                )}
              </div>
            </details>

            <div className="model-test-grid">
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
            <PiiGuardNotice
              text={project.noticeText}
              enabled={piiMaskEnabled}
              onToggle={setPiiMask}
              title="공고문 개인정보 점검"
              compact
              note="공고문 분석은 브라우저 안에서만 합니다. 이 공고문을 외부 AI 질문에 넣을 때는 위에서 켠 마스킹 설정을 따라 가린 텍스트가 전송됩니다."
            />
            <div className="file-drop">
              <span>공고문 파일 첨부</span>
              <div className="draft-actions">
                <label className="file-pick">
                  공고문 파일 선택
                  <input type="file" accept=".pdf,.docx,.hwpx,.txt,.md,.csv,.html,.htm,.json,.xml" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) readFile(file, (text) => { updateProject({ noticeText: text }); notify("파일 내용을 불러왔습니다. 공고문 분석을 눌러 주세요."); });
                    event.currentTarget.value = "";
                  }} />
                </label>
                <span className="file-name">{project.noticeText.trim() ? `공고문 ${project.noticeText.trim().length.toLocaleString()}자를 읽었습니다` : "아직 고른 파일이 없습니다"}</span>
              </div>
              <small>PDF, DOCX, HWPX, TXT 파일을 읽습니다. 스캔 이미지 PDF는 추후 OCR 단계에서 보완합니다.</small>
            </div>
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
            <PiiGuardNotice
              text={aiQuestionPreview}
              enabled={piiMaskEnabled}
              onToggle={setPiiMask}
              title="외부 AI로 보내기 전 개인정보 점검"
              note="켜 두면 질문 복사와 무료 API 실행에 [연락처_1]·[주민번호_1] 같은 표시로 바뀐 질문이 쓰입니다. 탐지와 마스킹은 이 브라우저 안에서만 합니다."
            />
            <div className="form-grid">
              <Field label="AI에 복사할 질문" value={project.modelPrompt} onChange={(modelPrompt) => updateProject({ modelPrompt })} rows={14} wide />
              <Field label="AI 답변 붙여넣기" value={project.modelResponse} onChange={(modelResponse) => updateProject({ modelResponse })} rows={12} wide />
              <Field label="반영 메모" value={project.aiSynthesis} onChange={(aiSynthesis) => updateProject({ aiSynthesis })} rows={8} wide />
            </div>
            <div className="draft-actions bridge-actions">
              <button className="secondary-button" type="button" onClick={() => copyText(maskForExternal(project.modelPrompt || buildModelPrompt(project, knowledgeDocs), "AI 질문 복사"), "AI 질문을 복사했습니다.")}>질문 복사</button>
              <button className="secondary-button" type="button" onClick={() => { if (!project.modelResponse) notify("먼저 AI 답변을 붙여넣어 주세요."); else updateProject({ aiSynthesis: absorbModelResponse(project.modelResponse) }); }}>답변 반영 메모화</button>
            </div>
            <section className="grant-block">
              <div className="grant-block-head">
                <div>
                  <strong>무료 API로 바로 실행</strong>
                  <span>
                    현재 경로: {modelLabel(modelSettings.provider)} · {currentModelName(modelSettings) || "모델 미지정"}. 키는 모델 설정에서 입력한 값을 이 탭 메모리에서만 사용합니다.
                    실패하면 아래 질문 복사로 기존 흐름을 그대로 이어가세요.
                  </span>
                </div>
                <div className="draft-actions">
                  <button className="secondary-button" type="button" onClick={() => { void runFreeModelForSection("notice"); }} disabled={modelBusy}>공고·전략 질문 실행</button>
                  <button className="secondary-button" type="button" onClick={() => { void runFreeModelForSection("draft"); }} disabled={modelBusy}>초안 조립 실행</button>
                </div>
              </div>
              {modelSettings.provider === "simulation" && <p className="grant-warning">현재는 템플릿 모드입니다. 실제 호출을 하려면 모델 설정에서 Ollama나 무료 API를 고르세요.</p>}
              {freeRunError && (
                <div className="office-execution-note has-error" role="alert">
                  <strong>실행 실패</strong>
                  <span>{freeRunError}</span>
                  <div className="draft-actions">
                    <button className="secondary-button" type="button" onClick={() => copyText(maskForExternal(buildModelPrompt(project, knowledgeDocs), "질문 복사"), "질문을 복사했습니다. 외부 AI에 붙여넣어 주세요.")}>질문 복사로 이어가기</button>
                    <button className="ghost-light-button" type="button" onClick={() => setSection("modelSettings")}>모델 설정 열기</button>
                  </div>
                </div>
              )}
              {freeRunOutput && (
                <>
                  <textarea className="draft-output office-report-output" rows={12} value={freeRunOutput} readOnly />
                  <div className="draft-actions">
                    <button className="primary-button" type="button" onClick={() => { updateProject({ modelResponse: freeRunOutput }); notify("실행 결과를 AI 답변 칸에 넣었습니다."); }}>AI 답변 칸에 넣기</button>
                    <button className="secondary-button" type="button" onClick={() => copyText(freeRunOutput, "결과를 복사했습니다.")}>결과 복사</button>
                  </div>
                </>
              )}
            </section>
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
            <div className="grant-block-head workspace-head">
              <div>
                <strong>공용 두뇌 연계(my-workbench · david-workbrain)</strong>
                <span>
                  앱을 하나로 합치지 않고 느슨하게 잇습니다. 계획·예산·정산은 여기서 만들고, 지시와 승인은 my-workbench,
                  지식·SOP·템플릿은 david-workbrain에 둡니다. Markdown은 ‘워크브레인 내보내기’에서 만듭니다.
                </span>
              </div>
              <button className="secondary-button" type="button" onClick={() => setSection("workbrainExport")}>내보내기 열기</button>
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
          </Panel>
        )}

        {section === "driveBackup" && (
          <Panel title="백업과 복원" description="현재 프로젝트, 저장한 사례, AI 답변 메모를 파일 또는 Google Drive로 보관합니다.">
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

        {section === "sample" && (
          <SimpleGrid
            title="좋은 문서의 구조를 우리 사업 기준으로 바꿉니다"
            description="문장을 베끼지 않고 구조, 논리, 평가자 신호를 가져옵니다."
            fields={[
              ["참고 문서/출처", "sampleSource"], ["좋았던 구조", "sampleStructure"], ["평가자에게 주는 신호", "sampleSignals"], ["우리 사업에 적용할 방식", "sampleAdaptation"]
            ]}
            project={project}
            update={updateProject}
            footer={(
              <div className="coach-bar sample-template-bridge">
                <div>
                  <strong>양식 자체에 맞춰 채우기</strong>
                  <span>공고·기관 사업계획서 양식(HWPX·DOCX·PDF)을 올리면 목차·표·빈칸을 읽어 그 구조대로 내용을 채웁니다.</span>
                </div>
                <button className="primary-button" type="button" onClick={() => setSection("templateFill")}>샘플 양식 채우기</button>
              </div>
            )}
          />
        )}
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
        {section === "grantBudget" && (
          <Panel title="비목과 재원을 한 판에서 잡습니다" description="비목별 예산표와 재원 구성을 잡고, 정산·결과보고로 이어지는 한 묶음으로 관리합니다.">
            <div className="model-status-bar">
              <strong>{grantPlan.presetName ? `프리셋: ${grantPlan.presetName}` : "프리셋 미적용"}</strong>
              <span>국고보조사업·공모사업 프리셋을 골라 적용하거나 직접 편성할 수 있습니다. 금액은 단가×수량으로 계산되며 이 브라우저에만 저장됩니다.</span>
            </div>
            <GrantBudgetView
              plan={grantPlan}
              project={project}
              presets={grantPresets}
              hasWork={hasGrantWork(grantPlan)}
              onChange={updateGrantPlan}
              onApplyPreset={applyGrantPresetToPlan}
              notify={notify}
            />
            {/* 단계 이동은 화면 하단 고정 바가 맡는다. 여기에는 되돌리는 버튼만 둔다. */}
            <div className="draft-actions grant-reset-row">
              <button className="ghost-light-button" type="button" onClick={resetGrantPlan}>예산·정산 초기화</button>
            </div>
            <GrantStepFlow current="grantBudget" plan={grantPlan} onNavigate={setSection} />
          </Panel>
        )}

        {section === "grantChecklist" && (
          <Panel title="증빙을 순서대로 확인합니다" description="교부·집행·인건비·실적·마감 증빙을 순서대로 점검하고, 확인한 메모를 남깁니다.">
            <GrantChecklistView plan={grantPlan} onChange={updateGrantPlan} notify={notify} />
            <GrantStepFlow current="grantChecklist" plan={grantPlan} onNavigate={setSection} />
          </Panel>
        )}

        {section === "grantReport" && (
          <Panel title="결과보고 초안을 양식 순서대로 씁니다" description="기관 결과보고 양식 순서대로 섹션을 만들고 초안을 채웁니다. 프로젝트 입력값에서 가져올 수 있습니다.">
            <GrantReportView plan={grantPlan} project={project} onChange={updateGrantPlan} notify={notify} onNavigate={setSection} />
            <GrantStepFlow current="grantReport" plan={grantPlan} onNavigate={setSection} />
          </Panel>
        )}

        {section === "workbrainExport" && (
          <Panel title="한 문서로 묶어 내보냅니다" description="사업계획서·예산·정산 체크리스트·결과보고를 david-workbrain Markdown 한 편으로 묶어 복사하거나 내려받습니다.">
            <WorkbrainExportView plan={grantPlan} project={project} notify={notify} />
            <GrantStepFlow current="workbrainExport" plan={grantPlan} onNavigate={setSection} />
          </Panel>
        )}

        {section === "templateFill" && (
          <Panel
            title="읽은 양식 구조 그대로 채웁니다"
            description="공고·기관 양식 파일을 올리면 섹션 목차, 표의 열과 행, 빈칸·작성 항목을 먼저 보여 줍니다. 그 구조를 유지한 Markdown 초안을 만들고 복사·내려받기·워크브레인 내보내기로 이어집니다."
          >
            <TemplateFillView
              schema={templateSession.schema}
              profile={templateSession.profile}
              result={templateSession.result}
              busy={templateBusy}
              error={templateError}
              providerLabel={modelLabel(modelSettings.provider)}
              modelNote={modelSafetyNote(modelSettings)}
              onProfileChange={(patch) => updateTemplateSession({ profile: { ...templateSession.profile, ...patch } })}
              onPickFile={parseTemplateFile}
              onParsePaste={parseTemplateText}
              onUseProjectValues={useProjectValuesForTemplate}
              onFill={runTemplateFill}
              onResultChange={(result) => updateTemplateSession({ result })}
              onCopyResult={() => copyText(templateSession.result, "양식 초안을 복사했습니다.")}
              onCopyPrompt={copyTemplatePrompt}
              onDownload={downloadTemplateResult}
              onSendToDraft={sendTemplateResultToDraft}
              onExportWorkbrain={sendTemplateResultToWorkbrain}
              onAddToApproval={addTemplateResultToApproval}
              onOpenModelSettings={() => setSection("modelSettings")}
              onClear={clearTemplateSchema}
              notify={notify}
              piiGuard={(
                <PiiGuardNotice
                  text={templatePromptPreview}
                  enabled={piiMaskEnabled}
                  onToggle={setPiiMask}
                  title="양식 채우기 프롬프트 개인정보 점검"
                  note="켜 두면 AI 실행과 프롬프트 복사에 가린 프롬프트가 쓰입니다. 이름·연락처는 [성명_1]·[연락처_1]로 바뀌고, 원문은 전송되지 않습니다."
                />
              )}
            />
          </Panel>
        )}

        {section === "draft" && (
          <Panel title="공고 양식에 맞는 초안으로 조립합니다" description="입력한 내용을 사업계획서의 기본 골격으로 정리합니다.">
            <div className="draft-actions">
              <button className="primary-button" type="button" onClick={() => { updateProject({ draftOutput: generateDraftText(project) }); notify("초안을 생성했습니다."); }}>초안 생성</button>
              <button className="secondary-button" type="button" onClick={() => copyText(project.draftOutput || generateDraftText(project), "초안을 복사했습니다.")}>초안 복사</button>
              <button className="secondary-button" type="button" onClick={() => setSection("templateFill")}>샘플 양식으로 채우기</button>
            </div>
            <textarea className="draft-output" rows={24} value={project.draftOutput} onChange={(event) => updateProject({ draftOutput: event.target.value })} />
          </Panel>
        )}
        </div>
      </section>

      <nav className="tabbar" aria-label="빠른 이동">
        {([
          ["home", "홈"],
          ["projectBoard", "사업"],
          ["grantBudget", "예산"],
          ["templateFill", "양식"]
        ] as const).map(([id, label]) => (
          <button
            key={id}
            className="tab"
            type="button"
            aria-current={section === id ? "page" : undefined}
            onClick={() => setSection(id as SectionId)}
          >
            {label}
          </button>
        ))}
        <button className="tab" type="button" onClick={() => setMobileNavOpen(true)}>전체 메뉴</button>
      </nav>

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
  const modelMode = execution && execution.mode !== "simulation" ? execution : null;

  return (
    <div className="office-results">
      <div className={`office-execution-note ${execution?.status === "failed" ? "has-error" : ""}`} role={execution?.status === "failed" ? "alert" : "status"}>
        <strong>{modelMode
          ? `${modelLabel(modelMode.mode)} ${modelMode.status === "completed" ? "단일 실행 완료" : "실행 실패"}${modelMode.model ? ` · ${modelMode.model}` : ""}`
          : execution?.mode === "simulation" ? "규칙 기반 템플릿 결과" : "이전 저장 세션 · 실행 경로 확인 불가"}</strong>
        <span>{modelMode
          ? modelMode.status === "completed"
            ? "실제 모델이 생성한 내용은 아침 보고서입니다. 작업 분해와 역할별 초안은 규칙 기반 참고 자료이며, 병렬 에이전트 실행이 아닙니다."
            : `${execution?.error || "모델 응답을 받지 못했습니다."} 아래 역할별 초안은 템플릿 결과이며 실제 모델 생성물이 아닙니다.`
          : "AI 모델을 호출하지 않았습니다. 역할 분배와 각 초안은 규칙 기반 예시입니다."}</span>
        {execution?.contextSources.length ? <small>{modelMode ? `${modelLabel(modelMode.mode)} 입력 자료` : "템플릿 입력"}: {execution.contextSources.join(" · ")}</small> : null}
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
        <div className="office-block-title"><span>{modelMode ? "③ 역할별 참고 템플릿" : "③ 역할별 템플릿 초안"}</span></div>
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

function formatModelOfficeReport({
  command,
  providerLabel,
  modelName,
  sources,
  output,
  truncated
}: {
  command: string;
  providerLabel: string;
  modelName: string;
  sources: string[];
  output: string;
  truncated: boolean;
}) {
  const sourceLines = sources.length ? sources.map((source) => `- ${source}`).join("\n") : "- 사용자 명령만 사용";
  return `# AI 사무국 통합 보고서\n\n- 요청: ${command}\n- 실행 경로: ${providerLabel} · ${modelName} · 단일 호출\n- 입력 자료:\n${sourceLines}${truncated ? "\n- 안내: 입력 길이 제한에 따라 일부 자료가 생략됨" : ""}\n\n---\n\n${output.trim()}\n\n---\n\n> 검토 전 초안입니다. 정책·일정·예산·기관 정보와 출처 표시를 확인한 뒤 사용하세요. 외부 발송·게시·제출은 수행하지 않았습니다.\n`;
}

function formatModelOfficeFailure(command: string, model: string, error: string, templateReport: string) {
  return `# 통합 초안 생성 실패\n\n- 요청: ${command}\n- 모델: ${model}\n- 오류: ${error}\n\n> 아래 내용은 규칙 기반 템플릿 보고서이며 모델이 생성한 결과가 아닙니다. 연결과 모델 이름을 확인한 뒤 다시 실행하세요.\n\n---\n\n${templateReport}`;
}

function draftStatusLabel(draft: AgentDraft) {
  const status = draft.reviewStatus === "approved" ? "승인" : draft.reviewStatus === "revised" ? "수정 권고" : "반려";
  return draft.reviewNote ? `${status} · ${draft.reviewNote}` : status;
}

function Panel({
  title,
  description,
  children,
  actions
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="panel is-visible">
      <header className="panel-head">
        <div className="panel-head-text">
          <h2 className="panel-title">{title}</h2>
          <p className="panel-note">{description}</p>
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function SimpleGrid({
  title,
  description,
  fields,
  project,
  update,
  logic = false,
  footer
}: {
  title: string;
  description: string;
  fields: Array<[string, keyof ProjectData]>;
  project: ProjectData;
  update: (patch: Partial<ProjectData>) => void;
  logic?: boolean;
  footer?: React.ReactNode;
}) {
  return (
    <Panel title={title} description={description}>
      <div className={logic ? "logic-board" : "form-grid"}>
        {fields.map(([label, key]) => (
          <Field key={String(key)} label={label} value={String(project[key] || "")} onChange={(value) => update({ [key]: value } as Partial<ProjectData>)} rows={logic ? 6 : 5} />
        ))}
      </div>
      {footer}
    </Panel>
  );
}

function RemoteKeyBlock({
  provider,
  settings,
  apiKey,
  onApiKeyChange,
  onClearApiKey,
  onSettingsChange,
  remoteAck,
  onRemoteAckChange
}: {
  provider: ModelProvider;
  settings: ModelSettings;
  apiKey: string;
  onApiKeyChange: (value: string) => void;
  onClearApiKey: () => void;
  onSettingsChange: (patch: Partial<ModelSettings>) => void;
  remoteAck: boolean;
  onRemoteAckChange: (value: boolean) => void;
}) {
  const config = providerConfig(provider);
  const field = remoteModelField(provider);
  if (!config) return null;
  return (
    <div className="remote-key-block">
      <div className="remote-key-head">
        <strong>{config.label} 연결</strong>
        <span>{config.corsNote}</span>
      </div>
      <div className="form-grid">
        {provider === "custom-openai" && (
          <label className="field wide">
            <span>프록시 Base URL(예: http://127.0.0.1:8080/v1)</span>
            <input
              value={settings.customBaseUrl}
              placeholder="로컬·사설망 주소만 사용할 수 있습니다"
              onChange={(event) => onSettingsChange({ customBaseUrl: event.target.value })}
            />
          </label>
        )}
        <label className="field wide">
          <span>API 키(저장하지 않음 · {config.keyLabel})</span>
          <input
            type="password"
            value={apiKey}
            placeholder="이 탭에서만 사용하고 닫으면 사라집니다"
            autoComplete="new-password"
            spellCheck={false}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
        </label>
        {field && (
          <label className="field">
            <span>모델 이름</span>
            <input
              value={String(settings[field] ?? "")}
              placeholder={config.defaultModel || "예: openai/gpt-4o-mini"}
              onChange={(event) => onSettingsChange({ [field]: event.target.value } as Partial<ModelSettings>)}
            />
          </label>
        )}
        <div className="ollama-model-controls">
          <button className="ghost-light-button" type="button" onClick={onClearApiKey}>입력한 키 지우기</button>
        </div>
      </div>
      {config.models.length > 0 && (
        <div className="grant-check-options">
          {config.models.map((model) => (
            <button
              className="quick-command"
              key={model}
              type="button"
              onClick={() => field && onSettingsChange({ [field]: model } as Partial<ModelSettings>)}
            >
              {model}
            </button>
          ))}
        </div>
      )}
      <label className="grant-inline-check">
        <input type="checkbox" checked={remoteAck} onChange={(event) => onRemoteAckChange(event.target.checked)} />
        <span>이 경로로 실행하면 프로젝트 입력란과 저장 자료 최대 3건이 외부 API로 전송되는 것을 확인했습니다.</span>
      </label>
    </div>
  );
}
