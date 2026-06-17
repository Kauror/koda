import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { anonymizeIp, hashUserAgent } from "@/lib/hash";
import { getFilterOptions, parseSearchParams, search, type ResultCard } from "@/lib/search";
import TrackedLink from "./TrackedLink";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" });
}

function Badges({ card }: { card: ResultCard }) {
  if (card.badges.length === 0 && !card.date) return null;
  return (
    <p className="item-meta">
      {card.badges.map((b) => (
        <span key={b} className={`badge${b === "Töövõit" ? " win-badge" : ""}`}>
          {b === "Töövõit" ? `✔ ${b}` : b}
        </span>
      ))}
      {formatDate(card.date) && <span className="badge-date">{formatDate(card.date)}</span>}
    </p>
  );
}

function EvidenceHint({ card }: { card: ResultCard }) {
  const hints: string[] = [];
  if (card.evidence.relatedOpinions > 0)
    hints.push(`${card.evidence.relatedOpinions} toetavat arvamust`);
  if (card.evidence.annualContext) hints.push("aastaaruande kontekst");
  if (hints.length === 0) return null;
  return <p className="evidence-hint">Seotud allikad: {hints.join(" · ")}</p>;
}

function Card({
  card,
  sessionId,
  fromQuery,
}: {
  card: ResultCard;
  sessionId: string | null;
  fromQuery: string;
}) {
  const detailHref = `/sisu/${encodeURIComponent(card.detailId)}${
    fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""
  }`;
  return (
    <article className={`other-item${card.isAchievement ? " win" : ""}`}>
      <Badges card={card} />
      <h3>
        {/* Title → internal source-based summary/detail page. */}
        <Link href={detailHref}>{card.title}</Link>
      </h3>
      {card.summary && <p className="item-excerpt small">{card.summary}</p>}
      {(card.valdkonnad.length > 0 || card.tegevusalad.length > 0) && (
        <div className="card-tags">
          {card.valdkonnad.slice(0, 3).map((t) => (
            <span key={`v-${t.slug}`} className="tag">
              {t.name}
            </span>
          ))}
          {card.tegevusalad.slice(0, 2).map((t) => (
            <span key={`s-${t.slug}`} className="tag tag-muted">
              {t.name}
            </span>
          ))}
        </div>
      )}
      <EvidenceHint card={card} />
      <p className="card-links">
        <Link href={detailHref} className="btn btn-secondary btn-small">
          Vaata kokkuvõtet
        </Link>
        {card.url && (
          // Original Koda source link kept separate (with click tracking).
          <TrackedLink
            href={card.url}
            sessionId={sessionId}
            contentItemId={card.id}
            className="item-source-link"
          >
            Ava algallikas →
          </TrackedLink>
        )}
      </p>
    </article>
  );
}

