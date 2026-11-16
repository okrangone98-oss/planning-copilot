const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeLoopbackBaseUrl(value) {
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isLoopbackOllamaUrl(value) {
  return normalizeLoopbackBaseUrl(value) !== null;
}

export function isRemoteOllamaModel(value) {
  if (!value || typeof value !== "object") return false;
  const name = typeof value.name === "string" ? value.name : "";
  return Boolean(value.remote_host || value.remote_model) || /(?:^|[:/-])cloud(?:$|[:/-])/i.test(name);
}

/**
 * 공용 무료 AI 중계(Cloudflare Worker)가 받는 상위 경로.
 * 중계 서버가 이 값을 보고 OpenRouter·Gemini·AMD 무료 경로 중 하나로 넘긴다. `auto`는 되는 경로로 넘긴다.
 */
export const PROXY_ROUTES = ["auto", "openrouter", "gemini", "amd"];
export const PROXY_ROUTE_LABELS = {
  auto: "자동 (되는 무료 경로로)",
  openrouter: "OpenRouter 무료",
  gemini: "Google Gemini 무료",
  amd: "AMD Token Lab 무료"
};

/** 중계에 넘길 상위 경로 값 — 목록에 없는 값은 auto로 되돌린다. */
export function normalizeProxyRoute(value) {
  const route = String(value ?? "").trim().toLowerCase();
  return PROXY_ROUTES.includes(route) ? route : "auto";
}

/**
 * 무료 API 제공자. 주소는 대부분 앱에 고정하고, 로컬 프록시만 사용자가 입력한다.
 * cors 값은 2026-11-15에 실제 프리플라이트(Origin: https://okrangone98-oss.github.io)로 확인한 결과다.
 */
export const REMOTE_PROVIDERS = {
  /**
   * 내 전용 중계. 상위 무료 키는 중계 서버에만 있고, 브라우저는 ‘접속 코드’만 보낸다.
   * 코드는 앱에 넣지 않는다 — 사용자가 이 탭에서 넣고, 저장하지 않는다.
   */
  "team-free-proxy": {
    label: "내 전용 무료 AI (Cloudflare 중계 · 접속 코드 필요)",
    baseUrl: "https://planning-copilot-ai-proxy.okrangone98.workers.dev/v1",
    defaultModel: "",
    models: [],
    keyPattern: /^[A-Za-z0-9._~-]{8,}$/,
    requiresKey: true,
    keyLabel: "접속 코드(공백 없이 8자 이상 · 이 탭 메모리에만)",
    cors: "allowed",
    corsNote:
      "내 Cloudflare 중계로 보냅니다. 접속 코드를 넣어야 호출되며, 코드는 이 탭 메모리에만 있고 저장·백업되지 않습니다. 상위 무료 경로의 키는 중계 서버에만 있습니다."
  },
  "openrouter-free": {
    label: "OpenRouter Free",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    models: ["openrouter/free", "google/gemma-4-31b-it:free"],
    keyPattern: /^sk-or-[A-Za-z0-9-]{10,}$/,
    keyLabel: "OpenRouter 키(sk-or-로 시작)",
    cors: "allowed",
    corsNote: "브라우저 직접 호출 가능(2026-11-15 확인: access-control-allow-origin: *). 무료 모델만 쓰세요."
  },
  "groq-free": {
    label: "Groq 무료 티어",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    models: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "llama-3.3-70b-versatile"],
    keyPattern: /^gsk_[A-Za-z0-9]{10,}$/,
    keyLabel: "Groq 키(gsk_로 시작)",
    cors: "allowed",
    corsNote: "브라우저 직접 호출 가능(2026-11-15 확인: access-control-allow-origin: *). 모델 목록은 계정 상황에 따라 다를 수 있습니다."
  },
  "gemini-openai": {
    label: "Google Gemini 무료(OpenAI 호환)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
    // Google AI Studio는 2026년부터 `AQ.`로 시작하는 새 형식 키를 발급한다. 구형식(`AIza…`)도 계속 받는다.
    keyPattern: /^(?:AIza[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9._-]{20,})$/,
    keyLabel: "Google AI Studio 키(AIza 또는 AQ.로 시작)",
    cors: "allowed",
    corsNote: "브라우저 직접 호출 가능(2026-11-15 확인: 요청 Origin을 그대로 허용). 무료 한도는 모델별로 다릅니다."
  },
  exaone: {
    label: "LG K-EXAONE 2.5",
    baseUrl: "https://api.exaone.ai/v1",
    defaultModel: "k-exaone_v2.5",
    models: ["k-exaone_v2.5"],
    keyPattern: /^[A-Za-z0-9._~-]{8,}$/,
    keyLabel: "EXAONE API 키",
    cors: "blocked",
    corsNote: "브라우저 직접 호출은 차단됩니다(2026-11-15 확인: OPTIONS 401, CORS 헤더 없음). 실패하면 로컬 프록시나 질문 복사 흐름을 쓰세요."
  },
  "github-models": {
    label: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    defaultModel: "openai/gpt-4.1-mini",
    models: ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "meta/Llama-4-Scout-17B-16E-Instruct"],
    keyPattern: /^(ghp_|github_pat_)[A-Za-z0-9_]{10,}$/,
    keyLabel: "GitHub 토큰(ghp_ 또는 github_pat_, models:read 권한)",
    cors: "blocked",
    corsNote: "브라우저 직접 호출은 차단됩니다(2026-11-15 확인: CORS 허용 헤더 없음). 실패하면 로컬 프록시나 질문 복사 흐름을 쓰세요."
  },
  "amd-tokenlab": {
    label: "AMD Token Lab",
    baseUrl: "https://api.tokenlab.amd.com/v1",
    defaultModel: "Gemma-4-31B-IT",
    models: ["Gemma-4-31B-IT", "Qwen3.8-27B", "DeepSeek-V4.1-Flash", "DeepSeek-V4-Flash", "MiniCPM5-2B"],
    keyPattern: /^tl-[A-Za-z0-9]{16,}$/,
    keyLabel: "AMD Token Lab 키(tl-로 시작)",
    cors: "blocked",
    corsNote: "브라우저 직접 호출은 차단됩니다(2026-11-15 확인: OPTIONS 403, CORS 헤더 없음). 실패하면 로컬 프록시나 질문 복사 흐름을 쓰세요."
  },
  "custom-openai": {
    label: "로컬 프록시(OpenAI 호환)",
    baseUrl: "",
    defaultModel: "",
    models: [],
    keyPattern: /^[A-Za-z0-9._~:-]{8,}$/,
    keyLabel: "프록시가 요구하는 키(없으면 비워 둘 수 있음)",
    cors: "custom",
    corsNote: "내 컴퓨터·사내망에서 도는 프록시(Hermes, 로컬 서버 등)로 보냅니다. 공용 인터넷 주소는 받지 않습니다. 주소와 모델을 직접 입력하세요."
  }
};

