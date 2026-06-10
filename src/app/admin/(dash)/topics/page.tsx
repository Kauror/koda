import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminTopicsList() {
  const groups = await prisma.topicGroup.findMany({
    orderBy: { title: "asc" },
    include: { contentItems: true, tags: { include: { tag: true } } },
  });

  return (
    <>
      <h1>Teemagrupid ({groups.length})</h1>

      <form method="post" action="/api/admin/topics" className="card form-grid">
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Loo uus teemagrupp</h2>
        <div>
          <label className="field-label" htmlFor="title">
            Pealkiri
          </label>
          <input id="title" type="text" name="title" required placeholder="nt Maksumuudatused 2026" />
        </div>
        <div>
          <label className="field-label" htmlFor="summary">
            Lühikokkuvõte
          </label>
          <textarea id="summary" name="summary" placeholder="Lühike faktiline kokkuvõte teemast…" />
        </div>
        <div>
          <button type="submit" className="btn btn-small">
            Loo teemagrupp
          </button>
        </div>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Pealkiri</th>
            <th>Sisuelemente</th>
            <th>Sildid</th>
            <th>Olek</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td>
                <Link href={`/admin/topics/${g.id}`}>{g.title}</Link>
                <div className="muted small">{g.slug}</div>
              </td>
              <td>{g.contentItems.length}</td>
              <td>{g.tags.map((t) => t.tag.name).join(", ") || "—"}</td>
              <td>
                <div className="status-flags">
                  {g.isHidden && <span className="flag hidden">peidetud</span>}
                  {g.isEvergreen && <span className="flag evergreen">evergreen</span>}
                  {g.manualWeight > 0 && <span className="flag priority">prioriteet</span>}
                  {g.manualWeight < 0 && <span className="flag down">madaldatud</span>}
                </div>
              </td>
              <td>
                <Link href={`/admin/topics/${g.id}`} className="btn btn-secondary btn-small">
                  Muuda
                </Link>
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Teemagruppe pole veel loodud.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
