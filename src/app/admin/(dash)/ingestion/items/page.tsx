import Link from "next/link";
import { prisma } from "@/lib/db";
import { LAWS, getLawBySlug } from "@/lib/law-dictionary";
import { type StagingViewRow, lawSlugsOf, selectStagingItems } from "@/lib/ingestion/staging-view";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const FETCH_CAP = 1000;
const REVIEW_STATUSES = ["new", "needs_review", "matched_existing", "approved", "rejected", "ignored"];
const SOURCE_TYPES = ["news", "opinion", "achievement", "event", "other"];

type Params = {
  runId?: string;
  reviewStatus?: string;
  sourceType?: string;
  law?: string;
  valdkond?: string;
  year?: string;
  q?: string;
  leht?: string;
};

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" }) : "Kuupäev puudub";
}

function hrefFor(params: Params, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "leht") continue;
    if (value) search.set(key, value);
  }
  search.set("leht", String(page));
  return `/admin/ingestion/items?${search.toString()}`;
}

async function loadRows(runId?: string): Promise<{ rows: StagingViewRow[]; error: string | null }> {
  try {
    const rows = await prisma.ingestionStagingItem.findMany({
      where: runId ? { runId } : undefined,
      orderBy: { createdAt: "desc" },
      take: FETCH_CAP,
      select: {
        id: true,
        title: true,
        canonicalUrl: true,
        publishedAt: true,
        createdAt: true,
        reviewStatus: true,
        detectedSourceType: true,
        detectedLaws: true,
        detectedValdkonnad: true,
        matchedContentItemId: true,
      },
    });
    return { rows: rows as StagingViewRow[], error: null };
  } catch {
    return { rows: [], error: "Staging kirjeid ei õnnestunud laadida (andmebaas ei vasta või migratsioon puudub)." };
  }
}

export default async function AdminIngestionItemsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { rows, error } = await loadRows(params.runId);

  const valdkondOptions = [
    ...new Set(
      rows.flatMap((row) => (Array.isArray(row.detectedValdkonnad) ? (row.detectedValdkonnad as string[]) : [])),
    ),
  ].sort((a, b) => a.localeCompare(b, "et"));

  const selected = selectStagingItems(rows, {
    reviewStatus: params.reviewStatus,
    detectedSourceType: params.sourceType,
    law: params.law,
    valdkond: params.valdkond,
    q: params.q,
    year: params.year ? parseInt(params.year, 10) || null : null,
  });

  const page = Math.max(1, parseInt(params.leht || "1", 10) || 1);
  const pages = Math.max(1, Math.ceil(selected.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = selected.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <>
      <p>
        <Link href="/admin/ingestion" className="btn btn-secondary btn-small">
          ← Tagasi sissevõtu ülevaatesse
        </Link>
      </p>
      <h1>Staging kirjed ({selected.length})</h1>
      <p className="section-sub">
        Sissevõetud Koda.ee lehed ülevaatuse ootel. Need ei ole avalikud ega muuda olemasolevat sisu.
        Vaikimisi: ülevaatust vajavad ja uued eespool, uuemad enne.
      </p>

      {error && (
        <div className="card notice">
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      <form method="get" className="card form-grid">
        {params.runId && <input type="hidden" name="runId" value={params.runId} />}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 }}>
          <input name="q" type="text" placeholder="Otsi pealkirja või URL-i..." defaultValue={params.q || ""} />
          <select name="reviewStatus" defaultValue={params.reviewStatus || ""}>
            <option value="">Kõik staatused</option>
            {REVIEW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select name="sourceType" defaultValue={params.sourceType || ""}>
            <option value="">Kõik tüübid</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input name="year" type="number" placeholder="Aasta (nt 2025)" defaultValue={params.year || ""} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 10 }}>
          <select name="law" defaultValue={params.law || ""}>
            <option value="">Kõik õigusaktid</option>
            {LAWS.map((law) => (
              <option key={law.slug} value={law.slug}>
                {law.canonicalName}
              </option>
            ))}
          </select>
          <select name="valdkond" defaultValue={params.valdkond || ""}>
            <option value="">Kõik valdkonnad</option>
            {valdkondOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-small">
            Filtreeri
          </button>
          <Link href={params.runId ? `/admin/ingestion/items?runId=${params.runId}` : "/admin/ingestion/items"} className="btn btn-secondary btn-small">
            Tühjenda
          </Link>
        </div>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Pealkiri</th>
            <th>Kuupäev</th>
            <th>Tüüp</th>
            <th>Õigusaktid / valdkonnad</th>
            <th>Olek</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row) => {
            const lawSlugs = lawSlugsOf(row.detectedLaws);
            const valdkonnad = Array.isArray(row.detectedValdkonnad) ? (row.detectedValdkonnad as string[]) : [];
            return (
              <tr key={row.id}>
                <td>
                  <strong>{row.title || "(pealkirjata)"}</strong>
                  <div className="muted small" style={{ wordBreak: "break-all" }}>
                    <a href={row.canonicalUrl} target="_blank" rel="noopener noreferrer">
                      {row.canonicalUrl}
                    </a>
                  </div>
                  {row.matchedContentItemId && (
                    <div className="muted small">Sobitub olemasoleva sisuga: {row.matchedContentItemId}</div>
                  )}
                </td>
                <td className="small">{formatDate(row.publishedAt)}</td>
                <td className="small">{row.detectedSourceType || "—"}</td>
                <td className="small">
                  <div className="status-flags">
                    {lawSlugs.map((slug) => (
                      <Link key={slug} href={`/seadused/${slug}`} target="_blank" className="flag evergreen">
                        {getLawBySlug(slug)?.canonicalName ?? slug}
                      </Link>
                    ))}
                  </div>
                  {valdkonnad.length > 0 && <div className="muted small">Valdkonnad: {valdkonnad.join(", ")}</div>}
                  {lawSlugs.length === 0 && valdkonnad.length === 0 && "—"}
                </td>
                <td>
                  <span
                    className={`flag ${
                      row.reviewStatus === "approved"
                        ? "evergreen"
                        : row.reviewStatus === "rejected" || row.reviewStatus === "ignored"
                          ? "hidden"
                          : "priority"
                    }`}
                  >
                    {row.reviewStatus}
                  </span>
                </td>
              </tr>
            );
          })}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Sobivaid staging kirjeid ei leitud.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <p>
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={hrefFor(params, p)} style={{ marginRight: 8, fontWeight: p === safePage ? 700 : 400 }}>
              {p}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}
