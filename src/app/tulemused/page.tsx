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
      {card.badges.map((badge) => (
        <span key={badge} className={`badge${badge === "Töövõit" ? " win-badge" : ""}`}>
          {badge === "Töövõit" ? `✓ ${badge}` : badge}
        </span>
      ))}
      {formatDate(card.date) && <span className="badge-date">{formatDate(card.date)}</span>}
    </p>
  );
}

function Card({
  card,
  sessionId,
  fromQuery,
  compact,
}: {
  card: ResultCard;
  sessionId: string | null;
  fromQuery: string;
  compact?: boolean;
}) {
  const detailHref = `/sisu/${encodeURIComponent(card.detailId)}${
    fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""
  }`;
  return (
    <article className={`other-item${card.isAchievement ? " win" : ""}${compact ? " compact-result" : ""}`}>
      <Badges card={card} />
      <h3>
        <Link href={detailHref}>{card.title}</Link>
      </h3>
      {card.summary && <p className="item-excerpt small">{card.summary}</p>}
      {!compact && (card.valdkonnad.length > 0 || card.tegevusalad.length > 0) && (
        <div className="card-tags">
          {card.valdkonnad.slice(0, 3).map((tag) => (
            <span key={`v-${tag.slug}`} className="tag">
              {tag.name}
            </span>
          ))}
          {card.tegevusalad.slice(0, 2).map((tag) => (
            <span key={`s-${tag.slug}`} className="tag tag-muted">
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <p className="card-links">
        <Link href={detailHref} className="btn btn-secondary btn-small">
          Vaata kokkuvõtet
        </Link>
        {card.url && (
          <TrackedLink
            href={card.url}
            sessionId={sessionId}
            contentItemId={card.id}
            className="item-source-link"
          >
            {card.sourceCtaLabel} →
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
  compactAchievements = false,
  initialVisibleCount,
}: {
  title: string;
  sub?: string;
  cards: ResultCard[];
  sessionId: string | null;
  fromQuery: string;
  compactAchievements?: boolean;
  initialVisibleCount?: number;
}) {
  if (cards.length === 0) return null;
  const visibleLimit = compactAchievements ? 2 : initialVisibleCount ?? cards.length;
  const visibleCards = cards.slice(0, visibleLimit);
  const hiddenCards = cards.slice(visibleLimit);

  return (
    <section className="results-section">
      <h2>
        {title} <span className="result-count">({cards.length})</span>
      </h2>
      {sub && <p className="section-sub">{sub}</p>}
      {visibleCards.map((card) => (
        <Card
          key={card.id}
          card={card}
          sessionId={sessionId}
          fromQuery={fromQuery}
          compact={compactAchievements}
        />
      ))}
      {hiddenCards.length > 0 && (
        <details className="results-more">
          <summary>Näita rohkem ({hiddenCards.length})</summary>
          {hiddenCards.map((card) => (
            <Card
              key={card.id}
              card={card}
              sessionId={sessionId}
              fromQuery={fromQuery}
              compact={compactAchievements}
            />
          ))}
        </details>
      )}
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
  } catch (error) {
    console.error("Failed to store search session", error);
  }

  const [results, options] = await Promise.all([search(query), getFilterOptions()]);
  const hasResults = results.totalDisplayed > 0;

  const nameOf = (opts: { slug: string; name: string }[], slug: string) =>
    opts.find((option) => option.slug === slug)?.name ?? slug;
  const activeFilters = [
    ...query.valdkond.map((slug) => nameOf(options.valdkonnad, slug)),
    ...query.tegevusala.map((slug) => nameOf(options.tegevusalad, slug)),
    ...query.tapsustus.map((slug) => nameOf(options.tapsustused, slug)),
  ];

  const editParams = new URLSearchParams();
  if (query.q) editParams.set("q", query.q);
  if (query.valdkond.length) editParams.set("valdkond", query.valdkond.join(","));
  if (query.tegevusala.length) editParams.set("tegevusala", query.tegevusala.join(","));
  if (query.tapsustus.length) editParams.set("tapsustus", query.tapsustus.join(","));
  if (query.type.length) editParams.set("type", query.type.join(","));
  const editQuery = editParams.toString();
  const fromQuery = editQuery;
  const onlyContext =
    hasResults &&
    results.achievements.length === 0 &&
    results.positions.length === 0 &&
    results.news.length === 0;
  const topicSuggestions = options.valdkonnad.slice(0, 6);

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <span className="eyebrow">Ülevaade koja tööst</span>
          <h1>{query.q ? `Otsing: „${query.q}"` : "Mida on koda teinud ja öelnud"}</h1>
          <p className="sub">
            Siit saad mugavalt otsida Sind huvitavaid Eesti Kaubandus-Tööstuskoja töövõite,
            koja seisukohti ja teemade teemasid millega koda on läbi aastate tegelenud.
          </p>
          {(query.q || activeFilters.length > 0) && (
            <div className="filter-summary">
              {query.q && <span className="tag accent">„{query.q}"</span>}
              {activeFilters.map((name) => (
                <span key={name} className="tag">
                  {name}
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
        {results.recognizedLaw && (
          <div className="card notice" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>
              Tuvastasime õigusakti{" "}
              <Link href={`/seadused/${results.recognizedLaw.slug}`}>
                <strong>{results.recognizedLaw.canonicalName}</strong>
              </Link>
              . Näitame koja seotud tööd ja seisukohti, uuemad eespool.
            </p>
          </div>
        )}

        {results.includesRelatedSectorMatches && (
          <div className="card notice" style={{ marginTop: 16 }}>
            <p>Näitan ka valdkondadeüleseid tulemusi, mis on valitud tegevusalaga seotud.</p>
          </div>
        )}

        {onlyContext && (
          <div className="card notice" style={{ marginTop: 16 }}>
            <p>
              Leidsime peamiselt tausta ja teema ajalugu. Proovi laiemat märksõna või eemalda
              filtreid, et näha ka konkreetseid töövõite, seisukohti ja uudiseid.
            </p>
          </div>
        )}

        {!hasResults && (
          <div className="card empty-state" style={{ marginTop: 36 }}>
            <h2>Selle valiku kohta ei leidnud me sobivaid materjale</h2>
            <p>Proovi laiemat otsingut - üldisem märksõna või vähem filtreid.</p>
            {topicSuggestions.length > 0 && (
              <>
                <p className="section-sub">Proovi mõnda laiemat teemat:</p>
                <div className="theme-links">
                  {topicSuggestions.map((topic) => (
                    <Link
                      key={topic.slug}
                      href={`/tulemused?valdkond=${encodeURIComponent(topic.slug)}`}
                      className="theme-link"
                    >
                      {topic.name}
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
          compactAchievements
        />
        <Section
          title="Koja seisukohad"
          cards={results.positions}
          sessionId={sessionId}
          fromQuery={fromQuery}
          initialVisibleCount={5}
        />
        <Section
          title="Koja uudised"
          cards={results.news}
          sessionId={sessionId}
          fromQuery={fromQuery}
          initialVisibleCount={5}
        />
        <Section
          title="Veel samal teemal"
          cards={results.context}
          sessionId={sessionId}
          fromQuery={fromQuery}
          initialVisibleCount={5}
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
