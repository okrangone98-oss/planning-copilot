import type { ModelProvider, ModelSettings } from "../types";

export function normalizeLoopbackBaseUrl(value: string): string | null;
export function isLoopbackOllamaUrl(value: string): boolean;
export function isRemoteOllamaModel(value: unknown): boolean;

export type RemoteProviderId =
  | "openrouter-free"
  | "groq-free"
  | "gemini-openai"
  | "exaone"
  | "github-models"
  | "amd-tokenlab"
  | "custom-openai";

export type RemoteProviderConfig = {
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  keyPattern: RegExp;
  keyLabel: string;
  cors: "allowed" | "blocked" | "custom";
  corsNote: string;
};

export const REMOTE_PROVIDERS: Record<RemoteProviderId, RemoteProviderConfig>;
export const REMOTE_MODEL_FIELDS: Record<RemoteProviderId, keyof ModelSettings>;
export const MODEL_PROVIDERS: Set<ModelProvider | string>;

export function isRemoteProvider(provider: string): boolean;
export function providerConfig(provider: string): RemoteProviderConfig | null;
export function remoteModelField(provider: string): keyof ModelSettings | null;
export function normalizeProxyBaseUrl(value: string): string | null;
export function isProxyBaseUrl(value: string): boolean;
export function validateApiKey(provider: string, apiKey: string | null | undefined): { ok: boolean; message: string };
export function redactSecrets(text: string): string;
export function normalizeModelName(value: unknown, fallback: string): string;
export function sanitizeModelSettings(saved: unknown, defaults: ModelSettings): ModelSettings;
