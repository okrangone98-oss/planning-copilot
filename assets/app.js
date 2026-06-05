import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";

const STORAGE_KEY = "planningCopilotProject";
const RAG_DOCS_KEY = "planningCopilotKnowledgeDocs";
const DRIVE_ENDPOINT_KEY = "planningCopilotDriveEndpoint";

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

const sectionTitles = {
  notice: "공고 해석",
  cowork: "질문 받기",
  ragRoom: "사례 모으기",
  aiBridge: "AI 질문",
  visuals: "시각자료",
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

const tableSchemas = {
  metricsTable: ["구분", "지표명", "목표값", "측정 방법"],
  blueprintTable: ["단계", "사용자 행동", "접점", "운영 방식", "실패 가능성"]
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

const exampleProject = {
  projectName: "생활문화 혁신 지원사업",
  noticeText: "지역 생활문화 기반의 주민 참여형 혁신 사업을 발굴하고, 실행 가능한 운영체계와 확산 가능성을 갖춘 프로젝트를 지원한다. 평가항목은 사업 필요성, 추진역량, 실행계획의 구체성, 성과관리, 지역사회 파급효과를 중심으로 한다. 선정 사업은 6개월 내 실행 결과를 제출해야 하며, 예산 집행계획과 협력기관 역할분담이 명확해야 한다.",
  policyGoal: "지역 생활문화의 참여 기회를 넓히고, 주민이 체감할 수 있는 생활권 단위의 문제 해결 모델을 만든다.",
  evaluationFocus: "사업 필요성, 대상자의 명확성, 실행계획의 구체성, 추진역량, 성과관리, 지역사회 확산 가능성",
  requirements: "6개월 내 실행, 예산 집행계획 제출, 협력기관 역할분담, 성과자료 제출",
  advantageSignals: "지역 주민의 실제 불편에서 출발한 문제정의, 협력기관과의 실행체계, 측정 가능한 성과지표",
  coreIdea: "지역 주민이 직접 생활문화 문제를 발견하고 작은 실험을 통해 해결안을 만드는 참여형 프로그램",
  targetUsers: "생활문화 활동에 참여하고 싶지만 정보, 공간, 연결망이 부족한 지역 주민",
  fieldEvidence: "지역 커뮤니티 인터뷰, 주민 모임 운영 경험, 유휴공간 활용 수요",
  founderInsight: "문화 프로그램을 제공하는 방식보다 주민이 직접 문제를 발견하고 실행하는 경험이 더 오래 남는다.",
  problemSituation: "생활문화 활동은 많아졌지만 주민이 자신의 생활 문제와 연결해 참여하는 구조는 부족하다.",
  rootCauses: "정보 접근성 부족, 활동 공간의 분산, 주민 간 연결망 부족, 단발성 프로그램 중심 운영",
  existingLimits: "기존 프로그램은 참여자 모집과 일회성 체험에 치우쳐 지속적인 지역 변화로 이어지기 어렵다.",
  whyNow: "지역 단위의 돌봄, 관계망, 생활문화 수요가 커지고 있어 주민 주도 실행 모델이 필요하다.",
  inputs: "운영인력, 협력기관, 주민 모임, 활동공간, 소규모 실험 예산",
  activities: "주민 인터뷰, 문제발견 워크숍, 생활문화 실험, 결과 공유회, 확산 매뉴얼 작성",
  outputs: "주민 참여자 수, 실행 실험 수, 협력기관 수, 결과 공유 자료, 확산 매뉴얼",
  shortOutcomes: "주민의 문제해결 참여 경험 증가, 지역 내 협력 연결망 확대",
  longOutcomes: "생활문화 기반의 주민 주도 문제해결 모델 확산",
  milestones: "1개월차 공고 분석과 대상자 모집, 2개월차 문제발견 워크숍, 3-5개월차 생활문화 실험, 6개월차 결과 공유와 성과정리",
  teamSystem: "운영기관은 전체 기획과 성과관리를 맡고, 협력기관은 공간과 참여자 연결을 지원하며, 주민 모임은 실험 실행을 담당한다.",
  budgetPlan: "워크숍 운영비, 주민 실험비, 홍보비, 결과자료 제작비, 성과조사비로 구분한다.",
  riskPlan: "모집 부진은 협력기관 추천과 소규모 설명회로 보완하고, 일정 지연은 실험 단위를 작게 나누어 대응한다.",
  metricsTable: [
    ["과정", "주민 인터뷰 수", "30명", "인터뷰 기록"],
    ["산출", "생활문화 실험 수", "5건", "실행 결과보고"],
    ["결과", "참여자 만족도", "4.5점 이상", "사후 설문"],
    ["확산", "협력기관 후속 참여 의향", "3곳 이상", "확인서"]
  ],
  blueprintTable: [
    ["발견", "생활 속 불편을 말한다", "인터뷰/설문", "질문지와 기록 양식 제공", "참여자 발화가 추상적일 수 있음"],
    ["기획", "해결 실험을 고른다", "워크숍", "진행자가 실행 단위를 작게 쪼갬", "아이디어가 과도하게 커질 수 있음"],
    ["실행", "소규모 실험을 한다", "지역 공간", "협력기관이 장소와 홍보 지원", "일정 조율 실패"],
    ["공유", "결과를 나눈다", "공유회/온라인", "성과자료와 사진 기록 정리", "성과가 정량화되지 않을 수 있음"]
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

function fieldByKey(key) {
  return qs(`[data-key="${key}"]`);
}

function setField(key, value, overwrite = true) {
  const field = fieldByKey(key);
  if (!field || !value) return;
  if (overwrite || !field.value.trim()) field.value = value;
}

function collectProject() {
  const data = { projectName: qs("#projectName").value.trim() };
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
    version: 2,
    exportedAt: new Date().toISOString(),
    app: "planning-copilot",
    project: collectProject(),
    knowledgeDocs: loadKnowledgeDocs()
  };
}

function archiveFileName() {
  const projectName = qs("#projectName").value.trim() || "planning-copilot";
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, "_");
  return `${safeName}-archive-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadTextFile(content, fileName, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadArchive() {
  downloadTextFile(
    JSON.stringify(createArchive(), null, 2),
    archiveFileName(),
    "application/json;charset=utf-8"
  );
  showToast("백업 파일을 내려받았습니다.");
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
  localStorage.setItem(DRIVE_ENDPOINT_KEY, qs("#driveEndpoint").value.trim());
}

function loadDriveEndpoint() {
  qs("#driveEndpoint").value = localStorage.getItem(DRIVE_ENDPOINT_KEY) || "";
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

function copyText(text, message) {
  navigator.clipboard.writeText(text).then(() => showToast(message));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderKnowledgeLibrary() {
  const library = qs("#knowledgeLibrary");
  const docs = loadKnowledgeDocs();
  if (!docs.length) {
    library.innerHTML = `<div class="knowledge-item"><strong>저장한 사례가 없습니다.</strong><span>좋은 사업계획서, 공고문, 평가표를 추가해 보세요.</span></div>`;
    return;
  }
  library.innerHTML = docs
    .map((doc) => {
      const length = doc.text ? doc.text.length.toLocaleString() : "0";
      const date = doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "";
      return `<div class="knowledge-item">
        <strong>${escapeHtml(doc.title || "제목 없음")}</strong>
        <span>${escapeHtml(doc.type || "문서")} · ${length}자 · ${date}</span>
      </div>`;
    })
    .join("");
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

function fillProject(data = {}) {
  qs("#projectName").value = data.projectName || "";
  qsa("[data-key]").forEach((field) => {
    field.value = data[field.dataset.key] || "";
  });
  Object.keys(tableSchemas).forEach((tableId) => {
    const tbody = qs(`#${tableId} tbody`);
    tbody.innerHTML = "";
    const rows = Array.isArray(data[tableId]) && data[tableId].length ? data[tableId] : [emptyRow(tableId)];
    rows.forEach((row) => addTableRow(tableId, row));
  });
  qs("#draftOutput").value = data.draftOutput || "";
  renderVisual().catch(() => {});
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
  qs("#sectionTitle").textContent = sectionTitles[sectionId] || "";
  if (sectionId === "visuals") renderVisual().catch(() => {});
}

