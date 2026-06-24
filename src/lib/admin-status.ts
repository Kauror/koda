/**
 * Pure helpers for the admin dataset/status page (launch-safety view). Turns the
 * importer's data/import/reports/import-report.json into a display view model.
 * Defensive + null-safe; never exposes absolute paths or throws on bad input.
 */

export type ImportReportSummary = {
  available: boolean;
  timestamp: string | null;
  kind: string | null;
  finalStatus: string | null; // PASS | FAIL
  dryRun: boolean | null;
  inputFiles: { label: string; file: string }[];
  totalImported: number | null;
  dbRowsAfterImport: number | null;
  publicRows: number | null;
  hiddenOrSupportingRows: number | null;
  actionCounts: { dataset: string; action: string; count: number }[];
  linkCounts: { label: string; count: number }[];
  errors: string[];
  backupName: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
/** Last path segment only — never surface absolute local/server paths. */
function baseName(value: unknown): string | null {
  const s = strOrNull(value);
  return s ? s.split(/[\\/]/).pop() || s : null;
}

export function emptyImportReportSummary(): ImportReportSummary {
  return {
    available: false,
    timestamp: null,
    kind: null,
    finalStatus: null,
    dryRun: null,
    inputFiles: [],
    totalImported: null,
    dbRowsAfterImport: null,
    publicRows: null,
    hiddenOrSupportingRows: null,
    actionCounts: [],
    linkCounts: [],
    errors: [],
    backupName: null,
  };
}

export function summarizeImportReport(raw: unknown): ImportReportSummary {
  const r = asRecord(raw);
  if (Object.keys(r).length === 0) return emptyImportReportSummary();

  const inputFilesRec = asRecord(r.inputFiles);
  const inputFiles = Object.entries(inputFilesRec)
    .map(([label, file]) => ({ label, file: baseName(file) ?? "" }))
    .filter((f) => f.file);

  const actionCounts: ImportReportSummary["actionCounts"] = [];
  for (const [dataset, byAction] of Object.entries(asRecord(r.actionCounts))) {
    for (const [action, count] of Object.entries(asRecord(byAction))) {
      const n = numOrNull(count);
      if (n != null) actionCounts.push({ dataset, action, count: n });
    }
  }

  const linkCounts: ImportReportSummary["linkCounts"] = Object.entries(asRecord(r.linkCounts))
    .map(([label, count]) => ({ label, count: numOrNull(count) ?? 0 }));

  const errors = Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === "string") : [];

  return {
    available: true,
    timestamp: strOrNull(r.timestamp),
    kind: strOrNull(r.kind),
    finalStatus: strOrNull(r.finalStatus),
    dryRun: boolOrNull(r.dryRun),
    inputFiles,
    totalImported: numOrNull(r.totalContentImported),
    dbRowsAfterImport: numOrNull(r.dbContentRowsAfterImport),
    publicRows: numOrNull(r.publicRows),
    hiddenOrSupportingRows: numOrNull(r.hiddenOrSupportingRows),
    actionCounts,
    linkCounts,
    errors,
    backupName: baseName(r.backupPath),
  };
}
