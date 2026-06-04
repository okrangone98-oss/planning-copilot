const STORAGE_KEY = "planningCopilotProject";
const RAG_DOCS_KEY = "planningCopilotKnowledgeDocs";

const sectionTitles = {
  notice: "공고 해석",
  cowork: "질문 받기",
  ragRoom: "사례 모으기",
  aiBridge: "AI 질문",
  driveBackup: "백업",
  sample: "샘플 분해",
  idea: "아이디어 인터뷰",
  problem: "문제정의",
  logic: "논리모형",
  metrics: "성과지표",
  execution: "실행설계",
  blueprint: "서비스 블루프린트",
  draft: "초안 조립"
};

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

const tableSchemas = {
  metricsTable: ["구분", "지표명", "목표값", "측정 방법"],
  blueprintTable: ["단계", "사용자 행동", "접점", "백스테이지 운영", "실패 가능성"]
};

const exampleProject = {
  projectName: "공동기획형 사업계획서 에이전트",
  noticeText: "창업/사회혁신/지역문제 해결형 지원사업 공고를 대상으로 평가기준과 양식을 해석하고, 신청자의 아이디어를 사업계획서로 구체화한다.",
  policyGoal: "현장의 아이디어가 정책지원 사업의 언어로 전환되지 못해 좋은 시도가 탈락하는 문제를 완화한다.",
  evaluationFocus: "문제정의의 타당성, 실행 가능성, 성과지표의 적절성, 확산 가능성, 신청자의 추진역량",
  requirements: "공고문, 제출양식, 예산기준, 평가표를 입력자료로 사용한다.",
  advantageSignals: "좋은 샘플 분해, 서비스 디자인, 논리모형 기반 성과 설계, 작성자 고유 관점 반영",
  agentMemo: "이 에이전트는 공고문을 평가자의 질문으로 바꾸고, 사용자의 현장 아이디어가 사라지지 않도록 문제정의와 실행설계에 연결한다.",
  nextQuestions: "1. 이 아이디어가 해결하는 가장 구체적인 대상자의 불편은 무엇인가?\n2. 공고의 평가항목 중 가장 높은 배점에 대응하는 증거는 무엇인가?\n3. 신청자가 이미 해 본 실행 경험은 무엇인가?\n4. 성과를 어떤 자료로 증명할 수 있는가?",
  writingStrategy: "문제정의에서는 정책 목적과 현장 불편을 연결하고, 추진전략에서는 실행 단계와 예산 근거를 명확히 하며, 파급효과에서는 정량 성과와 확산 가능성을 함께 제시한다.",
  missingEvidence: "대상자 인터뷰, 시장/지역 데이터, 기존 서비스의 한계 사례, 견적서, 협력기관 확인, 이전 운영 실적",
  modelPrompt: "",
  modelResponse: "",
  aiSynthesis: "AI 답변을 붙여넣은 뒤 사업계획서에 반영할 핵심 판단, 보완 질문, 문장 후보를 정리한다.",
  ragQuery: "",
  ragResults: "",
  sampleSource: "정책브리핑 보도자료, 유사 지원사업 공고문, 선정 사업계획서 샘플",
  sampleStructure: "정책 목적을 먼저 해석한 뒤 대상자의 불편, 기존 대안의 한계, 실행 가능한 개선안, 측정 가능한 성과로 연결한다.",
  sampleSignals: "평가자가 보는 신호는 정책 적합성, 시장성, 실행역량, 사업비 집행 타당성, 지역/산업 파급효과다.",
  sampleAdaptation: "샘플의 문장보다 구조를 가져오고, 사용자의 현장 경험과 고유 관점을 핵심 근거로 배치한다.",
  coreIdea: "사용자와 대화하며 공고 해석부터 사업계획서 초안까지 공동기획하는 웹 기반 에이전트",
  targetUsers: "지원사업에 도전하는 창업자, 사회혁신가, 로컬 기획자, 비영리 실무자",
  fieldEvidence: "좋은 아이디어가 있어도 공고의 의도, 평가 언어, 성과지표 설계에서 막히는 경우가 많다.",
  founderInsight: "기획자의 사고과정을 도구화해 사용자의 아이디어를 지우지 않고 더 설득력 있게 만든다.",
  problemSituation: "작성자는 공고문을 읽어도 무엇을 강조해야 하는지 알기 어렵고, 샘플을 봐도 자기 사업에 적용하기 어렵다.",
  rootCauses: "정책 언어와 현장 언어의 간극, 문제정의 훈련 부족, 성과지표 설계 경험 부족",
  existingLimits: "일반 문서 생성 AI는 양식 채우기에는 도움을 주지만 평가기준 해석과 실행설계 피드백이 약하다.",
  whyNow: "AI 도구 확산으로 문장 작성은 쉬워졌지만, 기획 판단력과 정책 해석력의 차이가 더 중요해졌다.",
  inputs: "공고문, 평가표, 제출양식, 사업 샘플, 사용자 인터뷰, 분야별 템플릿",
  activities: "공고 해석, 샘플 분해, 문제정의 인터뷰, 논리모형 작성, 성과지표 설계, 초안 생성",
  outputs: "공고분석표, 문제정의문, 논리모형, 성과지표표, 실행계획, 사업계획서 초안",
  shortOutcomes: "사용자의 기획 구조화 역량 향상, 작성 시간 단축, 평가항목 누락 감소",
  longOutcomes: "지원사업 선정 가능성 향상, 현장 아이디어의 실행 전환율 증가, 기획 지식 축적",
  milestones: "1단계: 공고/양식 분석. 2단계: 아이디어 인터뷰. 3단계: 문제정의 및 논리모형. 4단계: 초안 작성. 5단계: 피드백 반영.",
  teamSystem: "사용자: 현장 아이디어 제공. 에이전트: 구조화와 초안 작성. 전문가: 샘플/평가기준 검수.",
  budgetPlan: "초기에는 정적 웹앱으로 검증하고, 이후 AI API, 문서 파서, 템플릿 DB 구축 비용을 반영한다.",
  riskPlan: "자동작성 품질 편차는 체크리스트와 샘플 기반 피드백으로 보완하고, 사용자의 원문 관점을 별도 보존한다.",
  metricsTable: [
    ["과정", "공고 분석 완료율", "90% 이상", "필수 항목 체크리스트"],
    ["산출", "사업계획서 초안 생성 수", "월 30건", "프로젝트 저장 건수"],
    ["결과", "사용자 만족도", "4.5/5점", "작성 후 설문"],
    ["확산", "재사용 템플릿 수", "20개", "템플릿 라이브러리 등록 수"]
  ],
  blueprintTable: [
    ["진입", "공고문과 아이디어를 입력한다", "입력 화면", "공고 항목 분류", "입력 정보 부족"],
    ["기획", "질문에 답하며 문제를 구체화한다", "인터뷰 화면", "답변 요약 및 누락 질문 생성", "현장 근거 약함"],
    ["작성", "초안을 확인하고 수정한다", "초안 화면", "문항별 구조 조립", "양식 요구 누락"],
    ["개선", "피드백을 반영해 버전업한다", "내보내기/저장", "변경 이력 축적", "사용자 관점 희석"]
  ]
};

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function showToast(message) {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function collectProject() {
  const data = {
    projectName: qs("#projectName").value.trim()
  };

  qsa("[data-key]").forEach((field) => {
    data[field.dataset.key] = field.value.trim();
  });

  Object.keys(tableSchemas).forEach((tableId) => {
    data[tableId] = qsa(`#${tableId} tbody tr`).map((row) =>
      qsa("input", row).map((input) => input.value.trim())
    );
  });

  data.draftOutput = qs("#draftOutput").value.trim();
  return data;
}

function saveProject() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectProject()));
  showToast("저장했습니다.");
}

