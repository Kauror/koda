import Link from "next/link";
import { prisma } from "@/lib/db";
import { statusLabel } from "@/lib/content-threads";

export const dynamic = "force-dynamic";

export default async function AdminThreadsList() {
  const threads = await prisma.contentThread.findMany({
    orderBy: [{ sortPriority: "desc" }, { title: "asc" }],
    include: { _count: { select: { items: true } } },
  });

  return (
    <>
      <h1>Teemaliinid ({threads.length})</h1>
      <p className="muted small">
        Teemaliin koondab eri sisuelemendid (arvamused, töövõidud, uudised, taust) ühe laiema teema
        alla ja kuvab need ajajoonena. Teemaliinid on administraatori hallatavad ega kustu importimisel.
      </p>

      <form method="post" action="/api/admin/threads" className="card form-grid">
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Loo uus teemaliin</h2>
        <div>
          <label className="field-label" htmlFor="title">
            Pealkiri
          </label>
          <input id="title" type="text" name="title" required placeholder="nt Välistööjõud ja ränne" />
        </div>
        <div>
          <label className="field-label" htmlFor="description">
            Lühikirjeldus
          </label>
          <textarea
            id="description"
            name="description"
            placeholder="Koja tegevused ja seisukohad välistööjõu, sisserände piirarvu ja oskustöötajate teemal…"
          />
        </div>
        <div>
          <button type="submit" className="btn btn-small">
            Loo teemaliin
          </button>
        </div>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Pealkiri</th>
            <th>Sisuelemente</th>
            <th>Olek</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {threads.map((t) => (
            <tr key={t.id}>
              <td>
                <Link href={`/admin/threads/${t.id}`}>{t.title}</Link>
                <div className="muted small">{t.slug}</div>
              </td>
              <td>{t._count.items}</td>
              <td>
                <div className="status-flags">
                  <span className={`flag ${t.status === "public" ? "evergreen" : "hidden"}`}>
                    {statusLabel(t.status)}
                  </span>
                  {t.featured && <span className="flag priority">esiletõstetud</span>}
                </div>
              </td>
              <td>
                <Link href={`/admin/threads/${t.id}`} className="btn btn-secondary btn-small">
                  Muuda
                </Link>
              </td>
            </tr>
          ))}
          {threads.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Teemaliine pole veel loodud.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
