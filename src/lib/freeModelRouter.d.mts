export type FreeModelRequest = {
  provider: string;
  model?: string;
  prompt: string;
  apiKey?: string;
  baseUrl?: string;
  /** 공용 무료 AI 중계에서 넘길 상위 경로 — auto | openrouter | gemini | amd */
  route?: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
};

export const DEFAULT_SYSTEM_PROMPT: string;

export function resolveEndpoint(provider: string, baseUrl?: string): string;
export function buildChatRequest(input: FreeModelRequest): { provider: string; url: string; init: RequestInit };
export function parseChatCompletion(data: unknown): string;
export function describeHttpFailure(status: number, bodyText: string): string;
export function normalizeModelError(error: unknown): string;
export function requestFreeModel(input: {
  provider: string;
  model?: string;
  prompt: string;
  apiKey?: string;
  baseUrl?: string;
  route?: string;
  systemPrompt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<{ ok: true; output: string; url: string; upstream: string } | { ok: false; error: string }>;
