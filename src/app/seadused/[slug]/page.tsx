import Link from "next/link";
import { notFound } from "next/navigation";
import PublicResultCard from "@/app/PublicResultCard";
import { getLawBySlug } from "@/lib/law-dictionary";
import { search, type ResultCard } from "@/lib/search";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" });
}

function LawSection({ title, sub, cards }: { title: string; sub?: string; cards: ResultCard[] }) {
  if (cards.length === 0) return null;
  return (
    <section className="results-section">
      <h2>
        {title} <span className="result-count">({cards.length})</span>
      </h2>
      {sub && <p className="section-sub">{sub}</p>}
      {cards.map((card) => (
        <PublicResultCard key={card.id} card={card} sessionId={null} fromQuery="" admin={false} />
      ))}
    </section>
  );
}

export default async function LawPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const law = getLawBySlug(slug);
  if (!law) notFound();

  // Reuse the law-aware search: querying the canonical name recognizes the law
  // and returns related content newest-first, grouped as usual.
  const results = await search({
    q: law.canonicalName,
    valdkond: [],
    tegevusala: [],
    tapsustus: [],
    recipient: [],
    type: [],
  });

  const newest = [...results.achievements, ...results.opinionNews, ...results.context]
    .filter((card) => card.date)
    .sort((a, b) => (b.date ? Date.parse(b.date) : 0) - (a.date ? Date.parse(a.date) : 0))[0];
  const hasResults = results.totalDisplayed > 0;

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <span className="eyebrow">Õigusakt koja töös</span>
          <h1>{law.canonicalName}</h1>
          <p className="sub">
            Vaata, kuidas Eesti Kaubandus-Tööstuskoda on selle õigusaktiga seotud teemadega aja jooksul
            tegelenud - töövõidud, seisukohad, uudised ja taust, uuemad eespool.
          </p>
          {law.abbreviation && <p className="section-sub">Lühend: {law.abbreviation}</p>}
          {law.aliases && law.aliases.length > 0 && (
            <p className="section-sub">Tuntud ka kui: {law.aliases.join(", ")}</p>
          )}
          {law.relatedValdkond && law.relatedValdkond.length > 0 && (
            <div className="filter-summary">
              {law.relatedValdkond.map((valdkond) => (
                <Link key={valdkond} href={`/tulemused?valdkond=${encodeURIComponent(valdkond)}`} className="tag">
                  {valdkond.replace(/-/g, " ")}
                </Link>
              ))}
            </div>
          )}
          <p style={{ marginTop: 16 }}>
            <Link href={`/tulemused?q=${encodeURIComponent(law.canonicalName)}`} className="btn btn-secondary btn-small">
              Otsi sama otsinguvaates
            </Link>
          </p>
        </div>
      </div>

      <div className="container results-body">
        {newest && (
          <div className="card notice" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>
              Uusim seotud sisu:{" "}
              <Link href={`/sisu/${encodeURIComponent(newest.detailId)}`}>
                <strong>{newest.title}</strong>
              </Link>
              {formatDate(newest.date) && <span className="muted"> · {formatDate(newest.date)}</span>}
            </p>
          </div>
        )}

        {!hasResults && (
          <div className="card empty-state" style={{ marginTop: 36 }}>
            <h2>Selle õigusakti kohta ei leidnud me veel seotud materjale</h2>
            <p>Proovi otsida koja avalehel laiema märksõnaga.</p>
            <p style={{ marginTop: 16 }}>
              <Link href="/" className="btn btn-secondary btn-small">
                Avalehele
              </Link>
            </p>
          </div>
        )}

        <LawSection
          title="Töövõidud"
          sub="Konkreetsed tulemused, mille koda on selle teemaga seoses saavutanud."
          cards={results.achievements}
        />
        <LawSection title="Koja seisukohad ja uudised" cards={results.opinionNews} />
        <LawSection title="Teema ajalugu / taust" cards={results.context} />
      </div>
    </main>
  );
}
