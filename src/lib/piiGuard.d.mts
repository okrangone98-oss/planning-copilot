export type PiiTypeKey = "rrn" | "card" | "business" | "account" | "phone" | "email" | "address" | "name";

export type PiiTypeInfo = {
  key: PiiTypeKey;
  label: string;
  badge: string;
  token: string;
  priority: number;
};

export type PiiOptions = Partial<Record<PiiTypeKey, boolean>>;

export type PiiFinding = {
  type: PiiTypeKey;
  label: string;
  badge: string;
  start: number;
  end: number;
  preview: string;
  placeholder?: string;
};

export type PiiTypeCount = {
  key: PiiTypeKey;
  label: string;
  badge: string;
  count: number;
};

export type PiiScan = {
  total: number;
  findings: PiiFinding[];
  types: PiiTypeCount[];
  counts: Partial<Record<PiiTypeKey, number>>;
  badgeText: string;
  kinds: number;
};

export type PiiPlaceholder = {
  placeholder: string;
  type: PiiTypeKey;
  label: string;
  preview: string;
};

export type PiiMaskResult = PiiScan & {
  text: string;
  placeholders: PiiPlaceholder[];
  replaced: number;
};

export type PiiRecordResult<T> = {
  value: T;
  report: {
    total: number;
    counts: Partial<Record<PiiTypeKey, number>>;
    types: PiiTypeCount[];
    badgeText: string;
    placeholders: PiiPlaceholder[];
  };
};

export const PII_TYPES: PiiTypeInfo[];
export const DEFAULT_PII_OPTIONS: Record<PiiTypeKey, boolean>;

export function normalizeOptions(options?: PiiOptions | PiiTypeKey[] | null): Record<PiiTypeKey, boolean>;
export function isValidRrn(value: unknown): boolean;
export function isForeignerId(value: unknown): boolean;
export function isValidCardNumber(value: unknown): boolean;
export function isValidBusinessNumber(value: unknown): boolean;
export function maskPreview(type: PiiTypeKey | string, value: string): string;
export function scanPii(text: unknown, options?: PiiOptions | PiiTypeKey[] | null): PiiScan;
export function maskPii(text: unknown, options?: PiiOptions | PiiTypeKey[] | null): PiiMaskResult;
export function maskRecord<T>(input: T, options?: PiiOptions | PiiTypeKey[] | null): PiiRecordResult<T>;
export function describePiiScan(scan: PiiScan | null | undefined): string;
export function hasMaskedTokens(text: unknown): boolean;
