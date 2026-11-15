// david-workbrain · Notion 연계용 Markdown 내보내기.
// david-workbrain의 `01_회사_사업/` 또는 `outputs/`에 그대로 넣을 수 있도록
// OKF 스타일 YAML frontmatter + 메타데이터 + 일정/마감 요약 + 예산·정산 체크리스트 + 후속 할 일 구조로 만든다.

import {
  budgetSummary,
  checklistSummary,
  dDayLabel,
  formatWon,
  groupChecklist,
  parseAmount,
  pendingFollowUps,
  reportSummary,
  scheduleEntries,
  toText
} from "./grantWorkflow.mjs";
import { attendanceReport, expenseSummary } from "./projectOperations.mjs";

export const DEFAULT_SENSITIVE_HANDLING =
  "개인정보, 정산자료, 계약자료, 주민정보 가능 자료는 자동 요약하지 않고 검토 필요로 표시";

export const WORKSPACE_LINKS = [
  { label: "my-workbench", url: "https://okrangone98-oss.github.io/my-workbench/", role: "업무 지시·진행 현황·결과 검토·승인" },
  { label: "david-workbrain", url: "https://github.com/okrangone98-oss/david-workbrain", role: "업무 지식·SOP·문서 템플릿 저장소" }
];

const DOMAINS = new Set(["company", "personal", "shared"]);
const FOLDERS = new Set(["01_회사_사업", "outputs"]);

function yamlValue(value) {
  const text = toText(value, 400);
  if (!text) return '""';
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
}

