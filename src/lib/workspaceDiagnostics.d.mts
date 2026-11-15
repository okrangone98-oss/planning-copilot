export type StorageEntry = { key: string; bytes: number };

export type StorageUsage = {
  bytes: number;
  kb: number;
  quotaBytes: number;
  quotaKb: number;
  freeKb: number;
  usedRatio: number;
  usedPercent: number;
  entryCount: number;
  level: "ok" | "warn" | "critical";
};

export type SecretType = { id: string; label: string };

export type SecretScan = {
  total: number;
  keys: string[];
  types: SecretType[];
};

export type AiRoute = {
  id: string;
  label: string;
  scope: "none" | "local" | "external" | "unknown";
  sendsExternal: boolean | null;
  costKind: "free" | "free-tier" | "own-key" | "unknown";
  costLabel: string;
  monthlyKrw: number | null;
  costNote: string;
  sendNote: string;
  blocked: boolean;
};

export type WorkspaceDiagnostics = {
  generatedAt: string;
  usage: {
    projectCount: number;
    projectsWithWork: number;
    expenseCount: number;
    sessionCount: number;
    taskCount: number;
    storage: StorageUsage;
    backupEntryCount: number;
  };
  security: {
    piiMaskEnabled: boolean;
    route: AiRoute;
    secretScan: SecretScan;
    backup: {
      itemLabels: string[];
      excludedLabels: string[];
      includesModelSettings: boolean;
      safe: boolean;
    };
  };
  cost: {
    hostingLabel: string;
    hostingMonthlyKrw: number;
    ai: { label: string; costLabel: string; monthlyKrw: number | null };
    totalMonthlyKrw: number | null;
    note: string;
  };
  warnings: string[];
};

export const STORAGE_QUOTA_BYTES: number;
export const STORAGE_WARN_RATIO: number;
export const STORAGE_CRITICAL_RATIO: number;
export const BACKUP_ITEM_LABELS: string[];
export const BACKUP_EXCLUDED_LABELS: string[];
export const SECRET_PATTERNS: Array<{ id: string; label: string; pattern: RegExp }>;

export function collectStorageEntries(storage: unknown): StorageEntry[];
export function findSecretsInText(text: unknown): { total: number; types: SecretType[] };
export function scanStorageSecrets(storage: unknown): SecretScan;
export function summarizeStorage(entries: StorageEntry[] | null | undefined, quotaBytes?: number): StorageUsage;
export function formatStorageSize(kb: number): string;
export function describeAiRoute(modelSettings: unknown): AiRoute;
export function buildWorkspaceDiagnostics(input?: {
  projects?: unknown[];
  works?: Record<string, unknown>;
  modelSettings?: unknown;
  piiMaskEnabled?: boolean;
  storage?: unknown;
  quotaBytes?: number;
  now?: Date | string;
}): WorkspaceDiagnostics;
