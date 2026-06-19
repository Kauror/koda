import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import * as XLSX from "xlsx";

/**
 * Path recorded in generated manifests. Relative to cwd (with forward slashes)
 * so the bundle is deterministic across machines and never embeds absolute
 * local/server paths.
 */
function manifestPath(absolutePath: string): string {
  return relative(process.cwd(), absolutePath).split("\\").join("/");
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SheetRows = {
  headers: string[];
  rows: Record<string, string>[];
};

export type SourceFileStatus = {
  logical_name: string;
  file_name: string;
  path: string;
  exists: boolean;
  size_bytes: number | null;
  sha256: string | null;
  source_sheet: string | null;
  row_count: number | null;
  sheet_names: string[];
};

export class BundleIssues {
  warnings: string[] = [];
  errors: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }
}

export function resolveInputDir(inputDir: string | undefined): string {
  return resolve(process.cwd(), inputDir || "data/import");
}

export function resolveOutputDir(outDir: string | undefined): string {
  return resolve(process.cwd(), outDir || "data/import/bundles/koda_data_bundle_v1");
}

export function ensureOutputDir(outDir: string): void {
  mkdirSync(outDir, { recursive: true });
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function readWorkbookSheetNames(filePath: string): string[] {
  const workbook = XLSX.readFile(filePath, { bookSheets: true });
  return workbook.SheetNames;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export function readWorksheetRows(filePath: string, sheetName: string): SheetRows {
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: false });
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Missing sheet "${sheetName}" in ${filePath}`);
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    blankrows: false,
  });
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headers = (matrix[0] as unknown[]).map((header) => cellText(header));
  const rows: Record<string, string>[] = [];

  for (const rawRow of matrix.slice(1)) {
    const values = rawRow as unknown[];
    const row: Record<string, string> = {};
    let hasAnyValue = false;

    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (!header) continue;
      const text = cellText(values[i]);
      row[header] = text;
      if (text) hasAnyValue = true;
    }

    if (hasAnyValue) rows.push(row);
  }

  return { headers, rows };
}

export function countWorksheetRows(filePath: string, sheetName: string): number {
  return readWorksheetRows(filePath, sheetName).rows.length;
}

export function readColumnValues(rows: Record<string, string>[], column: string): string[] {
  return rows.map((row) => row[column] || "").filter(Boolean);
}

export function getSourceFileStatus(
  inputDir: string,
  logicalName: string,
  fileName: string,
  sourceSheet: string | null,
): SourceFileStatus {
  const path = resolve(inputDir, fileName);
  if (!existsSync(path)) {
    return {
      logical_name: logicalName,
      file_name: fileName,
      path: manifestPath(path),
      exists: false,
      size_bytes: null,
      sha256: null,
      source_sheet: sourceSheet,
      row_count: null,
      sheet_names: [],
    };
  }

  const sheetNames = readWorkbookSheetNames(path);
  const hasSourceSheet = sourceSheet ? sheetNames.includes(sourceSheet) : false;
  const rowCount = sourceSheet && hasSourceSheet ? countWorksheetRows(path, sourceSheet) : null;

  return {
    logical_name: logicalName,
    file_name: fileName,
    path: manifestPath(path),
    exists: true,
    size_bytes: statSync(path).size,
    sha256: sha256File(path),
    source_sheet: sourceSheet,
    row_count: rowCount,
    sheet_names: sheetNames,
  };
}

export function writePrettyJson(path: string, value: JsonValue): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeJsonLines(path: string, values: JsonValue[]): void {
  writeFileSync(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`, "utf8");
}
