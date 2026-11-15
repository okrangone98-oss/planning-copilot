export type FreeModelRequest = {
  provider: string;
  model?: string;
  prompt: string;
  apiKey?: string;
  baseUrl?: string;
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
  systemPrompt?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<{ ok: true; output: string; url: string } | { ok: false; error: string }>;
