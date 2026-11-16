import type { ModelProvider, ModelRunResult, ModelSettings } from "../types";
import { isRemoteOllamaModel, normalizeLoopbackBaseUrl, normalizeProxyRoute, PROXY_ROUTE_LABELS, providerConfig, remoteModelField, validateApiKey } from "./modelSafety.mjs";
import { requestFreeModel } from "./freeModelRouter.mjs";

export const defaultModelSettings: ModelSettings = {
  // 기본값은 내 전용 무료 AI(중계) 경로다. 접속 코드를 넣어야 호출되고, 템플릿 모드·개인 키 경로도 그대로 고를 수 있다.
  provider: "team-free-proxy",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.1",
  proxyRoute: "auto",
  proxyModel: "",
  openrouterModel: "openrouter/free",
  groqModel: "openai/gpt-oss-120b",
  geminiModel: "gemini-2.5-flash",
  exaoneModel: "k-exaone_v2.5",
  githubModel: "openai/gpt-4.1-mini",
  amdModel: "Gemma-4-31B-IT",
  customModel: "",
  customBaseUrl: ""
};

export const modelProviderOptions: Array<{ id: ModelProvider; label: string; description: string }> = [
  { id: "team-free-proxy", label: "내 전용 무료 AI", description: "Cloudflare 중계 · 접속 코드 필요 · 내 무료 경로만 사용" },
  { id: "simulation", label: "템플릿 모드", description: "AI 호출 없이 규칙 기반 예시 초안 생성" },
  { id: "ollama", label: "Ollama 로컬", description: "내 컴퓨터에서 모델을 실행해 통합 초안 생성" },
  { id: "openrouter-free", label: "OpenRouter Free", description: "브라우저 호출 가능 · openrouter/free 같은 무료 모델" },
  { id: "groq-free", label: "Groq 무료 티어", description: "브라우저 호출 가능 · gpt-oss·Qwen 무료 모델" },
  { id: "gemini-openai", label: "Gemini 무료(OpenAI 호환)", description: "브라우저 호출 가능 · Google AI Studio 키" },
  { id: "exaone", label: "LG K-EXAONE 2.5", description: "CORS 차단 · 실패하면 프록시나 질문 복사 흐름" },
  { id: "github-models", label: "GitHub Models", description: "CORS 차단 · GitHub 토큰(models:read) 필요" },
  { id: "amd-tokenlab", label: "AMD Token Lab", description: "CORS 차단 · 발급받은 tl- 키 사용" },
  { id: "custom-openai", label: "로컬 프록시(OpenAI 호환)", description: "내 컴퓨터·사설망 프록시로 중계" }
];

export function modelLabel(provider: ModelProvider) {
  return modelProviderOptions.find((item) => item.id === provider)?.label || provider;
}

export function currentModelName(settings: ModelSettings) {
  if (settings.provider === "ollama") return settings.ollamaModel.trim();
  if (settings.provider === "team-free-proxy") {
    const route = normalizeProxyRoute(settings.proxyRoute);
    const custom = String(settings.proxyModel || "").trim();
    return custom ? `${PROXY_ROUTE_LABELS[route]} · ${custom}` : PROXY_ROUTE_LABELS[route];
  }
  const field = remoteModelField(settings.provider);
  if (field) return String(settings[field] || "").trim();
  return "템플릿";
}

export function modelSafetyNote(settings: ModelSettings) {
  if (settings.provider === "team-free-proxy") {
    return "가린 프롬프트가 내 Cloudflare 중계를 거쳐 무료 AI 제공자(OpenRouter·Gemini·AMD)로 전달됩니다. 중계는 접속 코드를 확인한 뒤 자기 키로 부르고, 그 키는 브라우저로 오지 않습니다. 개인정보 마스킹을 켜 두면 이름·연락처는 [성명_1]·[연락처_1]로 바뀐 채 나갑니다.";
  }
  if (settings.provider === "ollama") return "명령, 관련 프로젝트 입력란, 일치하는 저장 자료 최대 3건만 이 컴퓨터의 Ollama로 보냅니다. 역할 분해는 규칙 기반이며, 최종 보고서만 모델이 생성합니다.";
  const config = providerConfig(settings.provider);
  if (config) return `프로젝트 입력란과 일치하는 저장 자료 최대 3건이 ${config.label}로 전송됩니다. 키는 브라우저 메모리에만 있고 저장·백업되지 않습니다. ${config.corsNote}`;
  return "실제 AI 모델을 호출하지 않습니다. 역할별 결과는 규칙 기반 템플릿입니다.";
}

