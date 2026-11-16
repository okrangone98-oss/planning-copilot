// 이용량·보안·운영비 자가진단.
// 지어낸 수치 없이 "지금 이 브라우저에 있는 것"만 세어 화면에 보여 주기 위한 계산 모듈이다.
// 브라우저(localStorage)와 node 테스트에서 함께 쓰므로 mjs로 두고, 타입은 workspaceDiagnostics.d.mts에 둔다.
// 원칙: 저장된 값을 밖으로 내보내지 않는다. 키 탐지 결과도 "어느 저장 키에 있었는지"까지만 돌려준다.

import { providerConfig } from "./modelSafety.mjs";

/** 브라우저 localStorage는 출처(origin)당 보통 5MB 안팎이다. 브라우저마다 달라서 '추정 한도'로만 쓴다. */
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
export const STORAGE_WARN_RATIO = 0.8;
export const STORAGE_CRITICAL_RATIO = 0.95;

/** 백업 파일에 담기는 항목. 모델 설정(키가 들어갈 수 있는 곳)은 일부러 넣지 않는다. */
export const BACKUP_ITEM_LABELS = ["사업 정보", "예산·정산", "업무·회차·지출 원장", "승인함", "프로젝트 기억", "자료·근거"];
export const BACKUP_EXCLUDED_LABELS = ["모델 설정", "API 키(탭 메모리에만 있음)", "올린 양식 원본 파일"];

/** 저장소에 남아 있으면 안 되는 API 키 모양. 값은 돌려주지 않고 종류만 센다. */
export const SECRET_PATTERNS = [
  { id: "openrouter", label: "OpenRouter 키", pattern: /sk-or-[A-Za-z0-9-]{8,}/ },
  { id: "groq", label: "Groq 키", pattern: /gsk_[A-Za-z0-9]{8,}/ },
  { id: "gemini", label: "Google AI Studio 키", pattern: /AIza[A-Za-z0-9_-]{16,}|AQ\.[A-Za-z0-9._-]{20,}/ },
  { id: "amd", label: "AMD Token Lab 키", pattern: /(?:^|[^A-Za-z0-9])tl-[A-Za-z0-9]{16,}/ },
  { id: "github", label: "GitHub 토큰", pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]{16,}/ }
];

