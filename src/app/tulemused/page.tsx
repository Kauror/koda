import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { anonymizeIp, hashUserAgent } from "@/lib/hash";
import {
  getFilterOptions,
  parseSearchParams,
  search,
  type FilterOptions,
  type NestedWorkWinCard,
  type ResultCard,
  type SearchResults,
} from "@/lib/search";
import { isGenericWorkWinUrl } from "@/lib/content-display";
import TrackedLink from "./TrackedLink";

export const dynamic = "force-dynamic";

/**
 * Compact nested/timeline section under a parent or policy-thread töövõit card
 * (v1.2). Series/timeline rows render here, never as flat top-level cards. Open
 * by default for thread cards (the timeline is the card's whole content);
 * collapsed under a normal parent card so the default list stays uncluttered.
 */
function NestedWorkWins({
  items,
  heading,
  open,
  fromQuery,
}: {
  items: NestedWorkWinCard[];
  heading: string;
  open: boolean;
  fromQuery: string;
}) {
  if (items.length === 0) return null;
  return (
    <details className="nested-section" open={open}>
      <summary>
        {heading} <span className="result-count">({items.length})</span>
      </summary>
      <ol className="nested-timeline">
        {items.map((item) => {
          const href = `/sisu/${encodeURIComponent(item.detailId)}${
            fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""
          }`;
          return (
            <li key={item.id} className={`nested-item${item.matched ? " nested-matched" : ""}`}>
              <p className="nested-meta">
                {(item.timelineYear || item.displayDate) && (
                  <span className="badge-date">{item.timelineYear ?? item.displayDate}</span>
                )}
                {item.timelineStageLabel && <span className="badge nested-stage">{item.timelineStageLabel}</span>}
              </p>
              <h4>
                <Link href={href}>{item.title}</Link>
              </h4>
              {item.summary && <p className="item-excerpt small">{item.summary}</p>}
              {item.url && !isGenericWorkWinUrl(item.url) && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="item-source-link">
                  Allikas →
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function Badges({ card }: { card: ResultCard }) {
  // card.displayDate is the safe public date (placeholder/import/future dates are
  // suppressed by the public-date gate); never format card.date raw here.
  if (card.badges.length === 0 && !card.displayDate) return null;
  return (
    <p className="item-meta">
      {card.badges.map((badge) => (
        <span key={badge} className={`badge${badge === "Töövõit" ? " win-badge" : ""}`}>
          {badge === "Töövõit" ? `✓ ${badge}` : badge}
        </span>
      ))}
      {card.displayDate && <span className="badge-date">{card.displayDate}</span>}
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
  // A policy-thread card groups several timeline rows: its title is not a single
  // detail page, so it reads as a group and exposes its timeline (the nested
  // items each link to their own detail page).
  const isThread = !!card.isThread;
  return (
    <article
      className={`other-item${card.isAchievement ? " win" : ""}${compact ? " compact-result" : ""}${
        isThread ? " thread-card" : ""
      }`}
    >
      <Badges card={card} />
      <h3>{isThread ? card.title : <Link href={detailHref}>{card.title}</Link>}</h3>
      {card.summary && <p className="item-excerpt small">{card.summary}</p>}
      {!compact && (card.laws.length > 0 || card.recipient) && (
        <div className="card-tags">
          {card.laws.map((law) => (
            <Link
              key={law.slug}
              href={law.hasPage ? `/seadused/${law.slug}` : `/tulemused?q=${encodeURIComponent(law.canonicalName)}`}
              className="tag tag-law"
            >
              {law.canonicalName}
            </Link>
          ))}
          {card.recipient && (
            <Link
              href={`/tulemused?recipient=${encodeURIComponent(card.recipient.slug)}`}
              className="tag tag-recipient"
            >
              {card.recipient.name}
            </Link>
          )}
        </div>
      )}
      {!isThread && (
        <p className="card-links">
          <Link href={detailHref} className="btn btn-secondary btn-small">
            Loe lähemalt
          </Link>
          {/* Töövõit and news cards keep a single internal CTA: their external
              source is either the generic koda.ee work-wins listing (useless) or a
              duplicate of the detail page. Opinions/context keep a specific source
              link, but never the generic work-wins URL. */}
          {card.url && !card.isAchievement && card.kind !== "uudis" && !isGenericWorkWinUrl(card.url) && (
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
      )}
      {/* v1.2: nested/timeline children fold in here, never as flat cards. */}
      {card.nested && card.nested.length > 0 && (
        <NestedWorkWins
          items={card.nested}
          heading={card.nestedHeading ?? "Seotud arengud"}
          open={isThread}
          fromQuery={fromQuery}
        />
      )}
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

  const headersPromise = headers();
  const sessionPromise = headersPromise
    .then(async (h) => {
    const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || null;
      return prisma.searchSession.create({
      data: {
        selectedSector: query.tegevusala.join(",") || null,
        selectedInterests: query.valdkond,
        selectedActivities: query.tegevusala,
        anonymizedIpHash: anonymizeIp(ip),
        userAgentHash: hashUserAgent(h.get("user-agent")),
      },
    });
    })
    .catch((error) => {
      console.error("Failed to store search session", error);
      return null;
    });

  const resultsPromise = search(query).catch((error) => {
    console.error("Search failed", error);
    return null;
  });
  const optionsPromise = getFilterOptions().catch((error) => {
    console.error("Failed to load filter options", error);
    return { valdkonnad: [], tegevusalad: [], tapsustused: [], recipients: [] } satisfies FilterOptions;
  });
  const [session, results, options] = await Promise.all([sessionPromise, resultsPromise, optionsPromise]);
  const sessionId = session?.id ?? null;

  if (!results) {
    return (
      <main>
        <div className="container results-body">
          <div className="card empty-state" style={{ marginTop: 36 }}>
            <h2>Otsing pole hetkel saadaval</h2>
            <p>Midagi läks valesti. Palun proovi mõne hetke pärast uuesti.</p>
            <p style={{ marginTop: 16 }}>
              <Link href="/" className="btn btn-secondary btn-small">
                Avalehele
              </Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  const hasResults = results.totalDisplayed > 0;

  const nameOf = (opts: { slug: string; name: string }[], slug: string) =>
    opts.find((option) => option.slug === slug)?.name ?? slug;
  // Recipient/ministry is not a search-form filter, but a recipient-filtered view
  // (reached by clicking a recipient chip) is echoed here so the active filter is
  // visible. The form still offers no recipient checkbox.
  const activeFilters = [
    ...query.valdkond.map((slug) => nameOf(options.valdkonnad, slug)),
    ...query.tegevusala.map((slug) => nameOf(options.tegevusalad, slug)),
    ...query.tapsustus.map((slug) => nameOf(options.tapsustused, slug)),
    ...query.recipient.map((slug) => nameOf(options.recipients, slug)),
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
          initialVisibleCount={2}
        />
        <Section
          title="Koja uudised"
          cards={results.news}
          sessionId={sessionId}
          fromQuery={fromQuery}
          initialVisibleCount={2}
        />
        <Section
          title="Veel samal teemal"
          cards={results.context}
          sessionId={sessionId}
          fromQuery={fromQuery}
          initialVisibleCount={2}
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