/** 설정에 저장해도 되는 모델 이름 필드. 키는 저장하지 않는다. */
export const REMOTE_MODEL_FIELDS = {
  "team-free-proxy": "proxyModel",
  "openrouter-free": "openrouterModel",
  "groq-free": "groqModel",
  "gemini-openai": "geminiModel",
  exaone: "exaoneModel",
  "github-models": "githubModel",
  "amd-tokenlab": "amdModel",
  "custom-openai": "customModel"
};

export const MODEL_PROVIDERS = new Set(["simulation", "ollama", ...Object.keys(REMOTE_PROVIDERS)]);

/**
 * 모델 설정 화면의 기본 노출 순서. 브라우저에서 바로 호출되는 무료 경로만 먼저 보여준다.
 * 차단·로컬 설치는 '고급 / 로컬 연결' 접이식 영역으로 내린다.
 */
export const PRIMARY_MODEL_PROVIDERS = ["team-free-proxy", "simulation", "openrouter-free", "groq-free", "gemini-openai"];
export const ADVANCED_MODEL_PROVIDERS = ["exaone", "github-models", "amd-tokenlab", "custom-openai", "ollama"];

export function isAdvancedModelProvider(provider) {
  return ADVANCED_MODEL_PROVIDERS.includes(provider);
}

export function isRemoteProvider(provider) {
  return Object.prototype.hasOwnProperty.call(REMOTE_PROVIDERS, provider);
}

export function providerConfig(provider) {
  return isRemoteProvider(provider) ? REMOTE_PROVIDERS[provider] : null;
}

/** 기본 노출 카드에 붙는 짧은 상태 표시. */
export function providerAvailabilityNote(provider) {
  if (provider === "team-free-proxy") return "접속 코드 필요 · 내 전용 중계";
  if (provider === "simulation") return "키 없이 바로 사용";
  if (provider === "ollama") return "내 컴퓨터에 설치 필요";
  const config = providerConfig(provider);
  if (!config) return "";
  if (config.cors === "allowed") return "브라우저 직접 호출 가능";
  if (config.cors === "blocked") return "브라우저 호출 차단 · 프록시/복붙 필요";
  return "주소 직접 입력";
}