function Section({
  title,
  sub,
  cards,
  sessionId,
  fromQuery,
}: {
  title: string;
  sub: string;
  cards: ResultCard[];
  sessionId: string | null;
  fromQuery: string;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="results-section">
      <h2>
        {title} <span className="result-count">({cards.length})</span>
      </h2>
      <p className="section-sub">{sub}</p>
      {cards.map((card) => (
        <Card key={card.id} card={card} sessionId={sessionId} fromQuery={fromQuery} />
      ))}
    </section>
  );
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const query = parseSearchParams(params);

  // Analytics: store the search session (filters only, no personal data).
  let sessionId: string | null = null;
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const session = await prisma.searchSession.create({
      data: {
        selectedSector: query.tegevusala.join(",") || null,
        selectedInterests: query.valdkond,
        selectedActivities: query.tegevusala,
        anonymizedIpHash: anonymizeIp(ip),
        userAgentHash: hashUserAgent(h.get("user-agent")),
      },
    });
    sessionId = session.id;
  } catch (e) {
    console.error("Failed to store search session", e);
  }

  const [results, options] = await Promise.all([search(query), getFilterOptions()]);
  const hasResults = results.total > 0;

  // Map selected filter slugs → names for the active-filter summary.
  const nameOf = (opts: { slug: string; name: string }[], slug: string) =>
    opts.find((o) => o.slug === slug)?.name ?? slug;
  const activeFilters = [
    ...query.valdkond.map((s) => nameOf(options.valdkonnad, s)),
    ...query.tegevusala.map((s) => nameOf(options.tegevusalad, s)),
    ...query.tapsustus.map((s) => nameOf(options.tapsustused, s)),
  ];

  // "Muuda otsingut" / detail back-link carry the current selection.
  const editParams = new URLSearchParams();
  if (query.q) editParams.set("q", query.q);
  if (query.valdkond.length) editParams.set("valdkond", query.valdkond.join(","));
  if (query.tegevusala.length) editParams.set("tegevusala", query.tegevusala.join(","));
  if (query.tapsustus.length) editParams.set("tapsustus", query.tapsustus.join(","));
  if (query.type.length) editParams.set("type", query.type.join(","));
  const editQuery = editParams.toString();
  const fromQuery = editQuery;

  // Only background/history rows matched — suggest broadening.
  const onlyContext =
    hasResults && results.achievements.length === 0 && results.positions.length === 0;

  // A few broad topic suggestions for the empty state.
  const topicSuggestions = options.valdkonnad.slice(0, 6);

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <span className="eyebrow">Allikapõhine ülevaade koja tööst</span>
          <h1>{query.q ? `Otsing: „${query.q}"` : "Mida on koda teinud ja öelnud"}</h1>
          <p className="sub">
            Allikapõhine ülevaade koja avalikest töövõitudest, seisukohtadest ja aastaaruannete
            taustast – iga tulemus viitab algallikale.
          </p>
          {(query.q || activeFilters.length > 0) && (
            <div className="filter-summary">
              {query.q && <span className="tag accent">„{query.q}"</span>}
              {activeFilters.map((n) => (
                <span key={n} className="tag">
                  {n}
                </span>
              ))}
            </div>
          )}
          <Link href={`/?${editQuery}#vorm`} className="btn btn-secondary btn-small">
            ← Muuda otsingut
          </Link>
        </div>
      </div>

      <div className="container results-body">
        {hasResults && (
          <p className="results-count-line">
            Leidsime {results.total} sobivat tulemust koja allikatest.
          </p>
        )}

        {onlyContext && (
          <div className="card notice" style={{ marginTop: 16 }}>
            <p>
              Leidsime peamiselt tausta ja teema ajalugu. Proovi laiemat märksõna või eemalda
              filtreid, et näha ka konkreetseid töövõite ja seisukohti.
            </p>
          </div>
        )}

        {!hasResults && (
          <div className="card empty-state" style={{ marginTop: 36 }}>
            <h2>Selle valiku kohta ei leidnud me sobivaid materjale</h2>
            <p>Proovi laiemat otsingut – üldisem märksõna või vähem filtreid.</p>
            {topicSuggestions.length > 0 && (
              <>
                <p className="section-sub">Proovi mõnda laiemat teemat:</p>
                <div className="theme-links">
                  {topicSuggestions.map((t) => (
                    <Link
                      key={t.slug}
                      href={`/tulemused?valdkond=${encodeURIComponent(t.slug)}`}
                      className="theme-link"
                    >
                      {t.name}
                    </Link>
                  ))}
                </div>
              </>
            )}
            <p style={{ marginTop: 16 }}>
              <Link href={`/?${editQuery}#vorm`} className="btn btn-secondary btn-small">
                Muuda otsingut
              </Link>{" "}
              <a
                href="https://www.koda.ee/et/meie-arvamus"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-small"
              >
                Kõik koja seisukohad koda.ee-l
              </a>
            </p>
          </div>
        )}

        <Section
          title="Töövõidud"
          sub="Konkreetsed tulemused ja võidud, mille koda on ettevõtjate jaoks saavutanud."
          cards={results.achievements}
          sessionId={sessionId}
          fromQuery={fromQuery}
        />
        <Section
          title="Koja seisukohad ja selgitused"
          sub="Koja avalikud seisukohad, ettepanekud, hoiatused ja selgitavad uudised."
          cards={results.positions}
          sessionId={sessionId}
          fromQuery={fromQuery}
        />
        <Section
          title="Taust ja teema ajalugu"
          sub="Aastaaruannete kontekst ja koja pikem töö samadel teemadel."
          cards={results.context}
          sessionId={sessionId}
          fromQuery={fromQuery}
        />

        {hasResults && (
          <div className="cta-box cta-box-dark">
            <h2>Miks olla koja liige?</h2>
            <p>
              Kaubandus-Tööstuskoda on Eesti suurim ettevõtjate esindusorganisatsioon, kes kaitseb
              ettevõtjate huve seadusloomes, aitab leida välispartnereid ja väljastab
              väliskaubandusdokumente. Ülaltoodud töö on vaid osa sellest, mida koda ettevõtjate
              heaks teeb.
            </p>
            <a
              href="https://www.koda.ee/et/liikmed/miks-olla-meie-liige"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-small"
            >
              Loe liikmelisuse kohta lähemalt
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
