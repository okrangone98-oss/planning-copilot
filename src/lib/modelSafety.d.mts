export function normalizeLoopbackBaseUrl(value: string): string | null;
export function isLoopbackOllamaUrl(value: string): boolean;
export function isRemoteOllamaModel(value: unknown): boolean;
export function sanitizeModelSettings(
  saved: unknown,
  defaults: { provider: "simulation" | "ollama"; ollamaBaseUrl: string; ollamaModel: string }
): { provider: "simulation" | "ollama"; ollamaBaseUrl: string; ollamaModel: string };
