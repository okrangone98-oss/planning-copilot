import type { ModelProvider, ModelRunResult, ModelSettings } from "../types";
import { isRemoteOllamaModel, normalizeLoopbackBaseUrl } from "./modelSafety.mjs";

export const defaultModelSettings: ModelSettings = {
  provider: "simulation",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.1"
};

export const modelProviderOptions: Array<{ id: ModelProvider; label: string; description: string }> = [
  { id: "simulation", label: "템플릿 모드", description: "AI 호출 없이 규칙 기반 예시 초안 생성" },
  { id: "ollama", label: "Ollama 로컬", description: "내 컴퓨터에서 모델을 실행해 통합 초안 생성" }
];

export function modelLabel(provider: ModelProvider) {
  return modelProviderOptions.find((item) => item.id === provider)?.label || provider;
}

export function modelSafetyNote(settings: ModelSettings) {
  if (settings.provider === "ollama") return "명령, 관련 프로젝트 입력란, 일치하는 저장 자료 최대 3건만 이 컴퓨터의 Ollama로 보냅니다. 역할 분해는 규칙 기반이며, 최종 보고서만 모델이 생성합니다.";
  return "실제 AI 모델을 호출하지 않습니다. 역할별 결과는 규칙 기반 템플릿입니다.";
}

export async function runModelPrompt(prompt: string, settings: ModelSettings): Promise<ModelRunResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return { provider: settings.provider, ok: false, output: "", error: "실행할 프롬프트가 없습니다." };
  }

  try {
    if (settings.provider === "ollama") return await runOllama(trimmedPrompt, settings);

    return {
      provider: settings.provider,
      ok: true,
      output: `# 템플릿 모드 결과\n\n실제 AI 모델 호출 없이 입력 내용을 기준으로 만든 시뮬레이션입니다.\n\n## 입력 요약\n${trimmedPrompt.slice(0, 700)}`
    };
  } catch (error) {
    return { provider: settings.provider, ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
  }
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
