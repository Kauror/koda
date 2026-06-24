import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { type ImportReportSummary, emptyImportReportSummary, summarizeImportReport } from "@/lib/admin-status";

export const dynamic = "force-dynamic";

const REPORT_PATH = "data/import/reports/import-report.json";
const PUBLIC_IMPORT_ACTIONS = ["import_public", "enrichment_public"];
const ALL_IMPORT_ACTIONS = [
  "import_public",
  "import_support_only",
  "import_staging_only",
  "do_not_import_public",
  "enrichment_public",
  "enrichment_hold",
];
const DATASETS = ["web", "opinions", "toovoidud", "annual_reports"] as const;

function loadReport(): ImportReportSummary {
  try {
    const path = resolve(process.cwd(), REPORT_PATH);
    if (!existsSync(path)) return emptyImportReportSummary();
    return summarizeImportReport(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return emptyImportReportSummary();
  }
}

type DbCounts = {
  ok: boolean;
  total: number;
  publicByGate: number;
  numericHold: number;
  lawSearchAllowed: number;
  byAction: { action: string; count: number }[];
  byDataset: { dataset: string; count: number }[];
  lastUpdated: Date | null;
};

async function loadDbCounts(): Promise<DbCounts> {
  const empty: DbCounts = { ok: false, total: 0, publicByGate: 0, numericHold: 0, lawSearchAllowed: 0, byAction: [], byDataset: [], lastUpdated: null };
  try {
    const [total, publicByGate, numericHold, lawSearchAllowed, latest, actionCounts, datasetCounts] = await Promise.all([
      prisma.contentItem.count(),
      prisma.contentItem.count({ where: { publicDisplayAllowed: true, importAction: { in: PUBLIC_IMPORT_ACTIONS } } }),
      prisma.contentItem.count({ where: { numericClaimNeedsReview: true } }),
      prisma.contentItem.count({ where: { lawSearchAllowed: true } }),
      prisma.contentItem.findFirst({ orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
      Promise.all(ALL_IMPORT_ACTIONS.map((action) => prisma.contentItem.count({ where: { importAction: action } }))),
      Promise.all(DATASETS.map((dataset) => prisma.contentItem.count({ where: { sourceDataset: dataset } }))),
    ]);
    return {
      ok: true,
      total,
      publicByGate,
      numericHold,
      lawSearchAllowed,
      byAction: ALL_IMPORT_ACTIONS.map((action, i) => ({ action, count: actionCounts[i] })).filter((a) => a.count > 0),
      byDataset: DATASETS.map((dataset, i) => ({ dataset, count: datasetCounts[i] })).filter((d) => d.count > 0),
      lastUpdated: latest?.updatedAt ?? null,
    };
  } catch {
    return empty;
  }
}

export default async function AdminStatusPage() {
  const report = loadReport();
  const db = await loadDbCounts();

  return (
    <>
      <h1>Andmestiku staatus</h1>
      <p className="section-sub">
        Aktiivse andmepaketi versioon, viimane import ja avalike/peidetud ridade arv — käivituseelseks
        kontrolliks. Andmebaasi loendurid on elusandmed; paketiinfo pärineb viimase impordi raportist.
      </p>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Aktiivne andmepakett</h2>
        {report.available ? (
          <>
            <div className="status-flags" style={{ marginBottom: 10 }}>
              <span className={`flag ${report.finalStatus === "PASS" ? "evergreen" : report.finalStatus === "FAIL" ? "hidden" : "priority"}`}>
                {report.finalStatus ?? "teadmata"}
              </span>
              <span className="flag priority">{report.kind ?? "import"}</span>
              {report.dryRun && <span className="flag down">dry-run</span>}
              <span className="flag down">imporditud {report.timestamp ?? "teadmata"}</span>
            </div>
            <table className="admin-table">
              <tbody>
                {report.inputFiles.map((f) => (
                  <tr key={f.label}>
                    <td>{f.label}</td>
                    <td className="small">{f.file}</td>
                  </tr>
                ))}
                <tr>
                  <td>Imporditud sisuridu</td>
                  <td>{report.totalImported ?? "—"}</td>
                </tr>
                <tr>
                  <td>Avalikud read (import)</td>
                  <td>{report.publicRows ?? "—"}</td>
                </tr>
                <tr>
                  <td>Peidetud / toetavad read (import)</td>
                  <td>{report.hiddenOrSupportingRows ?? "—"}</td>
                </tr>
                {report.linkCounts.map((l) => (
                  <tr key={l.label}>
                    <td>Lingid: {l.label}</td>
                    <td>{l.count}</td>
                  </tr>
                ))}
                {report.backupName && (
                  <tr>
                    <td>Varukoopia</td>
                    <td className="small">{report.backupName}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {report.actionCounts.length > 0 && (
              <div className="status-flags" style={{ marginTop: 10 }}>
                {report.actionCounts.map((a) => (
                  <span key={`${a.dataset}-${a.action}`} className="flag down">
                    {a.dataset}/{a.action}: {a.count}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">
            Impordiraportit ei leitud (<code>{REPORT_PATH}</code>). Käivita import:{" "}
            <code>npm run import:merge-ready</code>.
          </p>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Andmebaas praegu</h2>
        {db.ok ? (
          <>
            <div className="status-flags" style={{ marginBottom: 10 }}>
              <span className="flag">Kokku: {db.total}</span>
              <span className="flag evergreen">Avalikud (värav): {db.publicByGate}</span>
              <span className="flag priority">Numbriülevaatus: {db.numericHold}</span>
              <span className="flag down">Seadusotsing lubatud: {db.lawSearchAllowed}</span>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>import_action</th>
                  <th>Ridu</th>
                </tr>
              </thead>
              <tbody>
                {db.byAction.map((a) => (
                  <tr key={a.action}>
                    <td>{a.action}</td>
                    <td>{a.count}</td>
                  </tr>
                ))}
                {db.byDataset.map((d) => (
                  <tr key={d.dataset}>
                    <td className="muted">dataset: {d.dataset}</td>
                    <td>{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small" style={{ marginTop: 8 }}>
              Viimati muudetud: {db.lastUpdated ? db.lastUpdated.toLocaleString("et-EE") : "—"}
            </p>
          </>
        ) : (
          <p className="muted">Andmebaasi loendurid pole praegu saadaval (andmebaas ei vasta).</p>
        )}
      </section>

      {report.errors.length > 0 && (
        <section className="card notice">
          <h2 style={{ marginTop: 0 }}>Impordi vead ({report.errors.length})</h2>
          {report.errors.slice(0, 20).map((e, i) => (
            <p key={i} className="flag hidden" style={{ display: "block", marginBottom: 4 }}>
              {e}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