export function todayLabel(now) {
  const date = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function slugify(value, fallback) {
  const text = toText(value, 80)
    .replace(/[\\/:*?"<>|#%{}^~[\]]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text || fallback;
}

export function buildWorkbrainFileName(options, now) {
  const program = slugify(options?.programName || options?.title || "국고보조사업", "국고보조사업");
  return `${program}_예산정산결과보고_${todayLabel(now) || "작성일"}.md`;
}

function cell(value) {
  const text = toText(value, 400);
  return text ? text.replace(/\|/g, "/").replace(/\r?\n/g, " ") : "-";
}

function table(headers, rows) {
  const headerLine = `| ${headers.join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(cell).join(" | ")} |`);
  return [headerLine, divider, ...body].join("\n");
}

function metadataBody(plan, options, summary) {
  const rows = [
    ["사업명", plan.programName || options.title || "미입력"],
    ["프리셋", plan.presetName || "직접 구성"],
    ["회계연도", plan.fundingYear || "미입력"],
    ["지원·발주기관", plan.agency || "미입력"],
    ["재원", plan.fundingSource || "미입력"],
    ["예산 총액", summary.total ? formatWon(summary.total) : "미편성"],
    ["재원 구성", summary.total
      ? `국비 ${formatWon(summary.funding.subsidy)} · 지방비 ${formatWon(summary.funding.local)} · 자부담 ${formatWon(summary.funding.self)}`
      : "미편성"],
    ["정산 증빙 진행", `${summary.checkDone}/${summary.checkTotal} (필수 ${summary.checkRequiredDone}/${summary.checkRequiredTotal})`],
    ["결과보고 작성", `${summary.reportWritten}/${summary.reportTotal} 섹션`],
    ["작성 폴더", options.targetFolder],
    ["출처", "planning-copilot 로컬 초안 (승인 전)"]
  ];
  return table(["항목", "값"], rows);
}

function scheduleBody(plan, now) {
  const entries = scheduleEntries(plan);
  const memo = toText(plan.schedule?.memo, 2000);
  if (!entries.length && !memo) {
    return "아직 등록된 일정이 없습니다. 신청 마감, 사업 기간, 정산·결과보고 마감을 입력하면 여기에 요약됩니다.";
  }
  const lines = [];
  if (entries.length) {
    const rows = entries.map((entry) => [entry.label, entry.value, dDayLabel(entry.value, now) || "-"]);
    lines.push(table(["구분", "날짜", "남은 기간"], rows));
  }
  if (memo) lines.push("", `> 일정 메모: ${memo}`);
  return lines.join("\n");
}

function budgetBody(plan) {
  const summary = budgetSummary(plan);
  if (!summary.total) return "아직 편성된 비목이 없습니다.";
  const rows = summary.rows.map((line) => [
    line.category,
    line.item,
    line.unitCost ? formatWon(parseAmount(line.unitCost)) : "-",
    line.quantity || "-",
    formatWon(line.amount),
    line.basis,
    line.note
  ]);
  rows.push(["합계", "", "", "", formatWon(summary.total), "", ""]);

  const fundingRows = [
    ["국비", formatWon(summary.funding.subsidy), `${summary.funding.rates.subsidyRate}%`],
    ["지방비", formatWon(summary.funding.local), `${summary.funding.rates.localRate}%`],
    ["자부담", formatWon(summary.funding.self), `${summary.funding.rates.selfRate}%`]
  ];
  const categoryRows = summary.byCategory.map((entry) => [entry.category, formatWon(entry.total), `${entry.share}%`]);

  const lines = ["### 재원 구성", "", table(["재원", "금액", "비율"], fundingRows)];
  if (summary.funding.rateMismatch) {
    lines.push("", `> 입력한 비율 합이 ${summary.funding.rateSum}%입니다. 합이 100%가 아니면 자부담을 잔액으로 계산했습니다.`);
  }
  lines.push(
    "",
    "### 비목별 편성",
    "",
    table(["비목", "세목", "단가", "수량", "금액", "산출근거", "비고"], rows),
    "",
    "### 비목별 비중",
    "",
    table(["비목", "금액", "비중"], categoryRows)
  );
  return lines.join("\n");
}

function checklistBody(plan) {
  const summary = checklistSummary(plan);
  if (!summary.total) return "아직 점검 항목이 없습니다. 예산·정산 화면에서 프리셋을 적용해 주세요.";
  const lines = [`> 진행 ${summary.done}/${summary.total} · 필수 ${summary.requiredDone}/${summary.requiredTotal} · ${summary.percent}%`];
  groupChecklist(plan).forEach((group) => {
    lines.push("", `### ${group.title}`);
    group.items.forEach((item) => {
      const marker = item.checked ? "x" : " ";
      const required = item.required ? " (필수)" : "";
      const basis = item.basis ? ` — ${item.basis}` : "";
      lines.push(`- [${marker}] ${item.label}${required}${basis}`);
      if (item.note) lines.push(`  - 메모: ${item.note}`);
    });
  });
  return lines.join("\n");
}

function reportBody(plan) {
  const summary = reportSummary(plan);
  const sections = Array.isArray(plan.reportSections) ? plan.reportSections : [];
  if (!sections.length) return "아직 골격이 없습니다. 결과보고 화면에서 프리셋을 적용해 주세요.";
  const missing = summary.missing.map((section) => section.title);
  const lines = [`> 작성 ${summary.written}/${summary.total} 섹션${missing.length ? ` · 미작성: ${missing.join(", ")}` : ""}`];
  sections.forEach((section) => {
    lines.push("", `### ${section.title}`, "");
    const content = toText(section.content, 8000);
    lines.push(content || `_작성 필요_${section.hint ? ` · ${section.hint}` : ""}`);
  });
  return lines.join("\n");
}

function draftBody(plan, projectDraft) {
  const draft = toText(projectDraft, 12000);
  return draft || `초안 조립 화면에서 초안을 만들면 이곳에 함께 내보냅니다. (사업명: ${plan.programName || "미입력"})`;
}

/**
 * 운영 실적·집행 현황: 회차 참석 연인원과 비목별 계획·집행·잔액을 문서에 그대로 싣는다.
 * 미입력·집계 제외를 0명과 섞지 않도록, 합계 옆에 무엇이 빠졌는지 함께 적는다.
 */
function operationsBody(plan, work) {
  if (!work || typeof work !== "object") return "";
  const sessions = Array.isArray(work.sessions) ? work.sessions : [];
  const expenses = Array.isArray(work.expenses) ? work.expenses : [];
  if (!sessions.length && !expenses.length) return "";
  const attendance = attendanceReport(work);
  const ledger = expenseSummary(work, plan);
  const lines = [];

  if (sessions.length) {
    const notes = [];
    if (attendance.missingCount) notes.push(`미입력 ${attendance.missingCount}회차는 합계에 넣지 않았습니다.`);
    if (attendance.untracked) notes.push(`인원 기록을 꺼 둔 ${attendance.untracked}회차는 집계 제외입니다(0명이 아님).`);
    if (attendance.zeroSessions) notes.push(`적힌 0명 ${attendance.zeroSessions}회차는 합계에 포함했습니다.`);
    lines.push(
      table(
        ["항목", "값"],
        [
          ["회차", `전체 ${attendance.sessionTotal} · 집계 대상 ${attendance.tracked} · 완료 ${attendance.doneSessions}${attendance.cancelled ? ` · 취소 ${attendance.cancelled}` : ""}`],
          ["참석 연인원", attendance.tracked ? `${attendance.attended}명` : "인원을 기록한 회차 없음"],
          ["완료 회차 참석", `${attendance.attendedDone}명`]
        ]
      )
    );
    if (notes.length) lines.push("", `> ${notes.join(" ")}`);
  }

  if (expenses.length) {
    lines.push(
      "",
      table(
        ["비목", "계획액", "집행액", "잔액", "집행률"],
        [
          ...ledger.rows.map((row) => [row.category, formatWon(row.plan), formatWon(row.spent), formatWon(row.balance), row.plan ? `${row.rate}%` : "-"]),
          ["합계", formatWon(ledger.total.plan), formatWon(ledger.total.spent), formatWon(ledger.total.balance), ledger.total.plan ? `${ledger.total.rate}%` : "-"]
        ]
      ),
      "",
      `> 집행액은 집행 완료 + 지출 예정입니다. 계획만 세운 ${formatWon(ledger.plannedOnly)}은 잔액에서 빼지 않았습니다. 증빙 확인 ${ledger.evidence.checked}/${ledger.evidence.total}건${ledger.evidence.missing ? ` · 미확인 ${ledger.evidence.missing}건(${formatWon(ledger.evidence.missingAmount)})` : ""}.`
    );
    if (ledger.overRows.length) lines.push(`> 계획을 넘긴 비목: ${ledger.overRows.join(", ")}`);
  }

  return lines.join("\n");
}

function followUpBody(plan, now) {
  const followUps = pendingFollowUps(plan, now);
  if (!followUps.length) return "- [ ] 제출 전 원본 증빙과 금액을 한 번 더 확인합니다.";
  const lines = [];
  const schedule = followUps.filter((item) => item.kind === "일정");
  const others = followUps.filter((item) => item.kind !== "일정");
  if (schedule.length) {
    lines.push("### 마감 확인");
    schedule.forEach((item) => lines.push(`- [ ] ${item.label}${item.detail ? ` (${item.detail})` : ""}`));
  }
  if (others.length) {
    if (lines.length) lines.push("");
    lines.push("### 보완 작업");
    others.forEach((item) => lines.push(`- [ ] [${item.kind}] ${item.label}${item.detail ? ` — ${item.detail}` : ""}`));
  }
  return lines.join("\n");
}

function linksBody(project) {
  const links = [
    ...WORKSPACE_LINKS.map((link) => [link.label, link.url]),
    ["Jira", toText(project?.jiraUrl, 500)],
    ["Notion", toText(project?.notionUrl, 500)],
    ["Google Sheet", toText(project?.spreadsheetUrl, 500)],
    ["Google Drive", toText(project?.driveFolderUrl, 500)]
  ].filter(([, url]) => url);
  const lines = links.map(([label, url]) => `- ${label}: ${url}`);
  lines.push("", "> 이 노트는 원본 자료를 옮기지 않습니다. 원본 파일은 로컬·Drive에 두고 링크와 요약만 남깁니다.");
  return lines.join("\n");
}

function normalizeOptions(options, plan) {
  const value = options && typeof options === "object" ? options : {};
  const tags = (Array.isArray(value.tags) ? value.tags : [])
    .map((tag) => toText(tag, 30))
    .filter(Boolean)
    .slice(0, 10);
  return {
    title: toText(value.title, 120) || toText(plan.programName, 120) || "국고보조사업 예산·정산·결과보고",
    description: toText(value.description, 300)
      || `${toText(plan.programName, 80) || "국고보조사업"}의 예산 편성·정산 증빙·결과보고 초안을 planning-copilot에서 정리한 노트입니다.`,
    domain: DOMAINS.has(value.domain) ? value.domain : "company",
    targetFolder: FOLDERS.has(value.targetFolder) ? value.targetFolder : "01_회사_사업",
    status: toText(value.status, 20) || "draft",
    deadline: toText(value.deadline || plan.schedule?.reportDeadline || plan.schedule?.settlementDeadline, 20),
    tags: tags.length ? tags : ["planning-copilot", "국고보조사업", "예산정산"],
    includeBudget: value.includeBudget !== false,
    includeChecklist: value.includeChecklist !== false,
    includeReport: value.includeReport !== false,
    includeDraft: Boolean(value.includeDraft),
    includeFollowUps: value.includeFollowUps !== false
  };
}

/**
 * david-workbrain · Notion에 붙일 Markdown 한 편을 만든다.
 * 원본 증빙 파일은 담지 않고, 요약·체크 상태·할 일만 담는다.
 */
export function buildWorkbrainMarkdown({ plan, project, options, work, now } = {}) {
  const safePlan = plan && typeof plan === "object" ? plan : {};
  const safeProject = project && typeof project === "object" ? project : {};
  const settings = normalizeOptions(options, safePlan);
  const budget = budgetSummary(safePlan);
  const checks = checklistSummary(safePlan);
  const report = reportSummary(safePlan);
  const summary = {
    total: budget.total,
    funding: budget.funding,
    checkTotal: checks.total,
    checkDone: checks.done,
    checkRequiredTotal: checks.requiredTotal,
    checkRequiredDone: checks.requiredDone,
    reportTotal: report.total,
    reportWritten: report.written
  };
  const fileName = buildWorkbrainFileName({ programName: safePlan.programName, title: settings.title }, now);
  const created = todayLabel(now);

  const frontmatter = [
    "---",
    "type: project",
    `title: ${yamlValue(settings.title)}`,
    `description: ${yamlValue(settings.description)}`,
    "resource: planning_copilot",
    `source_path: ${yamlValue(`${settings.targetFolder}/${fileName}`)}`,
    `domain: ${settings.domain}`,
    "agent_ready: true",
    `sensitive_handling: ${yamlValue(DEFAULT_SENSITIVE_HANDLING)}`,
    `status: ${settings.status}`,
    `program: ${yamlValue(safePlan.programName || settings.title)}`,
    `agency: ${yamlValue(safePlan.agency)}`,
    `funding_source: ${yamlValue(safePlan.fundingSource)}`,
    `budget_total: ${budget.total || 0}`,
    `deadline: ${settings.deadline ? yamlValue(settings.deadline) : '""'}`,
    `tags: [${settings.tags.map((tag) => yamlValue(tag)).join(", ")}]`,
    `created: ${created ? yamlValue(created) : '""'}`,
    `timestamp: ${created ? yamlValue(created) : '""'}`,
    "exported_by: planning-copilot",
    "---"
  ].join("\n");

  const sections = [
    ["메타데이터", metadataBody(safePlan, settings, summary)],
    ["추진 일정·마감일 요약", scheduleBody(safePlan, now)]
  ];
  if (settings.includeBudget) sections.push(["예산 편성표", budgetBody(safePlan)]);
  const operations = operationsBody(safePlan, work);
  if (operations) sections.push(["운영 실적·집행 현황", operations]);
  if (settings.includeChecklist) sections.push(["정산 증빙 체크리스트", checklistBody(safePlan)]);
  if (settings.includeReport) sections.push(["결과보고서 초안", reportBody(safePlan)]);
  if (settings.includeDraft) sections.push(["사업계획서 초안", draftBody(safePlan, safeProject.draftOutput)]);
  if (settings.includeFollowUps) sections.push(["후속 할 일", followUpBody(safePlan, now)]);
  sections.push(["연결", linksBody(safeProject)]);

  const body = sections
    .map(([title, content], index) => `## ${index + 1}. ${title}\n\n${content}`)
    .join("\n\n");

  return `${frontmatter}\n\n# ${settings.title}\n\n> ${settings.description}\n\n${body}\n`;
}

/** Notion에 붙여넣을 때는 frontmatter를 코드블록으로 감싸 본문 제목 흐름을 해치지 않게 한다. */
export function buildNotionPasteMarkdown(markdown) {
  const text = toText(markdown, 60000);
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return text;
  const rest = text.slice(match[0].length).trimStart();
  return `${rest}\n\n## 속성(YAML frontmatter)\n\n\`\`\`yaml\n${match[1]}\n\`\`\`\n`;
}