function loadKnowledgeDocs() {
  try {
    return JSON.parse(localStorage.getItem(RAG_DOCS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveKnowledgeDocs(docs) {
  localStorage.setItem(RAG_DOCS_KEY, JSON.stringify(docs));
  renderKnowledgeLibrary();
}

function createArchive() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "planning-copilot",
    project: collectProject(),
    knowledgeDocs: loadKnowledgeDocs()
  };
}

function archiveFileName() {
  const projectName = qs("#projectName").value.trim() || "planning-copilot";
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, "_");
  const date = new Date().toISOString().slice(0, 10);
  return `${safeName}-archive-${date}.json`;
}

function downloadArchive() {
  const content = JSON.stringify(createArchive(), null, 2);
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = archiveFileName();
  link.click();
  URL.revokeObjectURL(url);
  showToast("백업 파일을 다운로드했습니다.");
}

function restoreArchive(archive) {
  if (!archive || !archive.project) {
    showToast("올바른 백업 파일이 아닙니다.");
    return;
  }
  fillProject(archive.project);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(archive.project));
  saveKnowledgeDocs(Array.isArray(archive.knowledgeDocs) ? archive.knowledgeDocs : []);
  showToast("백업 파일을 복원했습니다.");
}

function importArchiveFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  readFileAsText(file, (text) => {
    try {
      restoreArchive(JSON.parse(text));
    } catch {
      showToast("백업 파일을 읽지 못했습니다.");
    }
  });
  event.target.value = "";
}