export async function runModelPrompt(
  prompt: string,
  settings: ModelSettings,
  options: { apiKey?: string; maxTokens?: number } = {}
): Promise<ModelRunResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return { provider: settings.provider, ok: false, output: "", error: "실행할 프롬프트가 없습니다." };
  }

  try {
    if (settings.provider === "ollama") return await runOllama(trimmedPrompt, settings);

    const config = providerConfig(settings.provider);
    if (config) {
      const apiKey = options.apiKey || "";
      const keyCheck = validateApiKey(settings.provider, apiKey);
      if (!keyCheck.ok) return { provider: settings.provider, ok: false, output: "", error: keyCheck.message };
      const result = await requestFreeModel({
        provider: settings.provider,
        model: modelRequestName(settings),
        prompt: trimmedPrompt,
        apiKey,
        baseUrl: settings.customBaseUrl,
        route: normalizeProxyRoute(settings.proxyRoute),
        maxTokens: options.maxTokens
      });
      return result.ok
        ? { provider: settings.provider, ok: true, output: result.output, upstream: result.upstream || "" }
        : { provider: settings.provider, ok: false, output: "", error: result.error };
    }

    return {
      provider: settings.provider,
      ok: true,
      output: `# 템플릿 모드 결과\n\n실제 AI 모델 호출 없이 입력 내용을 기준으로 만든 시뮬레이션입니다.\n\n## 입력 요약\n${trimmedPrompt.slice(0, 700)}`
    };
  } catch (error) {
    return { provider: settings.provider, ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 요청 본문에 넣을 모델 이름. 공용 중계는 비워 두면 중계가 경로별 기본 모델을 고르므로,
 * 화면에 보여 주는 ‘자동 (되는 무료 경로로)’ 같은 설명 문구를 모델 이름으로 보내지 않는다.
 */
function modelRequestName(settings: ModelSettings) {
  if (settings.provider === "team-free-proxy") return String(settings.proxyModel || "").trim();
  return currentModelName(settings);
}

async function runOllama(prompt: string, settings: ModelSettings): Promise<ModelRunResult> {
  const baseUrl = normalizeLoopbackBaseUrl(settings.ollamaBaseUrl);
  if (!baseUrl) throw new Error("Ollama 주소는 이 컴퓨터의 localhost, 127.0.0.1 또는 ::1만 사용할 수 있습니다.");
  const model = settings.ollamaModel.trim();
  if (!model) throw new Error("Ollama 모델 이름을 입력해 주세요.");
  if (isRemoteOllamaModel({ name: model })) throw new Error("클라우드 모델은 사용할 수 없습니다. 설치된 로컬 모델을 선택해 주세요.");

  // localhost도 클라우드 모델을 중계할 수 있으므로, 업무 자료를 보내기 전에 모델 정보만 확인한다.
  const infoResponse = await fetchOllama(`${baseUrl}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model })
  }, 10000);
  if (!infoResponse.ok) throw new Error(`Ollama 모델 확인 실패: ${infoResponse.status}. 설치된 모델 이름을 확인해 주세요.`);
  const modelInfo = await infoResponse.json();
  if (isRemoteOllamaModel({ ...modelInfo, name: model })) throw new Error("원격 모델은 사용할 수 없습니다. 로컬에 다운로드한 모델을 선택해 주세요.");
  if (!modelInfo || typeof modelInfo !== "object" || (!modelInfo.details && !modelInfo.model_info)) {
    throw new Error("로컬 모델 정보를 확인할 수 없어 자료를 보내지 않았습니다.");
  }

  const response = await fetchOllama(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        { role: "system", content: "당신은 한국어로 일하는 로컬기획 AI 사무국 실무자입니다. 민감정보를 요구하지 말고, 실행 가능한 체크리스트로 답하세요." },
        { role: "user", content: prompt }
      ]
    })
  }, 180000);

  if (!response.ok) throw new Error(`Ollama 연결 실패: ${response.status}`);
  const data = await response.json();
  const output = data.message?.content || data.response || "";
  if (typeof output !== "string" || !output.trim()) throw new Error("Ollama 응답이 비어 있습니다.");
  return { provider: "ollama", ok: true, output };
}

export async function listOllamaModels(settings: ModelSettings): Promise<string[]> {
  const baseUrl = normalizeLoopbackBaseUrl(settings.ollamaBaseUrl);
  if (!baseUrl) throw new Error("Ollama 주소는 이 컴퓨터의 localhost, 127.0.0.1 또는 ::1만 사용할 수 있습니다.");
  const response = await fetchOllama(`${baseUrl}/api/tags`, {}, 10000);
  if (!response.ok) throw new Error(`Ollama 모델 목록을 가져오지 못했습니다: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.models)
    ? data.models.filter((model: unknown) => model && typeof model === "object" && !isRemoteOllamaModel(model))
      .map((model: { name?: unknown }) => model.name).filter((name: unknown): name is string => typeof name === "string")
    : [];
}

async function fetchOllama(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Ollama 응답 시간이 초과되었습니다. 모델 상태를 확인한 뒤 다시 실행해 주세요.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