function readFileAsText(file, onText) {
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "").trim();
    if (!text || text.includes("\u0000")) {
      showToast("이 파일은 브라우저에서 바로 읽기 어렵습니다. 텍스트를 복사해 붙여넣어 주세요.");
      return;
    }
    onText(text);
  };
  reader.onerror = () => showToast("파일을 읽지 못했습니다.");
  reader.readAsText(file, "utf-8");
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?。])\s+|(?=\d+\s*[.)]\s)/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 8);
}

function findSentences(text, keywords, limit = 5) {
  return splitSentences(text)
    .filter((sentence) => keywords.some((keyword) => sentence.includes(keyword)))
    .slice(0, limit)
    .join("\n");
}

function findFacts(text) {
  const dates = text.match(/\d{4}[.\-/년]\s?\d{1,2}([.\-/월]\s?\d{0,2})?|마감|접수|신청기간/g) || [];
  const amounts = text.match(/\d+\s?(억|만원|천원|%|개사|명|건)|최대\s?\d+\s?(억|만원|천원)/g) || [];
  const scores = text.match(/[^.\n]*(평가|배점|추진전략|수행역량|파급효과|성과)[^.\n]*/g) || [];
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
    showToast("먼저 공고문 내용을 붙여넣어 주세요.");
    return;
  }

  const facts = findFacts(text);
  const policy = findSentences(text, ["목적", "취지", "지원", "해결", "혁신", "성장", "확산"], 4);
  const evaluation = [
    findSentences(text, ["평가", "배점", "추진전략", "수행역량", "파급효과", "성과"], 6),
    facts.scores.join("\n")
  ].filter(Boolean).join("\n");
  const requirements = [
    findSentences(text, ["신청", "접수", "제출", "서류", "자격", "대상", "제외", "필수"], 7),
    facts.dates.length ? `주요 일정/조건: ${facts.dates.join(", ")}` : "",
    facts.amounts.length ? `숫자 조건: ${facts.amounts.join(", ")}` : ""
  ].filter(Boolean).join("\n");
  const advantages = findSentences(text, ["우대", "가점", "추천", "협력", "성과", "확산", "브랜드", "지역"], 5);

  setField("policyGoal", policy || "공고문의 정책 목적을 추가 확인해야 합니다.");
  setField("evaluationFocus", evaluation || "평가항목과 배점을 추가 확인해야 합니다.");
  setField("requirements", requirements || "자격, 제출서류, 마감일을 추가 확인해야 합니다.");
  setField("advantageSignals", advantages || "우대조건과 차별화 신호를 추가 확인해야 합니다.");
  generateCoaching(true);
  saveProject();
  showToast("공고문을 분석하고 다음 질문을 만들었습니다.");
}

