import Link from "next/link";
import { filterContentItems, readContentItems, stringValue, uniqueValues } from "@/lib/admin-bundle";
import MissingBundleNotice from "../_components/MissingBundleNotice";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Params = {
  q?: string;
  sourceDataset?: string;
  sourceLayer?: string;
  sourceTypeDetail?: string;
  publicDisplayStatus?: string;
  importStatus?: string;
  isPublic?: string;
  needsHumanReview?: string;
  leht?: string;
};

function joined(values: unknown): string {
  return Array.isArray(values) && values.length > 0 ? values.map(stringValue).filter(Boolean).join(", ") : "—";
}

function hrefFor(params: Params, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "leht") continue;
    if (value) search.set(key, value);
  }
  search.set("leht", String(page));
  return `/admin/content-items?${search.toString()}`;
}

export default async function AdminContentItemsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const bundle = readContentItems();

  if (!bundle.ok) {
    return (
      <>
        <h1>Paketis olevad sisuread</h1>
        <MissingBundleNotice error={bundle.error} />
      </>
    );
  }

  const { rows, pagination } = filterContentItems(bundle.data, {
    ...params,
    page: parseInt(params.leht || "1", 10) || 1,
    pageSize: PAGE_SIZE,
  });

  return (
    <>
      <h1>Paketis olevad sisuread ({pagination.total})</h1>
      <div className="card">
        <p className="section-sub">
          Read-only vaade `content_items.jsonl` sisule. Siin lehel ei saa sisu muuta ega importida.
        </p>
      </div>

      <form method="get" className="card form-grid">
        <div style={{ display: "grid", gridTemplateColumns: "2fr repeat(3, 1fr)", gap: 10 }}>
          <input name="q" type="text" placeholder="Otsi pealkirja, URL-i või externalId järgi..." defaultValue={params.q || ""} />
          <select name="sourceDataset" defaultValue={params.sourceDataset || ""}>
            <option value="">Kõik datasetid</option>
            {uniqueValues(bundle.data, "sourceDataset").map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="sourceLayer" defaultValue={params.sourceLayer || ""}>
            <option value="">Kõik kihid</option>
            {uniqueValues(bundle.data, "sourceLayer").map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="sourceTypeDetail" defaultValue={params.sourceTypeDetail || ""}>
            <option value="">Kõik tüübid</option>
            {uniqueValues(bundle.data, "sourceTypeDetail").map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <select name="publicDisplayStatus" defaultValue={params.publicDisplayStatus || ""}>
            <option value="">Kõik publicDisplayStatus</option>
            {uniqueValues(bundle.data, "publicDisplayStatus").map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="importStatus" defaultValue={params.importStatus || ""}>
            <option value="">Kõik importStatus</option>
            {uniqueValues(bundle.data, "importStatus").map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="isPublic" defaultValue={params.isPublic || ""}>
            <option value="">Avalikkus: kõik</option>
            <option value="true">isPublic=true</option>
            <option value="false">isPublic=false</option>
          </select>
          <select name="needsHumanReview" defaultValue={params.needsHumanReview || ""}>
            <option value="">Ülevaatus: kõik</option>
            <option value="true">needsHumanReview=true</option>
            <option value="false">needsHumanReview=false</option>
          </select>
        </div>
        <div>
          <button type="submit" className="btn btn-small">
            Filtreeri
          </button>{" "}
          <Link href="/admin/content-items" className="btn btn-secondary btn-small">
            Tühjenda
          </Link>
        </div>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Rida</th>
            <th>Allikas</th>
            <th>Olek</th>
            <th>Sildid</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.externalId || `${row.title}-${row.canonicalUrl}`}>
              <td>
                <strong>{row.displayTitle || row.title || row.externalId}</strong>
                <div className="muted small">{row.externalId}</div>
              </td>
              <td>
                <div>{row.sourceDataset || "—"}</div>
                <div className="muted small">{row.sourceLayer || "—"}</div>
                <div className="muted small">{row.sourceTypeDetail || "—"}</div>
              </td>
              <td>
                <div className="status-flags">
                  <span className={`flag ${row.isPublic ? "evergreen" : "hidden"}`}>isPublic={String(row.isPublic)}</span>
                  {row.needsHumanReview && <span className="flag priority">needs review</span>}
                </div>
                <div className="muted small">{row.publicDisplayStatus || "—"}</div>
                <div className="muted small">{row.importStatus || "—"}</div>
                <div className="muted small">priority: {row.publicPriority || "—"}</div>
              </td>
              <td>
                <div className="small">Valdkond: {joined(row.valdkonnad)}</div>
                <div className="small">Tegevusala: {joined(row.tegevusalad)}</div>
                <div className="small">Täpsustus: {joined(row.tapsustused)}</div>
              </td>
              <td className="small" style={{ wordBreak: "break-all" }}>
                {row.canonicalUrl ? (
                  <a href={row.canonicalUrl} target="_blank" rel="noopener noreferrer">
                    {row.canonicalUrl}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Sobivaid sisuridu ei leitud.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pagination.pages > 1 && (
        <p>
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={hrefFor(params, page)}
              style={{ marginRight: 8, fontWeight: page === pagination.page ? 700 : 400 }}
            >
              {page}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}