function saveDriveEndpoint() {
  const endpoint = qs("#driveEndpoint").value.trim();
  localStorage.setItem("planningCopilotDriveEndpoint", endpoint);
}

function loadDriveEndpoint() {
  const field = qs("#driveEndpoint");
  if (field) field.value = localStorage.getItem("planningCopilotDriveEndpoint") || "";
}

function backupToDrive() {
  const endpoint = qs("#driveEndpoint").value.trim();
  if (!endpoint) {
    showToast("Google Drive 연결 주소를 입력해 주세요.");
    return;
  }
  saveDriveEndpoint();

  const iframeName = "driveBackupTarget";
  let iframe = qs(`iframe[name="${iframeName}"]`);
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.hidden = true;
    document.body.appendChild(iframe);
  }

  const form = document.createElement("form");
  form.method = "POST";
  form.action = endpoint;
  form.target = iframeName;
  form.hidden = true;

  const payload = document.createElement("input");
  payload.type = "hidden";
  payload.name = "payload";
  payload.value = JSON.stringify(createArchive());
  form.appendChild(payload);
  document.body.appendChild(form);
  form.submit();
  form.remove();
  showToast("Google Drive 백업을 요청했습니다.");
}

function copyAppsScript() {
  navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE).then(() => showToast("연결 코드를 복사했습니다."));
}

function fillAppsScriptTemplate() {
  const field = qs("#appsScriptTemplate");
  if (field) field.value = APPS_SCRIPT_TEMPLATE;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderKnowledgeLibrary() {
  const library = qs("#knowledgeLibrary");
  if (!library) return;
  const docs = loadKnowledgeDocs();
  if (!docs.length) {
    library.innerHTML = `<div class="knowledge-item"><strong>저장된 사례가 없습니다.</strong><span>좋은 사업계획서, 공고문, 평가표를 추가해 보세요.</span></div>`;
    return;
  }

  library.innerHTML = docs
    .map((doc) => {
      const length = doc.text ? doc.text.length.toLocaleString() : "0";
      return `<div class="knowledge-item">
        <strong>${escapeHtml(doc.title || "제목 없음")}</strong>
        <span>${escapeHtml(doc.type || "문서")} · ${length}자 · ${new Date(doc.createdAt).toLocaleDateString()}</span>
      </div>`;
    })
    .join("");
}

function fillProject(data) {
  qs("#projectName").value = data.projectName || "";
  qsa("[data-key]").forEach((field) => {
    field.value = data[field.dataset.key] || "";
  });

  Object.keys(tableSchemas).forEach((tableId) => {
    const tbody = qs(`#${tableId} tbody`);
    tbody.innerHTML = "";
    const rows = data[tableId] && data[tableId].length ? data[tableId] : [emptyRow(tableId)];
    rows.forEach((row) => addTableRow(tableId, row));
  });

  qs("#draftOutput").value = data.draftOutput || "";
}

function emptyRow(tableId) {
  return tableSchemas[tableId].map(() => "");
}

function addTableRow(tableId, values = emptyRow(tableId)) {
  const tbody = qs(`#${tableId} tbody`);
  const row = document.createElement("tr");

  tableSchemas[tableId].forEach((label, index) => {
    const cell = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = label;
    input.value = values[index] || "";
    input.addEventListener("input", autosaveSoon);
    cell.appendChild(input);
    row.appendChild(cell);
  });

  tbody.appendChild(row);
}

function loadStoredProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    fillProject({});
    return;
  }

  try {
    fillProject(JSON.parse(raw));
  } catch {
    fillProject({});
  }
}