function chunkText(text, size = 900, overlap = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    const chunk = clean.slice(start, start + size).trim();
    if (chunk.length > 80) chunks.push(chunk);
  }
  return chunks;
}

function tokenize(text) {
  return String(text || "")
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
  ].filter(Boolean).join("\n");
}

function searchKnowledgeDocs(query, limit = 6) {
  const queryVector = termVector(query);
  const scored = [];
  loadKnowledgeDocs().forEach((doc) => {
    chunkText(doc.text).forEach((chunk, index) => {
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

function addKnowledgeDoc() {
  const text = qs("#knowledgeText").value.trim();
  if (!text) {
    showToast("저장할 문서 내용을 입력해 주세요.");
    return;
  }
  const docs = loadKnowledgeDocs();
  docs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: qs("#knowledgeTitle").value.trim() || "이름 없는 사례",
    type: qs("#knowledgeType").value.trim() || "사례",
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
  setField("ragResults", formatKnowledgeResults(searchKnowledgeDocs(query)));
  saveProject();
  showToast("관련 사례를 찾았습니다.");
}

function clearKnowledge() {
  if (!window.confirm("저장한 사례를 모두 지울까요?")) return;
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
    fieldByKey("noticeText").value = text;
    analyzeNoticeText();
  });
  event.target.value = "";
}

function generateCoaching(fromNotice = false) {
  const data = collectProject();
  const scoreHint = data.evaluationFocus || "평가 포인트";
  const policyHint = data.policyGoal || "정책 목적";
  const ideaHint = data.coreIdea || "사용자의 핵심 아이디어";

  setField("agentMemo", [
    `이 공고는 ${policyHint}에 맞춰 답해야 합니다.`,
    `작성의 중심은 ${scoreHint}에 대응하는 근거를 만드는 것입니다.`,
    `아이디어는 '${ideaHint}' 자체보다 왜 필요하고, 어떻게 실행하며, 어떤 성과로 증명하는지가 중요합니다.`
  ].join("\n"));

  setField("nextQuestions", [
    "1. 이 사업의 대상자는 누구이며, 지금 가장 크게 겪는 불편은 무엇인가요?",
    "2. 그 불편이 개인 문제가 아니라 지역, 시장, 정책 문제라는 근거는 무엇인가요?",
    "3. 기존 사업이나 서비스는 왜 충분하지 않았나요?",
    "4. 공고의 가장 중요한 평가항목에 대응하는 실행계획은 무엇인가요?",
    "5. 신청자가 이미 보유한 경험, 협력망, 자원, 실적은 무엇인가요?",
    "6. 3개월, 6개월, 종료 시점에 무엇이 달라졌다고 증명할 수 있나요?"
  ].join("\n"));

  setField("writingStrategy", [
    "문제정의: 대상자의 불편과 정책 목적을 한 문단 안에서 연결합니다.",
    "실행계획: 활동 목록보다 일정, 역할, 예산 근거를 먼저 보여줍니다.",
    "추진역량: 사람, 경험, 협력망, 보유자원을 역할별로 배치합니다.",
    "성과관리: 참여자 수, 만족도, 후속 참여, 확산 가능성처럼 측정 가능한 지표로 씁니다."
  ].join("\n"));

  setField("missingEvidence", [
    "대상자 인터뷰 또는 실제 불편 사례",
    "시장 규모, 지역 데이터, 검색량, 기존 수요 자료",
    "시제품, 사진, 운영 흐름, 사용자 여정 자료",
    "협력기관, 공급업체, 전문가, 지역 파트너의 역할 증빙",
    "예산 산출 근거와 견적 자료",
    "성과지표별 측정 방법과 증빙 자료"
  ].join("\n"));

  if (!fromNotice) {
    saveProject();
    showToast("다음 질문을 다시 만들었습니다.");
  }
}

function compactSection(title, value) {
  return `## ${title}\n${value && value.trim() ? value.trim() : "아직 입력하지 않음"}`;
}

function buildModelPrompt(data) {
  return `당신은 정부지원사업 사업계획서 전문 공동기획자입니다. 아래 자료를 평가자 관점으로 분석하고, 사용자의 아이디어가 사라지지 않도록 사업계획서로 발전시켜 주세요.

답변은 반드시 다음 형식으로 작성해 주세요.

1. 공고 해석
- 이 공고가 실제로 원하는 것
- 가장 중요한 평가 신호
- 탈락 위험이 있는 빈틈

2. 공동기획 질문
- 사용자에게 추가로 물어봐야 할 질문 10개
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
- 예산, 성과, 협력 관련 증빙

주의사항:
- 공고문에 없는 사실은 단정하지 마세요.
- 사용자의 아이디어를 일반적인 문장으로 희석하지 마세요.
- 결과는 한국어 사업계획서 문체로 작성하세요.

${compactSection("공고문", data.noticeText)}

${compactSection("내 사례에서 찾은 참고 내용", data.ragResults)}

${compactSection("정책 목적", data.policyGoal)}

${compactSection("평가 포인트", data.evaluationFocus)}

${compactSection("필수 조건", data.requirements)}

${compactSection("차별화 기회", data.advantageSignals)}

${compactSection("사용자의 핵심 아이디어", data.coreIdea)}

${compactSection("대상자", data.targetUsers)}

${compactSection("현장 근거", data.fieldEvidence)}

${compactSection("작성자의 고유 관점", data.founderInsight)}

${compactSection("현재 문제정의", [data.problemSituation, data.rootCauses, data.existingLimits, data.whyNow].filter(Boolean).join("\n"))}

${compactSection("현재 실행설계", [data.milestones, data.teamSystem, data.budgetPlan, data.riskPlan].filter(Boolean).join("\n"))}`;
}

function generateModelPrompt() {
  const data = collectProject();
  if (!data.ragResults && projectSearchQuery(data).trim()) {
    data.ragResults = formatKnowledgeResults(searchKnowledgeDocs(projectSearchQuery(data)));
    setField("ragResults", data.ragResults);
  }
  setField("modelPrompt", buildModelPrompt(data));
  saveProject();
  showToast("AI에게 물어볼 질문을 만들었습니다.");
}

function copyModelPrompt() {
  const promptField = fieldByKey("modelPrompt");
  if (!promptField.value.trim()) generateModelPrompt();
  copyText(promptField.value, "AI 질문을 복사했습니다.");
}

function absorbModelResponse() {
  const response = fieldByKey("modelResponse").value.trim();
  if (!response) {
    showToast("먼저 AI 답변을 붙여넣어 주세요.");
    return;
  }
  setField("aiSynthesis", [
    "AI 답변 요약",
    response.slice(0, 4000),
    "",
    "반영 기준",
    "- 공고문과 충돌하는 내용은 제외한다.",
    "- 사용자의 현장 경험과 고유 관점이 드러나는 문장을 우선 반영한다.",
    "- 평가항목, 배점, 제출양식과 직접 연결되는 내용부터 초안에 적용한다."
  ].join("\n"));
  saveProject();
  showToast("AI 답변을 반영 메모로 정리했습니다.");
}

function safeNode(text, fallback) {
  const clean = String(text || fallback || "보완 필요")
    .replace(/[`"'<>[\]{}|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
  return clean || fallback || "보완 필요";
}

function firstLine(text, fallback) {
  return safeNode(String(text || "").split(/\n|\. /).find(Boolean), fallback);
}

function buildMermaid(data) {
  return `flowchart LR
  A["문제: ${firstLine(data.problemSituation, "해결할 문제")}"]
  B["대상: ${firstLine(data.targetUsers, "대상자")}"]
  C["투입: ${firstLine(data.inputs, "인력/예산/협력")}"]
  D["활동: ${firstLine(data.activities, "주요 활동")}"]
  E["산출: ${firstLine(data.outputs, "산출물")}"]
  F["단기성과: ${firstLine(data.shortOutcomes, "단기 변화")}"]
  G["중장기성과: ${firstLine(data.longOutcomes, "확산 효과")}"]
  H["평가 포인트: ${firstLine(data.evaluationFocus, "평가기준")}"]

  A --> B --> C --> D --> E --> F --> G
  H -.-> D
  H -.-> F

  classDef problem fill:#fff7f2,stroke:#b85c38,color:#18202a;
  classDef action fill:#eef8f5,stroke:#1f7a68,color:#18202a;
  classDef outcome fill:#f4f7fb,stroke:#2454c6,color:#18202a;
  class A,B problem;
  class C,D,E action;
  class F,G,H outcome;`;
}

async function renderVisual() {
  const preview = qs("#visualPreview");
  if (!preview) return;
  const code = fieldByKey("visualMermaid").value.trim();
  if (!code) {
    preview.textContent = "시각자료 생성 버튼을 누르면 미리보기가 표시됩니다.";
    return;
  }
  try {
    const id = `visual-${Date.now()}`;
    const { svg } = await mermaid.render(id, code);
    preview.innerHTML = svg;
  } catch (error) {
    preview.textContent = `다이어그램을 그리지 못했습니다. 코드 문법을 확인해 주세요.\n${error.message || error}`;
  }
}

async function generateVisual() {
  setField("visualMermaid", buildMermaid(collectProject()));
  await renderVisual();
  saveProject();
  showToast("시각자료 초안을 만들었습니다.");
}

function downloadVisualSvg() {
  const svg = qs("#visualPreview svg");
  if (!svg) {
    showToast("먼저 시각자료를 생성해 주세요.");
    return;
  }
  const name = (qs("#projectName").value.trim() || "planning-copilot-visual").replace(/[\\/:*?"<>|]/g, "_");
  downloadTextFile(svg.outerHTML, `${name}.svg`, "image/svg+xml;charset=utf-8");
  showToast("SVG 파일을 내려받았습니다.");
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

### 필수 조건과 차별화 기회
${bullets([data.requirements, data.advantageSignals].filter(Boolean).join("\n"))}

## 2. 공동기획 질문과 작성 전략

### 분석 메모
${bullets(data.agentMemo)}

### 다음 질문
${bullets(data.nextQuestions)}

### 작성 전략과 부족한 근거
${bullets([data.writingStrategy, data.missingEvidence].filter(Boolean).join("\n"))}

## 3. AI 답변 반영 메모

${bullets(data.aiSynthesis)}

## 4. 샘플 분해에서 가져올 구조

### 참고 문서/출처
${bullets(data.sampleSource)}

### 좋은 구조와 평가 신호
${bullets([data.sampleStructure, data.sampleSignals].filter(Boolean).join("\n"))}

### 우리 사업에 적용할 방식
${bullets(data.sampleAdaptation)}

## 5. 사업 아이디어

### 핵심 아이디어
${bullets(data.coreIdea)}

### 대상자와 현장 근거
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

## 8. 시각자료 초안

\`\`\`mermaid
${data.visualMermaid || buildMermaid(data)}
\`\`\`

${tableToMarkdown("9. 성과지표", tableSchemas.metricsTable, data.metricsTable || [])}

## 10. 실행설계

### 추진 단계
${bullets(data.milestones)}

### 추진 체계
${bullets(data.teamSystem)}

### 예산 설계
${bullets(data.budgetPlan)}

### 위험 대응
${bullets(data.riskPlan)}

${tableToMarkdown("11. 서비스 블루프린트", tableSchemas.blueprintTable, data.blueprintTable || [])}

## 12. 제출 전 보완 질문

- 공고의 실제 평가표에서 가장 높은 배점 항목은 무엇인가?
- 대상자의 문제를 증명할 정량 또는 정성 근거는 충분한가?
- 신청자의 고유한 실행 경험은 문장 안에 드러나는가?
- 성과지표의 측정 시점과 증빙 자료는 명확한가?
`;
}

function generateDraft() {
  qs("#draftOutput").value = generateDraftText(collectProject());
  saveProject();
  showToast("초안을 생성했습니다.");
}

function exportMarkdown() {
  const data = collectProject();
  const content = qs("#draftOutput").value.trim() || generateDraftText(data);
  const safeName = (data.projectName || "planning-copilot-draft").replace(/[\\/:*?"<>|]/g, "_");
  downloadTextFile(content, `${safeName}.md`, "text/markdown;charset=utf-8");
  showToast("Markdown 파일을 내보냈습니다.");
}

function copyDraft() {
  const output = qs("#draftOutput");
  if (!output.value.trim()) generateDraft();
  copyText(output.value, "초안을 복사했습니다.");
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
qs("#generateVisual").addEventListener("click", generateVisual);
qs("#renderVisual").addEventListener("click", () => renderVisual());
qs("#copyVisualCode").addEventListener("click", () => copyText(fieldByKey("visualMermaid").value, "다이어그램 코드를 복사했습니다."));
qs("#downloadVisualSvg").addEventListener("click", downloadVisualSvg);
qs("#downloadArchive").addEventListener("click", downloadArchive);
qs("#archiveFile").addEventListener("change", importArchiveFile);
qs("#driveEndpoint").addEventListener("input", saveDriveEndpoint);
qs("#backupToDrive").addEventListener("click", backupToDrive);
qs("#copyAppsScript").addEventListener("click", () => copyText(APPS_SCRIPT_TEMPLATE, "연결 코드를 복사했습니다."));
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

qs("#appsScriptTemplate").value = APPS_SCRIPT_TEMPLATE;
loadStoredProject();
renderKnowledgeLibrary();
loadDriveEndpoint();
