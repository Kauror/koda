import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <h1>Muudatuste logi</h1>
      <p className="section-sub">Viimased avaldamised, peitmised ja override'i muudatused.</p>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Aeg</th>
            <th>Tegevus</th>
            <th>Kirje</th>
            <th>Tegija</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.createdAt.toLocaleString("et-EE")}</td>
              <td>{log.action}</td>
              <td>
                {log.contentItemId ? (
                  <Link href={`/admin/content/${log.contentItemId}`}>{log.contentExternalId || log.contentItemId}</Link>
                ) : (
                  log.contentExternalId || "—"
                )}
              </td>
              <td>{log.actor || "—"}</td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                Muudatusi pole veel logitud.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
