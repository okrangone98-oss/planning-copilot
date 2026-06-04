const STORAGE_KEY = "planningCopilotProject";

const sectionTitles = {
  notice: "공고 해석",
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
  blueprintTable: ["단계", "사용자 행동", "접점", "백스테이지 운영", "실패 가능성"]
};

const exampleProject = {
  projectName: "공동기획형 사업계획서 에이전트",
  noticeText: "창업/사회혁신/지역문제 해결형 지원사업 공고를 대상으로 평가기준과 양식을 해석하고, 신청자의 아이디어를 사업계획서로 구체화한다.",
  policyGoal: "현장의 아이디어가 정책지원 사업의 언어로 전환되지 못해 좋은 시도가 탈락하는 문제를 완화한다.",
  evaluationFocus: "문제정의의 타당성, 실행 가능성, 성과지표의 적절성, 확산 가능성, 신청자의 추진역량",
  requirements: "공고문, 제출양식, 예산기준, 평가표를 입력자료로 사용한다.",
  advantageSignals: "좋은 샘플 분해, 서비스 디자인, 논리모형 기반 성과 설계, 작성자 고유 관점 반영",
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

## 2. 사업 아이디어

### 핵심 아이디어
${bullets(data.coreIdea)}

### 대상자 및 현장 근거
${bullets([data.targetUsers, data.fieldEvidence].filter(Boolean).join("\n"))}

### 작성자의 고유 관점
${bullets(data.founderInsight)}

## 3. 문제정의

### 문제 상황
${bullets(data.problemSituation)}

### 원인과 기존 해결책의 한계
${bullets([data.rootCauses, data.existingLimits].filter(Boolean).join("\n"))}

### 지금 필요한 이유
${bullets(data.whyNow)}

## 4. 논리모형

| 구분 | 내용 |
| --- | --- |
| 투입 | ${data.inputs || "보완 필요"} |
| 활동 | ${data.activities || "보완 필요"} |
| 산출 | ${data.outputs || "보완 필요"} |
| 단기성과 | ${data.shortOutcomes || "보완 필요"} |
| 중장기성과 | ${data.longOutcomes || "보완 필요"} |

${tableToMarkdown("5. 성과지표", tableSchemas.metricsTable, data.metricsTable || [])}

## 6. 실행설계

### 추진 단계
${bullets(data.milestones)}

### 추진체계
${bullets(data.teamSystem)}

### 예산 설계
${bullets(data.budgetPlan)}

### 리스크 대응
${bullets(data.riskPlan)}

${tableToMarkdown("7. 서비스 블루프린트", tableSchemas.blueprintTable, data.blueprintTable || [])}

## 8. 다음 보완 질문

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
