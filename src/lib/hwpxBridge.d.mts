export type KordocPreset = { id: string; label: string; hint: string };

export type BridgePayload = {
  format: "hwpx";
  engine: string;
  preset: string;
  org: string;
  fileName: string;
  markdown: string;
};

export type BridgeResult = {
  ok: boolean;
  message: string;
  fileName?: string;
  base64?: string;
  downloadUrl?: string;
  warnings?: string[];
};

export const KORDOC_PACKAGE: string;
export const KORDOC_DOCS_URL: string;
export const HWPX_BRIDGE_HINT: string;
export const KORDOC_PRESETS: KordocPreset[];
export const BRIDGE_CONTRACT: string[];

export function sanitizeBaseName(value: string, fallback?: string): string;
export function buildHwpxFileName(value: string, fallback?: string): string;
export function buildKordocCommand(options?: { fileName?: string; preset?: string; org?: string }): string;
export function buildBridgePayload(options?: {
  markdown?: string;
  fileName?: string;
  preset?: string;
  org?: string;
}): BridgePayload | null;
export function normalizeBridgeEndpoint(value: string): { ok: boolean; url: string; error: string };
export function interpretBridgeResponse(status: number, body: Record<string, unknown> | null): BridgeResult;