export function remoteModelField(provider) {
  return Object.prototype.hasOwnProperty.call(REMOTE_MODEL_FIELDS, provider) ? REMOTE_MODEL_FIELDS[provider] : null;
}

/**
 * 로컬 프록시 주소만 허용한다: loopback 또는 사설 IPv4(http/https), 자격증명·쿼리 금지.
 * 공용 인터넷 주소를 열어 두면 입력한 키가 임의 서버로 나갈 수 있다.
 */
export function normalizeProxyBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(host);
    if (!LOOPBACK_HOSTS.has(host) && !privateIpv4) return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

export function isProxyBaseUrl(value) {
  return normalizeProxyBaseUrl(value) !== null;
}

/** 키를 넣지 않아도 되는 경로인지 — 공용 중계가 그렇다. */
export function providerRequiresKey(provider) {
  const config = providerConfig(provider);
  return config ? config.requiresKey !== false : false;
}

/**
 * 실행 전에 ‘외부로 보낸다’를 사용자가 확인해야 하는 경로인지.
 * 무료 API·내 전용 중계처럼 자료가 밖으로 나가는 경로는 모두 확인을 받는다.
 */
export function providerNeedsExternalAck(provider) {
  return providerRequiresKey(provider);
}

/** 키 형식만 확인한다. 실제 유효성은 호출 응답으로만 확인할 수 있다. */
export function validateApiKey(provider, apiKey) {
  const config = providerConfig(provider);
  if (!config) return { ok: false, message: "무료 API 제공자가 선택되지 않았습니다." };
  // 공용 중계처럼 키가 필요 없는 경로는 빈 값이 정상이다.
  if (config.requiresKey === false) return { ok: true, message: "" };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) {
    if (provider === "custom-openai") return { ok: true, message: "" };
    return { ok: false, message: `${config.keyLabel}를 입력해 주세요.` };
  }
  if (!config.keyPattern.test(key)) return { ok: false, message: `키 형식이 맞지 않습니다. ${config.keyLabel}를 확인해 주세요.` };
  return { ok: true, message: "" };
}

/** 오류 메시지·본문에 키가 섞여 나와도 화면과 저장소에 남기지 않는다. */
export function redactSecrets(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/tl-[A-Za-z0-9]{8,}/g, "tl-***")
    .replace(/sk-or-[A-Za-z0-9-]{6,}/g, "sk-or-***")
    .replace(/gsk_[A-Za-z0-9]{6,}/g, "gsk_***")
    .replace(/AIza[A-Za-z0-9_-]{10,}/g, "AIza***")
    .replace(/AQ\.[A-Za-z0-9._-]{10,}/g, "AQ.***")
    .replace(/(ghp_|github_pat_)[A-Za-z0-9_]{6,}/g, "$1***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{6,}/gi, "Bearer ***")
    .replace(/api[_-]?key"[^,}]{0,80}/gi, 'api_key":"***"');
}

/** 모델 이름은 저장해도 되는 값이지만, 길이와 문자만 제한한다. */
export function normalizeModelName(value, fallback) {
  if (typeof value !== "string") return fallback;
  const name = value.trim();
  if (!name || name.length > 80) return fallback;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/.test(name)) return fallback;
  return name;
}

export function sanitizeModelSettings(saved, defaults) {
  const value = saved && typeof saved === "object" ? saved : {};
  // 저장된 경로가 없거나 모르는 값이면 ‘앱의 기본 경로’로 돌아간다(예전처럼 템플릿 모드로 고정하지 않는다).
  const fallbackProvider = MODEL_PROVIDERS.has(defaults?.provider) ? defaults.provider : "simulation";
  const provider = MODEL_PROVIDERS.has(value.provider) ? value.provider : fallbackProvider;
  const settings = {
    provider,
    ollamaBaseUrl: normalizeLoopbackBaseUrl(value.ollamaBaseUrl) || defaults.ollamaBaseUrl,
    ollamaModel: typeof value.ollamaModel === "string" && value.ollamaModel.trim()
      ? value.ollamaModel.trim()
      : defaults.ollamaModel,
    customBaseUrl: normalizeProxyBaseUrl(value.customBaseUrl) || "",
    proxyRoute: normalizeProxyRoute(value.proxyRoute ?? defaults.proxyRoute ?? "auto")
  };
  Object.values(REMOTE_MODEL_FIELDS).forEach((field) => {
    settings[field] = normalizeModelName(value[field], defaults[field] ?? "");
  });
  return settings;
}
