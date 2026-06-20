import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatDateTime(date: Date | null): string {
  return date ? date.toLocaleString("et-EE") : "—";
}

type RunRow = {
  id: string;
  source: string;
  mode: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  pagesDiscovered: number;
  pagesFetched: number;
  itemsCreated: number;
  itemsUpdated: number;
  itemsSkipped: number;
  itemsFailed: number;
  errorSummary: string | null;
};

async function loadRuns(): Promise<{ runs: RunRow[]; stagingTotal: number; error: string | null }> {
  try {
    const [runs, stagingTotal] = await Promise.all([
      prisma.ingestionRun.findMany({ orderBy: { startedAt: "desc" }, take: 25 }),
      prisma.ingestionStagingItem.count(),
    ]);
    return { runs, stagingTotal, error: null };
  } catch {
    return { runs: [], stagingTotal: 0, error: "Ingestiooni andmeid ei õnnestunud laadida (andmebaas ei vasta või migratsioon puudub)." };
  }
}

export default async function AdminIngestionPage() {
  const { runs, stagingTotal, error } = await loadRuns();

  return (
    <>
      <h1>Koda.ee ingestion</h1>
      <p className="section-sub">
        Koda.ee avalike lehtede automaatne sissevõtt ülevaatuseks. Sissevõtt ei muuda olemasolevat
        sisu ega avalda midagi automaatselt — kõik read jäävad ülevaatuse ootele.
      </p>

      <div className="card">
        <div className="card-links">
          <Link href="/admin/ingestion/items" className="btn btn-small">
            Vaata staging kirjeid ({stagingTotal})
          </Link>
          <Link href="/admin/data-review" className="btn btn-secondary btn-small">
            Andmeülevaatus
          </Link>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Käsurea käsk: <code>npm run ingest:koda-ee -- --dry-run --limit=20</code> (proov) või{" "}
          <code>npm run ingest:koda-ee -- --staging --limit=50</code> (kirjuta staging).
        </p>
      </div>

      {error && (
        <div className="card notice">
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Käivitatud</th>
            <th>Režiim</th>
            <th>Olek</th>
            <th>Leheküljed (leitud/võetud)</th>
            <th>Kirjed (uus/muudetud/vahele/viga)</th>
            <th>Vead</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                {formatDateTime(run.startedAt)}
                <div className="muted small">{run.source}</div>
              </td>
              <td>{run.mode}</td>
              <td>
                <span
                  className={`flag ${run.status === "completed" ? "evergreen" : run.status === "failed" ? "hidden" : "priority"}`}
                >
                  {run.status}
                </span>
                <div className="muted small">{run.finishedAt ? formatDateTime(run.finishedAt) : "—"}</div>
              </td>
              <td>
                {run.pagesDiscovered} / {run.pagesFetched}
              </td>
              <td>
                {run.itemsCreated} / {run.itemsUpdated} / {run.itemsSkipped} / {run.itemsFailed}
                <div className="muted small">
                  <Link href={`/admin/ingestion/items?runId=${encodeURIComponent(run.id)}`}>Vaata kirjeid →</Link>
                </div>
              </td>
              <td className="small" style={{ maxWidth: 280, wordBreak: "break-word" }}>
                {run.errorSummary ? run.errorSummary.split("\n").slice(0, 3).join(" · ") : "—"}
              </td>
            </tr>
          ))}
          {runs.length === 0 && !error && (
            <tr>
              <td colSpan={6} className="muted">
                Ühtegi sissevõttu pole veel tehtud. Käivita <code>npm run ingest:koda-ee -- --staging</code>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