function bytesOf(text) {
  // localStorage는 UTF-16로 저장되므로 글자당 2바이트로 어림한다.
  return typeof text === "string" ? text.length * 2 : 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

/** KB 값을 화면에 쓰기 좋은 문자열로 바꾼다. 1024KB부터는 MB로 읽어 준다. */
export function formatStorageSize(kb) {
  const value = Number(kb);
  if (!Number.isFinite(value) || value <= 0) return "0KB";
  if (value >= 1024) return `${(value / 1024).toFixed(1)}MB`;
  if (value < 1) return `${value.toFixed(1)}KB`;
  return `${Math.round(value)}KB`;
}

/**
 * Storage(localStorage)에서 저장 키별 바이트를 모은다.
 * 값은 지역 변수로만 쓰고 결과에 담지 않는다.
 */
export function collectStorageEntries(storage) {
  const entries = [];
  if (!storage) return entries;
  let length = 0;
  try {
    length = Number(storage.length) || 0;
  } catch {
    return entries;
  }
  for (let index = 0; index < length; index += 1) {
    let key = null;
    try {
      key = storage.key(index);
    } catch {
      key = null;
    }
    if (typeof key !== "string" || !key) continue;
    let value = "";
    try {
      value = storage.getItem(key) || "";
    } catch {
      value = "";
    }
    entries.push({ key, bytes: bytesOf(key) + bytesOf(String(value)) });
  }
  return entries;
}

/** 텍스트에서 API 키 모양을 찾는다. 찾은 문자열은 돌려주지 않는다. */
export function findSecretsInText(text) {
  const source = typeof text === "string" ? text : "";
  if (!source) return { total: 0, types: [] };
  const types = [];
  for (const secret of SECRET_PATTERNS) {
    if (secret.pattern.test(source)) types.push({ id: secret.id, label: secret.label });
  }
  return { total: types.length, types };
}

/** 저장소 전체(키+값)를 훑어 키 흔적이 남은 저장 키 이름만 모은다. */
export function scanStorageSecrets(storage) {
  const keys = [];
  const typeIds = new Set();
  if (!storage) return { total: 0, keys, types: [] };
  let length = 0;
  try {
    length = Number(storage.length) || 0;
  } catch {
    return { total: 0, keys, types: [] };
  }
  for (let index = 0; index < length; index += 1) {
    let key = null;
    try {
      key = storage.key(index);
    } catch {
      key = null;
    }
    if (typeof key !== "string" || !key) continue;
    let value = "";
    try {
      value = storage.getItem(key) || "";
    } catch {
      value = "";
    }
    const found = findSecretsInText(`${key}\n${value}`);
    if (!found.total) continue;
    keys.push(key);
    for (const type of found.types) typeIds.add(type.id);
  }
  const types = SECRET_PATTERNS.filter((secret) => typeIds.has(secret.id)).map((secret) => ({ id: secret.id, label: secret.label }));
  return { total: keys.length, keys, types };
}

/** 저장 사용량을 KB·한도 대비 비율로 정리한다. kb는 소수 한 자리 반올림 값이다. */
export function summarizeStorage(entries, quotaBytes = STORAGE_QUOTA_BYTES) {
  const list = Array.isArray(entries) ? entries : [];
  const quota = Number(quotaBytes) > 0 ? Number(quotaBytes) : STORAGE_QUOTA_BYTES;
  const bytes = list.reduce((sum, entry) => sum + (Number(entry?.bytes) || 0), 0);
  const ratio = quota > 0 ? Math.min(bytes / quota, 1) : 0;
  const level = ratio >= STORAGE_CRITICAL_RATIO ? "critical" : ratio >= STORAGE_WARN_RATIO ? "warn" : "ok";
  return {
    bytes,
    kb: round1(bytes / 1024),
    quotaBytes: quota,
    quotaKb: round1(quota / 1024),
    freeKb: round1(Math.max(quota - bytes, 0) / 1024),
    usedRatio: round1(ratio * 1000) / 1000,
    usedPercent: Math.round(ratio * 100),
    entryCount: list.length,
    level
  };
}

const ROUTE_META = {
  "team-free-proxy": {
    label: "공용 무료 AI(Cloudflare 중계)",
    scope: "external",
    costKind: "free-tier",
    costNote: "무료 경로만 연결한 중계를 쓰므로 0원입니다. 한도를 넘으면 요청이 실패하고 과금되지 않습니다.",
    sendNote: "가린 프롬프트가 이 앱의 Cloudflare 중계를 거쳐 무료 AI 제공자에게 전달됩니다. 키는 브라우저에 두지 않습니다."
  },
  simulation: {
    label: "템플릿 모드(규칙 기반)",
    scope: "none",
    costKind: "free",
    costNote: "AI를 호출하지 않으므로 0원입니다.",
    sendNote: "외부로 보내는 자료가 없습니다."
  },
  ollama: {
    label: "Ollama 로컬",
    scope: "local",
    costKind: "free",
    costNote: "내 컴퓨터에서만 돌려 0원입니다(전기료 제외).",
    sendNote: "이 컴퓨터(loopback)로만 보냅니다. 외부 서비스로 나가지 않습니다."
  },
  "openrouter-free": {
    label: "OpenRouter Free",
    scope: "external",
    costKind: "free-tier",
    costNote: "무료 모델만 쓰도록 막아 두어 0원입니다. 무료 한도를 넘으면 요청이 실패하고 과금되지 않습니다.",
    sendNote: "프로젝트 입력란과 일치하는 저장 자료 최대 3건이 외부로 나갑니다."
  },
  "groq-free": {
    label: "Groq 무료 티어",
    scope: "external",
    costKind: "free-tier",
    costNote: "무료 한도 안에서만 0원입니다. 한도를 넘으면 요청이 실패하고 과금되지 않습니다.",
    sendNote: "프로젝트 입력란과 일치하는 저장 자료 최대 3건이 외부로 나갑니다."
  },
  "gemini-openai": {
    label: "Google Gemini 무료",
    scope: "external",
    costKind: "free-tier",
    costNote: "무료 한도 안에서만 0원입니다. 한도를 넘으면 요청이 실패하고 과금되지 않습니다.",
    sendNote: "프로젝트 입력란과 일치하는 저장 자료 최대 3건이 외부로 나갑니다."
  },
  "custom-openai": {
    label: "로컬 프록시(OpenAI 호환)",
    scope: "local",
    costKind: "free",
    costNote: "내가 세운 프록시를 쓰므로 앱 쪽 요금은 0원입니다(프록시 운영비는 별도).",
    sendNote: "localhost·사설망 주소로만 보냅니다. 프록시 뒤에서 외부로 넘길 수 있는지는 그 프록시 설정에 달려 있습니다."
  }
};

/** 고른 AI 경로의 전송 범위·비용을 지어내지 않고 정리한다. */
export function describeAiRoute(modelSettings) {
  const provider = modelSettings && typeof modelSettings.provider === "string" ? modelSettings.provider : "simulation";
  const meta = ROUTE_META[provider];
  if (meta) {
    return {
      id: provider,
      label: meta.label,
      scope: meta.scope,
      sendsExternal: meta.scope === "external",
      costKind: meta.costKind,
      costLabel: meta.costKind === "free-tier" ? "0원(무료 한도 내)" : "0원",
      monthlyKrw: 0,
      costNote: meta.costNote,
      sendNote: meta.sendNote,
      blocked: false
    };
  }

  const config = providerConfig(provider);
  if (!config) {
    // 모르는 provider 값이 저장되어 있어도 0원이라고 단정하지 않는다.
    return {
      id: provider,
      label: "알 수 없는 경로",
      scope: "unknown",
      sendsExternal: null,
      costKind: "unknown",
      costLabel: "확인 필요",
      monthlyKrw: null,
      costNote: "저장된 설정을 알아보지 못했습니다. 모델·보안 설정에서 경로를 다시 고르세요.",
      sendNote: "전송 범위를 확인할 수 없습니다.",
      blocked: false
    };
  }

  const blocked = config.cors === "blocked";
  return {
    id: provider,
    label: config.label,
    scope: "external",
    sendsExternal: true,
    costKind: "own-key",
    costLabel: "제공자 정책 따름",
    monthlyKrw: null,
    costNote: "내가 발급한 키로 쓰는 경로입니다. 요금은 제공자 정책에 따르고 앱은 과금하지 않습니다.",
    sendNote: blocked
      ? "브라우저에서 직접 호출이 막혀 있어, 지금은 질문을 복사해 그 서비스에서 실행하는 방식입니다."
      : "프로젝트 입력란과 일치하는 저장 자료 최대 3건이 외부로 나갑니다.",
    blocked
  };
}

function countWorks(works, projects) {
  const list = Array.isArray(projects) ? projects : [];
  const map = works && typeof works === "object" ? works : {};
  let expenseCount = 0;
  let sessionCount = 0;
  let taskCount = 0;
  let projectsWithWork = 0;
  for (const project of list) {
    const id = project && typeof project.id === "string" ? project.id : "";
    const work = id ? map[id] : null;
    if (!work || typeof work !== "object") continue;
    const expenses = Array.isArray(work.expenses) ? work.expenses.length : 0;
    const sessions = Array.isArray(work.sessions) ? work.sessions.length : 0;
    const tasks = Array.isArray(work.tasks) ? work.tasks.length : 0;
    expenseCount += expenses;
    sessionCount += sessions;
    taskCount += tasks;
    if (expenses || sessions || tasks) projectsWithWork += 1;
  }
  return { projectCount: list.length, projectsWithWork, expenseCount, sessionCount, taskCount };
}

/**
 * 자가진단 한 묶음. 인자로 받은 브라우저 상태만 본다(없으면 0건으로 센다).
 * @param {{ projects?: unknown[], works?: Record<string, unknown>, modelSettings?: unknown, piiMaskEnabled?: boolean, storage?: unknown, quotaBytes?: number, now?: Date|string }} input
 */
export function buildWorkspaceDiagnostics(input = {}) {
  const projects = Array.isArray(input.projects) ? input.projects : [];
  const counts = countWorks(input.works, projects);
  const storage = input.storage || null;
  const entries = storage ? collectStorageEntries(storage) : [];
  const usageStorage = summarizeStorage(entries, input.quotaBytes);
  const secretScan = storage ? scanStorageSecrets(storage) : { total: 0, keys: [], types: [] };
  const route = describeAiRoute(input.modelSettings);
  const piiMaskEnabled = input.piiMaskEnabled !== false;
  const backupStorage = entries.filter((entry) => entry.key.startsWith("planningCopilot"));

  const warnings = [];
  if (usageStorage.level !== "ok") {
    warnings.push(`브라우저 저장 공간을 ${usageStorage.usedPercent}% 썼습니다. 백업 파일을 받아 두고 오래된 사업을 정리하세요.`);
  }
  if (!piiMaskEnabled) {
    warnings.push("개인정보 마스킹이 꺼져 있습니다. 외부 AI로 보내기 전에 켜는 편이 안전합니다.");
  }
  if (secretScan.total > 0) {
    warnings.push(`저장소 ${secretScan.total}곳에서 API 키 모양이 발견됐습니다. 해당 항목을 지우고 키를 다시 발급하세요.`);
  }
  if (route.sendsExternal) {
    warnings.push("지금 고른 경로는 외부 AI로 자료를 보냅니다. 개인정보가 든 문서는 먼저 가리세요.");
  }

  return {
    generatedAt: (input.now ? new Date(input.now) : new Date()).toISOString(),
    usage: { ...counts, storage: usageStorage, backupEntryCount: backupStorage.length },
    security: {
      piiMaskEnabled,
      route,
      secretScan,
      backup: {
        itemLabels: BACKUP_ITEM_LABELS,
        excludedLabels: BACKUP_EXCLUDED_LABELS,
        includesModelSettings: false,
        safe: secretScan.total === 0
      }
    },
    cost: {
      hostingLabel: "GitHub Pages 정적 호스팅",
      hostingMonthlyKrw: 0,
      ai: { label: route.label, costLabel: route.costLabel, monthlyKrw: route.monthlyKrw },
      totalMonthlyKrw: route.monthlyKrw === null ? null : 0,
      note:
        route.monthlyKrw === null
          ? "호스팅은 0원입니다. AI 경로 비용은 제공자 정책에 따라 다르므로 이 화면에서 단정하지 않습니다."
          : "호스팅·AI 모두 앱 쪽 지출은 0원입니다. 계정·도메인·전기료는 포함하지 않았습니다."
    },
    warnings
  };
}
