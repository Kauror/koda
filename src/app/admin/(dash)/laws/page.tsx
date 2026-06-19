import Link from "next/link";
import { prisma } from "@/lib/db";
import { LAWS } from "@/lib/law-dictionary";
import { extractLawMentions } from "@/lib/law-match";

export const dynamic = "force-dynamic";

type LawStat = { confirmed: number; weak: number; newest: Date | null };

/**
 * Count law mentions across imported content (title/summary-level fields only,
 * to keep this admin scan light). Returns null if the database is unavailable
 * so the dictionary still renders. Weak matches are counted separately — they
 * are suggestions for review, never confirmed/public tags.
 */
async function computeLawStats(): Promise<Map<string, LawStat> | null> {
  const stats = new Map<string, LawStat>();
  for (const law of LAWS) stats.set(law.slug, { confirmed: 0, weak: 0, newest: null });
  try {
    const rows = await prisma.contentItem.findMany({
      select: {
        title: true,
        displayTitle: true,
        adminDisplayTitleOverride: true,
        summary: true,
        adminSummaryOverride: true,
        excerpt: true,
        companyRelevance: true,
        kodaPosition: true,
        sourceEvidence: true,
        date: true,
      },
    });
    for (const row of rows) {
      for (const mention of extractLawMentions(row)) {
        const stat = stats.get(mention.slug);
        if (!stat) continue;
        if (mention.confidence === "low") {
          stat.weak++;
        } else {
          stat.confirmed++;
          if (row.date && (!stat.newest || row.date > stat.newest)) stat.newest = row.date;
        }
      }
    }
    return stats;
  } catch {
    return null;
  }
}

function formatDate(date: Date | null): string {
  return date ? date.toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" }) : "—";
}

export default async function AdminLawsPage() {
  const stats = await computeLawStats();

  return (
    <>
      <h1>Õigusaktid</h1>
      <p className="section-sub">
        Õigusaktide sõnastik ja kui palju koja sisu iga seadusega seostub. Nõrgad vasted on ülevaatuse
        soovitused – neid ei käsitleta kinnitatud ega avalike siltidena.
      </p>

      {!stats && (
        <div className="card notice">
          <p style={{ margin: 0 }}>
            Sisu loendurid pole praegu saadaval (andmebaas ei vasta). Allolev sõnastik on siiski nähtav.
          </p>
        </div>
      )}

      <table className="admin-table">
        <thead>
          <tr>
            <th>Õigusakt</th>
            <th>Lühend</th>
            <th>Seotud sisu</th>
            <th>Uusim</th>
            <th>Nõrgad vasted</th>
          </tr>
        </thead>
        <tbody>
          {LAWS.map((law) => {
            const stat = stats?.get(law.slug);
            return (
              <tr key={law.slug}>
                <td>
                  <Link href={`/seadused/${law.slug}`} target="_blank">
                    <strong>{law.canonicalName}</strong>
                  </Link>
                  <div className="muted small">{law.slug}</div>
                  {law.aliases && law.aliases.length > 0 && (
                    <div className="muted small">Aliased: {law.aliases.join(", ")}</div>
                  )}
                </td>
                <td>{law.abbreviation ?? "—"}</td>
                <td>{stat ? stat.confirmed : "—"}</td>
                <td>{stat ? formatDate(stat.newest) : "—"}</td>
                <td>
                  {stat && stat.weak > 0 ? (
                    <span className="flag priority">{stat.weak} ülevaatuseks</span>
                  ) : (
                    <span className="muted">{stat ? "0" : "—"}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
