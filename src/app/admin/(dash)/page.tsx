import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [contentCount, hiddenCount, untaggedCount, topicCount, tagCount, decisionCount, sessionCount, clickCount, recentSessions] =
    await Promise.all([
      prisma.contentItem.count(),
      prisma.contentItem.count({ where: { isHidden: true } }),
      prisma.contentItem.count({ where: { tags: { none: {} }, isHidden: false } }),
      prisma.topicGroup.count(),
      prisma.tag.count(),
      prisma.dataReviewDecision.count(),
      prisma.searchSession.count(),
      prisma.searchResultClick.count(),
      prisma.searchSession.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    ]);

  return (
    <>
      <h1>Töölaud</h1>
      <div className="card">
        <table className="admin-table">
          <tbody>
            <tr>
              <td>Sisuelemente kokku</td>
              <td>
                <strong>{contentCount}</strong>{" "}
                <span className="muted small">
                  (peidetud: {hiddenCount}, sildistamata: {untaggedCount})
                </span>
              </td>
              <td>
                <Link href="/admin/content">Halda →</Link>
              </td>
            </tr>
            <tr>
              <td>Teemagruppe</td>
              <td>
                <strong>{topicCount}</strong>
              </td>
              <td>
                <Link href="/admin/topics">Halda →</Link>
              </td>
            </tr>
            <tr>
              <td>Silte</td>
              <td>
                <strong>{tagCount}</strong>
              </td>
              <td>
                <Link href="/admin/tags">Halda →</Link>
              </td>
            </tr>
            <tr>
              <td>Andmeülevaatuse otsuseid</td>
              <td>
                <strong>{decisionCount}</strong>
              </td>
              <td>
                <Link href="/admin/data-review">Vaata →</Link>
              </td>
            </tr>
            <tr>
              <td>Otsinguid / klikke</td>
              <td>
                <strong>{sessionCount}</strong> / <strong>{clickCount}</strong>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Viimased otsingud</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Aeg</th>
            <th>Sektor</th>
            <th>Suurus</th>
            <th>Huvid</th>
            <th>Profiil</th>
          </tr>
        </thead>
        <tbody>
          {recentSessions.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                Otsinguid pole veel tehtud.
              </td>
            </tr>
          )}
          {recentSessions.map((s) => (
            <tr key={s.id}>
              <td>{s.createdAt.toLocaleString("et-EE")}</td>
              <td>{s.selectedSector ?? "—"}</td>
              <td>{s.selectedSize ?? "—"}</td>
              <td>{s.selectedInterests.join(", ") || "—"}</td>
              <td>{s.selectedActivities.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
