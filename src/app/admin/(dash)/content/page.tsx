import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function AdminContentList({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; leht?: string }>;
}) {
  const { q, leht } = await searchParams;
  const page = Math.max(1, parseInt(leht || "1", 10) || 1);

  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { displayTitle: { contains: q, mode: "insensitive" as const } },
          { canonicalUrl: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [items, total] = await Promise.all([
    prisma.contentItem.findMany({
      where,
      orderBy: [{ date: { sort: "desc", nulls: "last" } }, { scrapedAt: "desc" }],
      include: { tags: { include: { tag: true } }, topicGroups: true },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.contentItem.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1>Imporditud sisu ({total})</h1>

      <form method="get" className="card" style={{ display: "flex", gap: 10 }}>
        <input type="text" name="q" placeholder="Otsi pealkirja või URL-i järgi…" defaultValue={q || ""} />
        <button type="submit" className="btn btn-small">
          Otsi
        </button>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Pealkiri</th>
            <th>Kuupäev</th>
            <th>Allikas</th>
            <th>Sildid</th>
            <th>Olek</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link href={`/admin/content/${item.id}`}>{item.displayTitle || item.title}</Link>
                <div className="muted small" style={{ wordBreak: "break-all" }}>
                  {item.canonicalUrl}
                </div>
              </td>
              <td>{item.date ? item.date.toLocaleDateString("et-EE") : "—"}</td>
              <td>{item.sourceType}</td>
              <td>{item.tags.length}</td>
              <td>
                <div className="status-flags">
                  {item.isHidden && <span className="flag hidden">peidetud</span>}
                  {item.isEvergreen && <span className="flag evergreen">evergreen</span>}
                  {item.manualWeight > 0 && <span className="flag priority">prioriteet</span>}
                  {item.manualWeight < 0 && <span className="flag down">madaldatud</span>}
                </div>
              </td>
              <td>
                <Link href={`/admin/content/${item.id}`} className="btn btn-secondary btn-small">
                  Muuda
                </Link>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Sisu ei leitud. Käivita <code>npm run seed</code> või <code>npm run crawl</code>.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pages > 1 && (
        <p>
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link
              key={p}
              href={`/admin/content?leht=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              style={{ marginRight: 8, fontWeight: p === page ? 700 : 400 }}
            >
              {p}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}
