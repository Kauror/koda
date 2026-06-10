import Link from "next/link";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { anonymizeIp, hashUserAgent } from "@/lib/hash";
import { ACTIVITIES, INTERESTS, SECTORS, SIZES, optionName } from "@/lib/constants";
import { parseFilters, search, type ResultItem } from "@/lib/ranking";
import TrackedLink from "./TrackedLink";

export const dynamic = "force-dynamic";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  opinion: "Koja arvamus",
  archive_opinion: "Koja arvamus",
  news: "Uudis",
  currently_handled: "Hetkel käsil",
  service: "Teenus",
  event: "Sündmus",
  unknown: "koda.ee",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("et-EE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ItemBlock({ item, sessionId, topicGroupId }: { item: ResultItem; sessionId: string | null; topicGroupId?: string }) {
  const date = formatDate(item.date);
  return (
    <div className="main-item">
      <p className="item-meta">
        {SOURCE_TYPE_LABELS[item.sourceType] ?? "koda.ee"}
        {date ? ` · ${date}` : ""}
      </p>
      <h3>
        <TrackedLink href={item.url} sessionId={sessionId} contentItemId={item.id} topicGroupId={topicGroupId}>
          {item.title}
        </TrackedLink>
      </h3>
      {(item.summary || item.excerpt) && <p className="item-excerpt">{item.summary || item.excerpt}</p>}
    </div>
  );
}

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const filters = parseFilters(params);

  // Analytics: store the search session (filters only, no personal data).
  let sessionId: string | null = null;
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const session = await prisma.searchSession.create({
      data: {
        selectedSector: filters.sector,
        selectedSize: filters.size,
        selectedInterests: filters.interests,
        selectedActivities: filters.activities,
        anonymizedIpHash: anonymizeIp(ip),
        userAgentHash: hashUserAgent(h.get("user-agent")),
      },
    });
    sessionId = session.id;
  } catch (e) {
    console.error("Failed to store search session", e);
  }

  const results = await search(filters);

  const sectorName = optionName(SECTORS, filters.sector);
  const sizeName = optionName(SIZES, filters.size);
  const interestNames = filters.interests
    .map((s) => optionName(INTERESTS, s))
    .filter((n): n is string => !!n);
  const activityNames = filters.activities
    .map((s) => optionName(ACTIVITIES, s))
    .filter((n): n is string => !!n);

  const hasResults = results.groups.length > 0 || results.otherItems.length > 0;

  return (
    <main className="container">
      <div className="results-header">
        <h1>Mida on koda teinud sinu ettevõtte heaks</h1>
        <p className="muted small">
          Ülevaade on koostatud Eesti Kaubandus-Tööstuskoja avalike seisukohtade, uudiste ja
          käsilolevate teemade põhjal.
        </p>
        <div className="filter-summary">
          {sectorName && <span className="tag accent">{sectorName}</span>}
          {sizeName && <span className="tag">{sizeName}</span>}
          {activityNames.map((n) => (
            <span key={n} className="tag">
              {n}
            </span>
          ))}
          {interestNames.map((n) => (
            <span key={n} className="tag">
              {n}
            </span>
          ))}
        </div>
        <Link href="/" className="btn btn-secondary btn-small">
          ← Muuda valikuid
        </Link>
      </div>

      {!hasResults && (
        <div className="card empty-state">
          <p>
            Selle valiku kohta ei leidnud me veel sobivaid materjale. Proovi valida ainult
            tegevusala või vaata kõiki koja seisukohti lehel{" "}
            <a href="https://www.koda.ee/et/meie-arvamus" target="_blank" rel="noopener noreferrer">
              koda.ee
            </a>
            .
          </p>
        </div>
      )}

      {results.groups.map((group) => (
        <section key={group.id} className="topic-card">
          <h2>{group.title}</h2>
          {group.summary && <p className="group-summary">{group.summary}</p>}

          {group.mainItem && (
            <ItemBlock item={group.mainItem} sessionId={sessionId} topicGroupId={group.id} />
          )}

          {group.whyItMatters && (
            <div className="why-box">
              <strong>Miks see on sinu ettevõttele oluline</strong>
              {group.whyItMatters}
            </div>
          )}

          {group.history.length > 0 && (
            <details className="history">
              <summary>Teema ajalugu ({group.history.length})</summary>
              <ul>
                {group.history.map((item) => (
                  <li key={item.id}>
                    <span className="date">{formatDate(item.date) ?? "—"}</span>
                    <TrackedLink
                      href={item.url}
                      sessionId={sessionId}
                      contentItemId={item.id}
                      topicGroupId={group.id}
                    >
                      {item.title}
                    </TrackedLink>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {group.tags.length > 0 && (
            <div className="card-tags">
              {group.tags.map((t) => (
                <span key={`${t.type}-${t.slug}`} className="tag">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </section>
      ))}

      {results.otherItems.length > 0 && (
        <section className="other-items">
          <h2>Veel sinu valikuga seotud materjale</h2>
          {results.otherItems.map((item) => (
            <div key={item.id} className="other-item">
              <p className="item-meta">
                {SOURCE_TYPE_LABELS[item.sourceType] ?? "koda.ee"}
                {formatDate(item.date) ? ` · ${formatDate(item.date)}` : ""}
              </p>
              <h3>
                <TrackedLink href={item.url} sessionId={sessionId} contentItemId={item.id}>
                  {item.title}
                </TrackedLink>
              </h3>
              {(item.summary || item.excerpt) && (
                <p className="item-excerpt small">{item.summary || item.excerpt}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {hasResults && (
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ marginTop: 0, fontSize: "1.15rem", color: "var(--navy-dark)" }}>
            Miks olla koja liige?
          </h2>
          <p className="small">
            Kaubandus-Tööstuskoda on Eesti suurim ettevõtjate esindusorganisatsioon, kes kaitseb
            ettevõtjate huve seadusloomes, aitab leida välispartnereid, väljastab
            väliskaubandusdokumente ja hoiab liikmeid oluliste muudatustega kursis. Ülaltoodud töö
            on vaid osa sellest, mida koda sinu valdkonna ettevõtete heaks teeb.
          </p>
          <a
            href="https://www.koda.ee/et/liikmelisus"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-small"
          >
            Loe liikmelisuse kohta lähemalt
          </a>
        </div>
      )}
    </main>
  );
}