function switchSection(sectionId) {
  qsa(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.section === sectionId);
  });
  qsa(".panel").forEach((panel) => {
    panel.classList.toggle("is-visible", panel.id === sectionId);
  });
  qs("#sectionTitle").textContent = sectionTitles[sectionId];
}

function fieldByKey(key) {
  return qs(`[data-key="${key}"]`);
}

function setFieldIfUseful(key, value, overwrite = false) {
  const field = fieldByKey(key);
  if (!field || !value) return;
  if (overwrite || !field.value.trim()) field.value = value;
}

function readFileAsText(file, onText) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "").trim();
    if (!text || text.includes("\u0000")) {
      showToast("이 파일은 직접 텍스트 추출이 어렵습니다. 내용을 복사해 붙여넣어 주세요.");
      return;
    }
    onText(text);
  };
  reader.onerror = () => showToast("파일을 읽지 못했습니다.");
  reader.readAsText(file, "utf-8");
}

function chunkText(text, size = 900, overlap = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const chunk = clean.slice(start, start + size).trim();
    if (chunk.length > 80) chunks.push(chunk);
  }
  return chunks;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function termVector(text) {
  return tokenize(text).reduce((vector, token) => {
    vector[token] = (vector[token] || 0) + 1;
    return vector;
  }, {});
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  Object.keys(a).forEach((key) => {
    normA += a[key] * a[key];
    if (b[key]) dot += a[key] * b[key];
  });
  Object.keys(b).forEach((key) => {
    normB += b[key] * b[key];
  });
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function projectSearchQuery(data) {
  return [
    data.ragQuery,
    data.noticeText,
    data.evaluationFocus,
    data.policyGoal,
    data.coreIdea,
    data.problemSituation,
    data.writingStrategy
  ]
    .filter(Boolean)
    .join("\n");
}

function searchKnowledgeDocs(query, limit = 6) {
  const docs = loadKnowledgeDocs();
  const queryVector = termVector(query);
  const scored = [];
  docs.forEach((doc) => {
    chunkText(doc.text || "").forEach((chunk, index) => {
      const score = cosineSimilarity(queryVector, termVector(`${doc.title} ${doc.type} ${chunk}`));
      if (score > 0) scored.push({ ...doc, chunk, chunkIndex: index + 1, score });
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function formatKnowledgeResults(results) {
  if (!results.length) return "관련 사례를 찾지 못했습니다. 좋은 사업계획서나 비슷한 공고를 더 추가해 주세요.";
  return results
    .map((result, index) => {
      const score = Math.round(result.score * 1000) / 1000;
      return `### 참고 ${index + 1}. ${result.title} (${result.type || "문서"}, 유사도 ${score})\n${result.chunk}`;
    })
    .join("\n\n");
}

function splitSentences(text) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。])\s+|(?=\d+\s*[.)]\s)|(?=□|○|ㅇ| - )/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 8);
}

function findSentences(text, keywords, limit = 5) {
  const sentences = splitSentences(text);
  return sentences
    .filter((sentence) => keywords.some((keyword) => sentence.includes(keyword)))
    .slice(0, limit)
    .join("\n");
}

function findFacts(text) {
  const dates = text.match(/\d{4}[.년-]\s?\d{1,2}[.월-]\s?\d{0,2}|~\s?\d{1,2}[.월-]\s?\d{1,2}|마감|접수|신청기간/g) || [];
  const amounts = text.match(/\d+\s?(억|만원|천원|%|개사|명|점)|최대\s?\d+\s?(억|만원|천원)/g) || [];
  const scores = text.match(/[^.\n]*(평가|배점|점|추진전략|수행역량|파급효과)[^.\n]*/g) || [];
  return {
    dates: [...new Set(dates)].slice(0, 8),
    amounts: [...new Set(amounts)].slice(0, 8),
    scores: [...new Set(scores.map((item) => item.trim()))].slice(0, 6)
  };
}

function analyzeNoticeText() {
  const data = collectProject();
  const text = data.noticeText;
  if (!text) {
    showToast("먼저 공고문 핵심 문장을 붙여넣어 주세요.");
    return;
  }

  const facts = findFacts(text);
  const policy = findSentences(text, ["목적", "취지", "지원", "해결", "혁신", "고도화", "성장"], 4);
  const evaluation = [
    findSentences(text, ["평가", "배점", "추진전략", "수행역량", "파급효과", "기대효과"], 6),
    facts.scores.join("\n")
  ].filter(Boolean).join("\n");
  const requirements = [
    findSentences(text, ["신청", "접수", "제출", "서류", "자격", "대상", "제외", "필수"], 7),
    facts.dates.length ? `주요 일정/조건: ${facts.dates.join(", ")}` : "",
    facts.amounts.length ? `숫자 조건: ${facts.amounts.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  const advantages = findSentences(text, ["우대", "가점", "추천", "비수도권", "지역", "협업", "성과", "확산", "브랜드"], 5);

  setFieldIfUseful("policyGoal", policy || "공고문에서 정책 목적 문장을 더 명확히 추출해야 합니다.", true);
  setFieldIfUseful("evaluationFocus", evaluation || "평가항목과 배점을 추가 확인해야 합니다.", true);
  setFieldIfUseful("requirements", requirements || "신청자격, 제출서류, 마감일을 추가 확인해야 합니다.", true);
  setFieldIfUseful("advantageSignals", advantages || "가점, 우대, 차별화 요소를 추가 확인해야 합니다.", true);

  generateCoaching(true);
  saveProject();
  showToast("공고문을 분석하고 다음 질문을 만들었습니다.");
}

function addKnowledgeDoc() {
  const title = qs("#knowledgeTitle").value.trim();
  const type = qs("#knowledgeType").value.trim();
  const text = qs("#knowledgeText").value.trim();
  if (!text) {
    showToast("저장할 문서 내용을 입력해 주세요.");
    return;
  }

  const docs = loadKnowledgeDocs();
  docs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: title || "이름 없는 사례",
    type: type || "사례",
    text,
    createdAt: new Date().toISOString()
  });
  saveKnowledgeDocs(docs);
  qs("#knowledgeTitle").value = "";
  qs("#knowledgeType").value = "";
  qs("#knowledgeText").value = "";
  showToast("사례를 저장했습니다.");
}

function searchKnowledge() {
  const data = collectProject();
  const query = projectSearchQuery(data);
  if (!query.trim()) {
    showToast("검색할 공고문이나 아이디어를 먼저 입력해 주세요.");
    return;
  }
  const results = searchKnowledgeDocs(query);
  setFieldIfUseful("ragResults", formatKnowledgeResults(results), true);
  saveProject();
  showToast("관련 사례를 찾았습니다.");
}

function clearKnowledge() {
  if (!window.confirm("저장한 사례를 모두 삭제할까요?")) return;
  localStorage.removeItem(RAG_DOCS_KEY);
  renderKnowledgeLibrary();
  showToast("저장한 사례를 모두 지웠습니다.");
}

function importKnowledgeFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  readFileAsText(file, (text) => {
    qs("#knowledgeTitle").value = qs("#knowledgeTitle").value || file.name;
    qs("#knowledgeText").value = text;
    showToast("파일 내용을 사례 입력칸에 불러왔습니다.");
  });
  event.target.value = "";
}

function importNoticeFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  readFileAsText(file, (text) => {
    const field = fieldByKey("noticeText");
    field.value = text;
    analyzeNoticeText();
  });
  event.target.value = "";
}

function generateCoaching(fromNotice = false) {
  const data = collectProject();
  const scoreHint = data.evaluationFocus || "평가항목과 배점";
  const policyHint = data.policyGoal || "정책 목적";
  const ideaHint = data.coreIdea || "사용자의 핵심 아이디어";

  const memo = [
    `이 공고는 ${policyHint}에 맞춰 답해야 합니다.`,
    `작성의 중심은 ${scoreHint}에 대응하는 증거를 만드는 것입니다.`,
    `아이디어는 '${ideaHint}' 자체보다, 왜 지금 필요하고 어떻게 실행되며 어떤 성과로 증명되는지가 중요합니다.`
  ].join("\n");

  const questions = [
    "1. 이 사업의 대상자는 누구이며, 지금 가장 크게 겪는 불편은 무엇인가?",
    "2. 그 불편이 개인 문제가 아니라 시장/지역/정책 문제라는 근거는 무엇인가?",
    "3. 기존 제품, 서비스, 지원사업은 왜 충분하지 않았는가?",
    "4. 공고의 가장 높은 배점 항목에 대응하는 핵심 실행계획은 무엇인가?",
    "5. 신청자가 이미 보유한 경험, 협력자, 자원, 실적은 무엇인가?",
    "6. 선정 후 3개월, 6개월, 종료 시점에 무엇이 달라졌다고 증명할 것인가?"
  ].join("\n");

  const strategy = [
    "문제정의: 대상자의 장면과 정책 목적을 한 문단 안에서 연결합니다.",
    "추진전략: 활동 목록보다 의사결정 흐름, 일정, 예산 근거를 먼저 보여줍니다.",
    "수행역량: 사람/경험/협력자/보유자원을 역할별로 배치합니다.",
    "파급효과: 매출, 참여자, 재방문, 만족도, 확산 사례처럼 측정 가능한 지표로 씁니다."
  ].join("\n");

  const missing = [
    "대상자 인터뷰 또는 실제 불편 사례",
    "시장 규모, 지역 데이터, 검색량, 매출/방문 변화 같은 정량 근거",
    "시제품, 사진, 메뉴/서비스 흐름, 고객 여정 자료",
    "협력기관, 공급업체, 전문가, 지역 파트너의 역할 증빙",
    "예산 산출 근거와 견적 자료",
    "성과지표별 측정 방법과 증빙 자료"
  ].join("\n");

  setFieldIfUseful("agentMemo", memo, true);
  setFieldIfUseful("nextQuestions", questions, true);
  setFieldIfUseful("writingStrategy", strategy, true);
  setFieldIfUseful("missingEvidence", missing, true);

  if (!fromNotice) {
    saveProject();
    showToast("다음 질문을 다시 만들었습니다.");
  }
}

function compactSection(title, value) {
  return `## ${title}\n${value && value.trim() ? value.trim() : "아직 입력되지 않음"}`;
}

function buildModelPrompt(data) {
  return `당신은 정부지원사업 사업계획서 전문 공동기획자입니다. 아래 자료를 평가자 관점으로 분석하고, 신청자의 아이디어가 사라지지 않도록 사업계획서로 발전시켜 주세요.

답변은 반드시 다음 형식으로 작성해 주세요.

1. 공고 해석
- 이 공고가 실제로 원하는 답
- 가장 중요한 평가 신호
- 탈락 위험이 있는 빈틈

2. 공동기획 질문
- 내가 사용자에게 추가로 물어봐야 할 질문 10개
- 각 질문이 필요한 이유

3. 사업계획서 전략
- 문제정의 방향
- 추진전략 방향
- 수행역량 강조 방식
- 성과지표와 파급효과 설계

4. 바로 쓸 수 있는 문장
- 사업 필요성 문장 3개
- 차별성 문장 3개
- 기대효과 문장 3개

5. 보완 자료 체크리스트
- 제출 전 모아야 할 근거자료
- 예산/성과/협력 관련 증빙

주의사항:
- 공고문에 없는 사실을 단정하지 마세요.
- 사용자의 아이디어를 일반적인 문장으로 희석하지 마세요.
- 평가항목과 배점이 있으면 그 순서에 맞춰 답하세요.
- 결과는 한국어 사업계획서 문체로 작성하세요.

${compactSection("공고문/공고 해석", data.noticeText)}

${compactSection("저장한 사례에서 찾은 참고 내용", data.ragResults)}

${compactSection("정책 목적", data.policyGoal)}

${compactSection("평가 포인트", data.evaluationFocus)}

${compactSection("필수 조건", data.requirements)}

${compactSection("가점/차별화 기회", data.advantageSignals)}

${compactSection("사용자 핵심 아이디어", data.coreIdea)}

${compactSection("대상자", data.targetUsers)}

${compactSection("현장 근거", data.fieldEvidence)}

${compactSection("사용자의 고유한 관점", data.founderInsight)}

${compactSection("현재 문제정의", [data.problemSituation, data.rootCauses, data.existingLimits, data.whyNow].filter(Boolean).join("\\n"))}

${compactSection("현재 실행설계", [data.milestones, data.teamSystem, data.budgetPlan, data.riskPlan].filter(Boolean).join("\\n"))}`;
}

function generateModelPrompt() {
  const data = collectProject();
  if (!data.ragResults && projectSearchQuery(data).trim()) {
    data.ragResults = formatKnowledgeResults(searchKnowledgeDocs(projectSearchQuery(data)));
    setFieldIfUseful("ragResults", data.ragResults, true);
  }
  setFieldIfUseful("modelPrompt", buildModelPrompt(data), true);
  saveProject();
  showToast("AI에 물어볼 질문을 만들었습니다.");
}

function copyModelPrompt() {
  const promptField = fieldByKey("modelPrompt");
  if (!promptField.value.trim()) generateModelPrompt();
  navigator.clipboard.writeText(promptField.value).then(() => showToast("AI 질문을 복사했습니다."));
}

function absorbModelResponse() {
  const response = fieldByKey("modelResponse").value.trim();
  if (!response) {
    showToast("먼저 AI 답변을 붙여넣어 주세요.");
    return;
  }

  const synthesis = [
    "AI 답변 요약",
    response.slice(0, 4000),
    "",
    "반영 기준",
    "- 공고문과 충돌하는 내용은 제외한다.",
    "- 사용자의 현장 경험과 고유 관점이 드러나는 문장을 우선 반영한다.",
    "- 평가항목, 배점, 제출양식과 직접 연결되는 내용부터 초안에 적용한다."
  ].join("\n");

  setFieldIfUseful("aiSynthesis", synthesis, true);
  saveProject();
  showToast("AI 답변을 반영 메모로 정리했습니다.");
}

function bullets(text) {
  if (!text) return "- 보완 필요";
  return text
    .split(/\n|\. /)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item.replace(/\.$/, "")}`)
    .join("\n");
}

function tableToMarkdown(title, headers, rows) {
  const cleanRows = rows.filter((row) => row.some(Boolean));
  if (!cleanRows.length) return `## ${title}\n\n보완 필요`;

  const headerLine = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = cleanRows.map((row) => `| ${row.map((cell) => cell || "보완 필요").join(" | ")} |`).join("\n");
  return `## ${title}\n\n${headerLine}\n${divider}\n${body}`;
}

function generateDraftText(data) {
  const title = data.projectName || "사업계획서 초안";
  return `# ${title}

## 1. 공고 해석

### 정책 목적
${bullets(data.policyGoal)}

### 평가 포인트
${bullets(data.evaluationFocus)}

### 필수 조건 및 가점 요소
${bullets([data.requirements, data.advantageSignals].filter(Boolean).join("\n"))}

## 2. 함께 작성할 질문과 메모

### 에이전트 해석 메모
${bullets(data.agentMemo)}

### 다음 질문
${bullets(data.nextQuestions)}

### 작성 전략과 빠진 근거
${bullets([data.writingStrategy, data.missingEvidence].filter(Boolean).join("\n"))}

## 3. AI 답변 반영 메모

${bullets(data.aiSynthesis)}

## 4. 샘플 분해에서 얻은 적용 원칙

### 참고 문서/출처
${bullets(data.sampleSource)}

### 좋은 구조와 평가 신호
${bullets([data.sampleStructure, data.sampleSignals].filter(Boolean).join("\n"))}

### 우리 사업에 적용할 방식
${bullets(data.sampleAdaptation)}

## 5. 사업 아이디어

### 핵심 아이디어
${bullets(data.coreIdea)}

### 대상자 및 현장 근거
${bullets([data.targetUsers, data.fieldEvidence].filter(Boolean).join("\n"))}

### 작성자의 고유 관점
${bullets(data.founderInsight)}

## 6. 문제정의

### 문제 상황
${bullets(data.problemSituation)}

### 원인과 기존 해결책의 한계
${bullets([data.rootCauses, data.existingLimits].filter(Boolean).join("\n"))}

### 지금 필요한 이유
${bullets(data.whyNow)}

## 7. 논리모형

| 구분 | 내용 |
| --- | --- |
| 투입 | ${data.inputs || "보완 필요"} |
| 활동 | ${data.activities || "보완 필요"} |
| 산출 | ${data.outputs || "보완 필요"} |
| 단기성과 | ${data.shortOutcomes || "보완 필요"} |
| 중장기성과 | ${data.longOutcomes || "보완 필요"} |

${tableToMarkdown("8. 성과지표", tableSchemas.metricsTable, data.metricsTable || [])}

## 9. 실행설계

### 추진 단계
${bullets(data.milestones)}

### 추진체계
${bullets(data.teamSystem)}

### 예산 설계
${bullets(data.budgetPlan)}

### 리스크 대응
${bullets(data.riskPlan)}

${tableToMarkdown("10. 서비스 블루프린트", tableSchemas.blueprintTable, data.blueprintTable || [])}

## 11. 다음 보완 질문

- 공고의 실제 평가표에서 가장 배점이 높은 항목은 무엇인가?
- 대상자의 문제를 증명할 수 있는 정량/정성 근거는 무엇인가?
- 신청자의 고유한 실행 경험은 어떤 문장으로 보여줄 수 있는가?
- 성과지표의 측정 시점과 증빙자료는 무엇인가?
`;
}

function generateDraft() {
  const data = collectProject();
  const draft = generateDraftText(data);
  qs("#draftOutput").value = draft;
  saveProject();
  showToast("초안을 생성했습니다.");
}

function exportMarkdown() {
  const data = collectProject();
  const content = qs("#draftOutput").value.trim() || generateDraftText(data);
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = (data.projectName || "planning-copilot-draft").replace(/[\\/:*?"<>|]/g, "_");
  link.href = url;
  link.download = `${safeName}.md`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Markdown 파일을 내보냈습니다.");
}

function copyDraft() {
  const output = qs("#draftOutput");
  if (!output.value.trim()) generateDraft();
  navigator.clipboard.writeText(output.value).then(() => showToast("초안을 복사했습니다."));
}

let autosaveTimer;
function autosaveSoon() {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectProject()));
  }, 500);
}

