import Link from "next/link";
import { isGenericWorkWinUrl } from "@/lib/content-display";
import type { NestedRelatedCard, NestedWorkWinCard, ResultCard } from "@/lib/search";
import TrackedLink from "./tulemused/TrackedLink";

function nestedToggleLabel(count: number, isThread: boolean): string {
  if (isThread) {
    const noun = count === 1 ? "ajajoone kirje" : "ajajoone kirjet";
    return `Näita ajajoont · ${count} ${noun}`;
  }
  const noun = count === 1 ? "seotud etapp" : "seotud etappi";
  return `Näita seotud etappe · ${count} ${noun}`;
}

function NestedWorkWins({
  items,
  isThread,
  fromQuery,
}: {
  items: NestedWorkWinCard[];
  isThread: boolean;
  fromQuery: string;
}) {
  if (items.length === 0) return null;
  return (
    <details className="nested-section">
      <summary>{nestedToggleLabel(items.length, isThread)}</summary>
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
                  Loe lähemalt →
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function NestedRelatedItems({
  items,
  fromQuery,
  sessionId,
}: {
  items: NestedRelatedCard[];
  fromQuery: string;
  sessionId: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <div className="nested-section related-source-section">
      <p className="nested-related-heading">Seotud allikad</p>
      <ol className="nested-timeline">
        {items.map((item) => {
          const href = `/sisu/${encodeURIComponent(item.detailId)}${
            fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""
          }`;
          return (
            <li key={item.id} className="nested-item">
              <p className="nested-meta">
                <span className="badge">{item.badge}</span>
                {item.displayDate && <span className="badge-date">{item.displayDate}</span>}
              </p>
              <h4>
                <Link href={href}>{item.title}</Link>
              </h4>
              {item.summary && <p className="item-excerpt small">{item.summary}</p>}
              {item.url && !isGenericWorkWinUrl(item.url) && (
                <TrackedLink href={item.url} sessionId={sessionId} contentItemId={item.id} className="item-source-link">
                  {item.sourceCtaLabel} →
                </TrackedLink>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Badges({ card }: { card: ResultCard }) {
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

export default function PublicResultCard({
  card,
  sessionId,
  fromQuery,
  admin,
  compact,
}: {
  card: ResultCard;
  sessionId: string | null;
  fromQuery: string;
  admin: boolean;
  compact?: boolean;
}) {
  const detailHref = `/sisu/${encodeURIComponent(card.detailId)}${
    fromQuery ? `?from=${encodeURIComponent(fromQuery)}` : ""
  }`;
  const isThread = !!card.isThread;

  return (
    <article
      className={`other-item${card.isAchievement ? " win" : ""}${compact ? " compact-result" : ""}${
        isThread ? " thread-card" : ""
      }`}
    >
      <Badges card={card} />
      {admin && !card.isThread && (
        <Link href={`/admin/content/${card.id}`} className="admin-edit-link" title="Muuda halduses">
          Muuda
        </Link>
      )}
      <h3>
        <Link href={detailHref}>{card.title}</Link>
      </h3>
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
      <p className="card-links">
        <Link href={detailHref} className="btn btn-secondary btn-small">
          Loe lähemalt
        </Link>
        {card.sourcePdfUrl && (
          <a
            href={card.sourcePdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="item-source-link"
          >
            Vaata pöördumist →
          </a>
        )}
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
      {card.nested && card.nested.length > 0 && (
        <NestedWorkWins items={card.nested} isThread={isThread} fromQuery={fromQuery} />
      )}
      {card.relatedItems && card.relatedItems.length > 0 && (
        <NestedRelatedItems items={card.relatedItems} fromQuery={fromQuery} sessionId={sessionId} />
      )}
    </article>
  );
}
