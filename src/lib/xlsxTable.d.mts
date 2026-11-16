export type XlsxCell = string;
export type XlsxRows = XlsxCell[][];

export type XlsxWorkbookResult = {
  names: string[];
  index: number;
  name: string;
  rows: XlsxRows;
  warnings: string[];
};

export function columnIndexFromRef(ref: string): number;
export function columnLetter(index: number): string;
export function parseWorkbookSheets(workbookXml: string, relsXml: string): Array<{ name: string; path: string }>;
export function parseSheetRows(sheetXml: string): XlsxRows;
export function readXlsxWorkbook(
  input: ArrayBuffer | Uint8Array | Blob | { arrayBuffer(): Promise<ArrayBuffer> },
  options?: { sheetIndex?: number; maxRows?: number }
): Promise<XlsxWorkbookResult>;
export function readXlsxSheetRows(
  input: ArrayBuffer | Uint8Array | Blob | { arrayBuffer(): Promise<ArrayBuffer> },
  options?: { sheetIndex?: number; maxRows?: number }
): Promise<{ rows: XlsxRows; name: string; names: string[]; warnings: string[] }>;
export function buildXlsxBytes(params?: { sheetName?: string; rows?: XlsxRows }): Promise<Uint8Array>;
export function rowsToCsvText(rows: XlsxRows, options?: { bom?: boolean }): string;
export function rowsToTsvText(rows: XlsxRows): string;