qsa(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchSection(button.dataset.section));
});

qsa("[data-add-row]").forEach((button) => {
  button.addEventListener("click", () => {
    addTableRow(button.dataset.addRow);
    autosaveSoon();
  });
});

qsa("input, textarea").forEach((field) => field.addEventListener("input", autosaveSoon));
qs("#saveProject").addEventListener("click", saveProject);
qs("#analyzeNotice").addEventListener("click", analyzeNoticeText);
qs("#noticeFile").addEventListener("change", importNoticeFile);
qs("#generateCoaching").addEventListener("click", () => generateCoaching(false));
qs("#addKnowledgeDoc").addEventListener("click", addKnowledgeDoc);
qs("#knowledgeFile").addEventListener("change", importKnowledgeFile);
qs("#searchKnowledge").addEventListener("click", searchKnowledge);
qs("#clearKnowledge").addEventListener("click", clearKnowledge);
qs("#generateModelPrompt").addEventListener("click", generateModelPrompt);
qs("#copyModelPrompt").addEventListener("click", copyModelPrompt);
qs("#absorbModelResponse").addEventListener("click", absorbModelResponse);
qs("#downloadArchive").addEventListener("click", downloadArchive);
qs("#archiveFile").addEventListener("change", importArchiveFile);
qs("#driveEndpoint").addEventListener("input", saveDriveEndpoint);
qs("#backupToDrive").addEventListener("click", backupToDrive);
qs("#copyAppsScript").addEventListener("click", copyAppsScript);
qs("#generateDraft").addEventListener("click", generateDraft);
qs("#exportMarkdown").addEventListener("click", exportMarkdown);
qs("#copyDraft").addEventListener("click", copyDraft);

qs("#loadExample").addEventListener("click", () => {
  fillProject(exampleProject);
  saveProject();
  showToast("예시를 불러왔습니다.");
});

qs("#resetProject").addEventListener("click", () => {
  if (!window.confirm("현재 입력값을 초기화할까요?")) return;
  localStorage.removeItem(STORAGE_KEY);
  fillProject({});
  showToast("초기화했습니다.");
});

loadStoredProject();
renderKnowledgeLibrary();
fillAppsScriptTemplate();
loadDriveEndpoint();
