import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function typeLabel(item: { sourceDataset: string | null; sourceLayer: string | null; sourceTypeDetail: string | null }) {
  if (item.sourceTypeDetail === "toovoit" || item.sourceLayer === "koda_achievement" || item.sourceDataset === "toovoidud") return "Töövõit";
  if (item.sourceTypeDetail === "meie_arvamus_article" || item.sourceLayer === "koda_public_opinion" || item.sourceDataset === "opinions") return "Arvamus";
  if (item.sourceTypeDetail === "meie_uudis" || item.sourceLayer === "koda_news" || item.sourceDataset === "web") return "Uudis";
  return "Sisu";
}

export default async function AdminContentList({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; leht?: string }>;
}) {
  const { q, leht } = await searchParams;
  const page = Math.max(1, parseInt(leht || "1", 10) || 1);

  const where: Prisma.ContentItemWhereInput = {
    AND: [
      {
        OR: [
          { sourceDataset: { in: ["web", "opinions", "toovoidud"] } },
          { sourceLayer: { in: ["koda_news", "koda_public_opinion", "koda_achievement"] } },
          { sourceTypeDetail: { in: ["meie_uudis", "meie_arvamus_article", "toovoit"] } },
        ],
      },
      q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { displayTitle: { contains: q, mode: "insensitive" } },
              { adminDisplayTitleOverride: { contains: q, mode: "insensitive" } },
              { externalId: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [items, total] = await Promise.all([
    prisma.contentItem.findMany({
      where,
      orderBy: [{ date: { sort: "desc", nulls: "last" } }, { scrapedAt: "desc" }],
      include: { tags: { include: { tag: true } }, adminDrafts: true },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.contentItem.count({ where }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <h1>Sisu haldus ({total})</h1>
      <p className="section-sub">
        Otsi ja muuda töövõite, Koja seisukohti ning uudiseid. Muudatused salvestatakse mustandina ja lähevad avalikuks pärast avaldamist.
      </p>

      <form method="get" className="card" style={{ display: "flex", gap: 10 }}>
        <input type="text" name="q" placeholder="Otsi pealkirja järgi..." defaultValue={q || ""} />
        <button type="submit" className="btn btn-small">
          Otsi
        </button>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Pealkiri</th>
            <th>Kuupäev</th>
            <th>Tüüp</th>
            <th>Teema / tegevusala</th>
            <th>Olek</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const topics = item.tags.filter((t) => t.tag.type === "valdkond").slice(0, 2).map((t) => t.tag.name);
            const activities = item.tags.filter((t) => t.tag.type === "tegevusala").slice(0, 2).map((t) => t.tag.name);
            return (
              <tr key={item.id}>
                <td>
                  <Link href={`/admin/content/${item.id}`}>{item.adminDisplayTitleOverride || item.displayTitle || item.title}</Link>
                  <div className="muted small" style={{ wordBreak: "break-all" }}>
                    {item.externalId || item.canonicalUrl || item.sourceUrl || "—"}
                  </div>
                </td>
                <td>{item.date ? item.date.toLocaleDateString("et-EE") : "—"}</td>
                <td>{typeLabel(item)}</td>
                <td>
                  <div className="small">{topics.join(", ") || "—"}</div>
                  <div className="muted small">{activities.join(", ") || "—"}</div>
                </td>
                <td>
                  <div className="status-flags">
                    {item.adminVisibilityOverride === false && <span className="flag hidden">admin peidetud</span>}
                    {item.adminVisibilityOverride === true && <span className="flag evergreen">admin avalik</span>}
                    {item.adminVisibilityOverride == null && item.isPublic && <span className="flag evergreen">live</span>}
                    {item.adminVisibilityOverride == null && !item.isPublic && <span className="flag down">mitte avalik</span>}
                    {item.adminDrafts.some((draft) => !draft.publishedAt) && <span className="flag priority">mustand</span>}
                  </div>
                </td>
                <td>
                  <Link href={`/admin/content/${item.id}`} className="btn btn-secondary btn-small">
                    Muuda
                  </Link>
                </td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Sisu ei leitud.
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
