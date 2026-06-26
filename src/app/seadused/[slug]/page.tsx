import Link from "next/link";
import { notFound } from "next/navigation";
import { getLawBySlug } from "@/lib/law-dictionary";
import { isGenericWorkWinUrl } from "@/lib/content-display";
import { search, type ResultCard } from "@/lib/search";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" });
}

function LawCard({ card }: { card: ResultCard }) {
  return (
    <article className={`other-item${card.isAchievement ? " win" : ""}`}>
      <p className="item-meta">
        {card.badges.map((badge) => (
          <span key={badge} className={`badge${badge === "Töövõit" ? " win-badge" : ""}`}>
            {badge === "Töövõit" ? `✓ ${badge}` : badge}
          </span>
        ))}
        {formatDate(card.date) && <span className="badge-date">{formatDate(card.date)}</span>}
      </p>
      <h3>
        <Link href={`/sisu/${encodeURIComponent(card.detailId)}`}>{card.title}</Link>
      </h3>
      {card.summary && <p className="item-excerpt small">{card.summary}</p>}
      {card.recipient && (
        <div className="card-tags">
          <span className="tag tag-recipient">{card.recipient}</span>
        </div>
      )}
      <p className="card-links">
        <Link href={`/sisu/${encodeURIComponent(card.detailId)}`} className="btn btn-secondary btn-small">
          Loe lähemalt
        </Link>
        {/* Töövõit/news keep a single internal CTA; never link the generic
            koda.ee work-wins listing as an external source. */}
        {card.url && !card.isAchievement && card.kind !== "uudis" && !isGenericWorkWinUrl(card.url) && (
          <a href={card.url} target="_blank" rel="noopener noreferrer" className="item-source-link">
            {card.sourceCtaLabel} →
          </a>
        )}
      </p>
    </article>
  );
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
        <LawCard key={card.id} card={card} />
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

  const newest = [...results.achievements, ...results.positions, ...results.news, ...results.context]
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
            tegelenud – töövõidud, seisukohad, uudised ja taust, uuemad eespool.
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
        <LawSection title="Koja seisukohad ja arvamused" cards={results.positions} />
        <LawSection title="Uudised" cards={results.news} />
        <LawSection title="Teema ajalugu / taust" cards={results.context} />
      </div>
    </main>
  );
}
