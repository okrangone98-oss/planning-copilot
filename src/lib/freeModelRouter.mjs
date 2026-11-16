// 무료 API(OpenAI 호환) 직접 호출. 주소는 앱에 고정된 값이나 로컬 프록시만 쓰고, 키는 호출 때만 메모리에서 넘어온다.

import { isRemoteProvider, normalizeProxyBaseUrl, normalizeProxyRoute, providerConfig, redactSecrets, validateApiKey } from "./modelSafety.mjs";

export const DEFAULT_SYSTEM_PROMPT =
  "당신은 한국어로 일하는 사무국 실무자입니다. 입력 자료에 없는 사실을 단정하지 말고, 확인이 필요한 부분은 확인 필요로 표시하세요. 개인정보를 요구하지 말고, 실행 가능한 체크리스트와 표로 답하세요.";

/** 제공자와 (프록시일 때) 사용자 주소로 실제 요청 주소를 만든다. */
export function resolveEndpoint(provider, baseUrl) {
  const config = providerConfig(provider);
  if (!config) throw new Error("무료 API 제공자가 선택되지 않았습니다.");
  if (provider === "custom-openai") {
    const base = normalizeProxyBaseUrl(baseUrl);
    if (!base) throw new Error("프록시 주소는 내 컴퓨터(127.0.0.1, localhost)나 사설망(http://192.168.x.x 등) 주소만 사용할 수 있습니다.");
    return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
  }
  return `${config.baseUrl}/chat/completions`;
}

export function buildChatRequest({ provider, model, prompt, apiKey, baseUrl, route, systemPrompt, maxTokens = 2000, temperature = 0.3 }) {
  const config = providerConfig(provider);
  if (!config) throw new Error("무료 API 제공자가 선택되지 않았습니다.");
  const keyCheck = validateApiKey(provider, apiKey);
  if (!keyCheck.ok) throw new Error(keyCheck.message);
  const resolvedModel = String(model || config.defaultModel || "").trim();
  // 공용 중계는 모델을 비워 두면 중계가 경로별 기본 모델을 고른다.
  if (!resolvedModel && provider !== "team-free-proxy") throw new Error("모델 이름을 입력해 주세요.");

  const body = {
    model: resolvedModel,
    messages: [
      { role: "system", content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
      { role: "user", content: String(prompt || "") }
    ],
    temperature,
    max_tokens: maxTokens,
    stream: false
  };
  if (provider === "team-free-proxy") {
    // 중계가 이 값으로 상위 무료 경로를 고른다. 모델을 비워 두면 필드 자체를 보내지 않는다.
    body.provider = normalizeProxyRoute(route);
    if (!resolvedModel) delete body.model;
  }
  const headers = { "Content-Type": "application/json" };
  const key = String(apiKey || "").trim();
  // 내 전용 중계는 이 값이 ‘접속 코드’다. 중계 서버가 이 코드를 확인한 뒤 자기 키로 상위 경로를 부른다.
  if (key) headers.Authorization = `Bearer ${key}`;
  if (provider === "openrouter-free") headers["X-Title"] = "Planning Copilot";

  return {
    provider,
    url: resolveEndpoint(provider, baseUrl),
    init: { method: "POST", headers, body: JSON.stringify(body) }
  };
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function parseChatCompletion(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const text = contentToText(choice?.message?.content) || contentToText(choice?.text);
  if (!text.trim()) {
    // 무료 추론 모델은 생각만 하다가 본문 없이 끊길 때가 있다 — 그 사실을 그대로 알려 준다.
    const thinking = contentToText(choice?.message?.reasoning) || contentToText(choice?.message?.reasoning_content);
    if (thinking.trim()) throw new Error("모델이 본문 없이 생각만 하다가 끝났습니다. 다시 실행하거나 다른 무료 경로를 골라 주세요.");
    throw new Error("모델 응답이 비어 있습니다. 모델 이름과 입력 길이를 확인해 주세요.");
  }
  return text.trim();
}

export function describeHttpFailure(status, bodyText) {
  const excerpt = redactSecrets(String(bodyText || "").replace(/\s+/g, " ").slice(0, 300));
  if (status === 401 || status === 403) return `키가 거부되었거나 접근이 막혔습니다(${status}). 키·권한을 확인해 주세요.${excerpt ? ` · ${excerpt}` : ""}`;
  if (status === 404) return `요청 주소나 모델 이름을 찾지 못했습니다(404). 모델 이름을 확인해 주세요.${excerpt ? ` · ${excerpt}` : ""}`;
  if (status === 429) return `호출 한도를 넘었습니다(429). 잠시 뒤 다시 실행하거나 다른 제공자를 선택해 주세요.${excerpt ? ` · ${excerpt}` : ""}`;
  if (status >= 500) return `제공자 서버 오류입니다(${status}). 잠시 뒤 다시 시도해 주세요.${excerpt ? ` · ${excerpt}` : ""}`;
  return `요청이 실패했습니다(${status}).${excerpt ? ` · ${excerpt}` : ""}`;
}

export function normalizeModelError(error) {
  const name = typeof error?.name === "string" ? error.name : "";
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (name === "AbortError") return "응답 시간이 초과되었습니다. 잠시 뒤 다시 실행해 주세요.";
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(raw)) {
    return "브라우저가 이 API로의 직접 요청을 막았습니다(CORS 또는 네트워크 차단). 키가 틀린 것은 아닐 수 있습니다. 로컬 프록시를 쓰거나 질문 복사 흐름으로 이어서 진행해 주세요.";
  }
  return redactSecrets(raw) || "모델 호출에 실패했습니다.";
}

export async function requestFreeModel({
  provider,
  model,
  prompt,
  apiKey,
  baseUrl,
  route,
  systemPrompt,
  fetchImpl,
  timeoutMs = 90000,
  maxTokens = 2000
}) {
  if (!isRemoteProvider(provider)) throw new Error("무료 API 제공자가 선택되지 않았습니다.");
  const { url, init } = buildChatRequest({ provider, model, prompt, apiKey, baseUrl, route, systemPrompt, maxTokens });

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) throw new Error("이 환경에서는 외부 API를 호출할 수 없습니다.");

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await doFetch(url, controller ? { ...init, signal: controller.signal } : init);
    if (!response.ok) {
      const body = typeof response.text === "function" ? await response.text().catch(() => "") : "";
      // 중계가 접속 코드를 거부한 경우는 ‘키 오류’가 아니라 코드 문제라고 알려 준다.
      if (provider === "team-free-proxy" && (response.status === 401 || response.status === 403)) {
        throw new Error(`접속 코드가 맞지 않아 중계가 거부했습니다(${response.status}). 모델·보안 설정에서 접속 코드를 다시 확인해 주세요.`);
      }
      throw new Error(describeHttpFailure(response.status, body));
    }
    const data = await response.json();
    // 중계는 어느 상위 경로가 답했는지 헤더로 알려 준다(브라우저에서 읽을 수 있게 열어 둠).
    const upstream = typeof response.headers?.get === "function" ? String(response.headers.get("x-proxy-provider") || "") : "";
    return { ok: true, output: parseChatCompletion(data), url, upstream };
  } catch (error) {
    return { ok: false, error: normalizeModelError(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
