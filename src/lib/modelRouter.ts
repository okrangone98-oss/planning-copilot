import type { ModelProvider, ModelRunResult, ModelSettings } from "../types";

export const defaultModelSettings: ModelSettings = {
  provider: "simulation",
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "llama3.1",
  geminiApiKey: "",
  geminiModel: "gemini-1.5-flash",
  githubToken: "",
  githubModel: "openai/gpt-4o-mini"
};

export const modelProviderOptions: Array<{ id: ModelProvider; label: string; description: string }> = [
  { id: "simulation", label: "시뮬레이션", description: "API 없이 템플릿으로 빠르게 초안 생성" },
  { id: "ollama", label: "Ollama 로컬", description: "민감자료와 내부 문서 초안에 적합" },
  { id: "gemini", label: "Gemini 무료 API", description: "공개 가능한 리서치/요약/콘텐츠 초안에 적합" },
  { id: "github-models", label: "GitHub Models", description: "개발/코드/프롬프트 실험에 적합" },
  { id: "manual-gpt", label: "수동 GPT", description: "유료 GPT/Claude에 복사할 질문 패키지 생성" }
];

export function modelLabel(provider: ModelProvider) {
  return modelProviderOptions.find((item) => item.id === provider)?.label || provider;
}

export function modelSafetyNote(settings: ModelSettings) {
  if (settings.provider === "ollama") return "로컬 실행 권장: 민감자료 처리 가능성이 가장 높습니다.";
  if (settings.provider === "gemini") return "공개 가능한 자료만 사용하세요. API 키는 브라우저 localStorage에만 저장됩니다.";
  if (settings.provider === "github-models") return "개발/프롬프트 실험용으로 사용하고 개인정보는 제외하세요.";
  if (settings.provider === "manual-gpt") return "질문을 복사해 외부 AI에 직접 붙여넣는 안전한 수동 흐름입니다.";
  return "API 없이 동작하는 기본 모드입니다.";
}

export async function runModelPrompt(prompt: string, settings: ModelSettings): Promise<ModelRunResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return { provider: settings.provider, ok: false, output: "", error: "실행할 프롬프트가 없습니다." };
  }

  try {
    if (settings.provider === "ollama") return await runOllama(trimmedPrompt, settings);
    if (settings.provider === "gemini") return await runGemini(trimmedPrompt, settings);
    if (settings.provider === "github-models") return await runGithubModels(trimmedPrompt, settings);
    if (settings.provider === "manual-gpt") {
      return { provider: settings.provider, ok: true, output: `아래 질문을 유료 GPT/Claude에 복사하세요.\n\n${trimmedPrompt}` };
    }

    return {
      provider: settings.provider,
      ok: true,
      output: `# 시뮬레이션 응답\n\n선택 모델: ${modelLabel(settings.provider)}\n\n## 핵심 요약\n- 입력한 프롬프트를 실무 검토용으로 정리했습니다.\n- 실제 API 연결 전에도 승인함과 프로젝트 기억 흐름을 테스트할 수 있습니다.\n\n## 다음 액션\n- [ ] 민감정보 제거\n- [ ] 모델 설정 확인\n- [ ] 승인함에 저장 후 상태 관리\n\n## 원문 앞부분\n${trimmedPrompt.slice(0, 700)}`
    };
  } catch (error) {
    return { provider: settings.provider, ok: false, output: "", error: String(error) };
  }
}

async function runOllama(prompt: string, settings: ModelSettings): Promise<ModelRunResult> {
  const response = await fetch(`${settings.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.ollamaModel || defaultModelSettings.ollamaModel,
      stream: false,
      messages: [
        { role: "system", content: "당신은 한국어로 일하는 로컬기획 AI 사무국 실무자입니다. 민감정보를 요구하지 말고, 실행 가능한 체크리스트로 답하세요." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`Ollama 연결 실패: ${response.status}`);
  const data = await response.json();
  return { provider: "ollama", ok: true, output: data.message?.content || data.response || "응답이 비어 있습니다." };
}

async function runGemini(prompt: string, settings: ModelSettings): Promise<ModelRunResult> {
  if (!settings.geminiApiKey.trim()) throw new Error("Gemini API 키가 없습니다.");
  const model = settings.geminiModel || defaultModelSettings.geminiModel;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  if (!response.ok) throw new Error(`Gemini 연결 실패: ${response.status}`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("\n") || "응답이 비어 있습니다.";
  return { provider: "gemini", ok: true, output: text };
}

async function runGithubModels(prompt: string, settings: ModelSettings): Promise<ModelRunResult> {
  if (!settings.githubToken.trim()) throw new Error("GitHub Models 토큰이 없습니다.");
  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.githubToken}`
    },
    body: JSON.stringify({
      model: settings.githubModel || defaultModelSettings.githubModel,
      messages: [
        { role: "system", content: "한국어로 간결하게 답하는 개발/기획 검토자입니다." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`GitHub Models 연결 실패: ${response.status}`);
  const data = await response.json();
  return { provider: "github-models", ok: true, output: data.choices?.[0]?.message?.content || "응답이 비어 있습니다." };
}
