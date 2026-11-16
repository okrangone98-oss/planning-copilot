import type { ModelProvider, ModelSettings } from "../types";

export function normalizeLoopbackBaseUrl(value: string): string | null;
export function isLoopbackOllamaUrl(value: string): boolean;
export function isRemoteOllamaModel(value: unknown): boolean;

export type RemoteProviderId =
  | "team-free-proxy"
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
  /** 키를 넣지 않아도 되는 경로면 false (공용 무료 AI 중계) */
  requiresKey?: boolean;
  keyLabel: string;
  cors: "allowed" | "blocked" | "custom";
  corsNote: string;
};

export const REMOTE_PROVIDERS: Record<RemoteProviderId, RemoteProviderConfig>;
export const REMOTE_MODEL_FIELDS: Record<RemoteProviderId, keyof ModelSettings>;
export const MODEL_PROVIDERS: Set<ModelProvider | string>;
export const PRIMARY_MODEL_PROVIDERS: string[];
export const ADVANCED_MODEL_PROVIDERS: string[];

export function isAdvancedModelProvider(provider: string): boolean;
export function providerAvailabilityNote(provider: string): string;
export const PROXY_ROUTES: string[];
export const PROXY_ROUTE_LABELS: Record<string, string>;
export function normalizeProxyRoute(value: unknown): string;
export function providerRequiresKey(provider: string): boolean;
export function providerNeedsExternalAck(provider: string): boolean;

export function isRemoteProvider(provider: string): boolean;
export function providerConfig(provider: string): RemoteProviderConfig | null;
export function remoteModelField(provider: string): keyof ModelSettings | null;
export function normalizeProxyBaseUrl(value: string): string | null;
export function isProxyBaseUrl(value: string): boolean;
export function validateApiKey(provider: string, apiKey: string | null | undefined): { ok: boolean; message: string };
export function redactSecrets(text: string): string;
export function normalizeModelName(value: unknown, fallback: string): string;
export function sanitizeModelSettings(saved: unknown, defaults: ModelSettings): ModelSettings;
