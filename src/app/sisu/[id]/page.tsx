import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import {
  getContentDetail,
  type ContentDetail,
  type EvidenceRow,
  type WorkWinNestingDetail,
} from "@/lib/content-detail";
import { compactText, isGenericWorkWinUrl, isUnsafePublicDetailText } from "@/lib/content-display";

export const dynamic = "force-dynamic";

function detailHref(detailId: string, from?: string): string {
  return `/sisu/${encodeURIComponent(detailId)}${from ? `?from=${encodeURIComponent(from)}` : ""}`;
}

/**
 * v1.2 nesting/timeline context on a töövõit detail page: a "part of" link to a
 * parent card, the folded series/timeline children, or the full policy-thread
 * timeline (current step highlighted). Each step links to its own detail page.
 */
function WorkWinNestingSection({ nesting, from }: { nesting: WorkWinNestingDetail; from?: string }) {
  const items = nesting.thread ? nesting.thread.items : nesting.children;
  if (!nesting.parent && items.length === 0) return null;
  const heading = nesting.thread
    ? `Sama teema ajajoon${nesting.thread.title ? `: ${nesting.thread.title}` : ""}`
    : "Töövõidu arengud";
  return (
    <section className="card nested-detail">
      {nesting.parent && (
        <p className="thread-parent">
          Kuulub töövõidu juurde:{" "}
          <Link href={detailHref(nesting.parent.detailId, from)}>{nesting.parent.title}</Link>
        </p>
      )}
      {items.length > 0 && (
        <>
          <h2>{heading}</h2>
          <ol className="nested-timeline">
            {items.map((it) => (
              <li key={it.id} className={`nested-item${it.isCurrent ? " nested-current" : ""}`}>
                <p className="nested-meta">
                  {(it.timelineYear || it.displayDate) && (
                    <span className="badge-date">{it.timelineYear ?? it.displayDate}</span>
                  )}
                  {it.timelineStageLabel && <span className="badge nested-stage">{it.timelineStageLabel}</span>}
                  {it.isCurrent && <span className="badge">Praegu vaatad</span>}
                </p>
                <h3>{it.isCurrent ? it.title : <Link href={detailHref(it.detailId, from)}>{it.title}</Link>}</h3>
                {it.summary && <p className="item-excerpt small">{compactText(it.summary, 220)}</p>}
                {it.sourceUrl && !isGenericWorkWinUrl(it.sourceUrl) && (
                  <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" className="item-source-link">
                    Allikas →
                  </a>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function SourceButton({ item }: { item: Pick<ContentDetail, "sourceUrl" | "sourceCtaLabel"> }) {
  // Only show an external source button when there is a specific article/source.
  // The generic koda.ee work-wins listing page is never a useful source link.
  if (!item.sourceUrl || isGenericWorkWinUrl(item.sourceUrl)) return null;
  return (
    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-small">
      {item.sourceCtaLabel}
    </a>
  );
}

function TopicHistory({ rows, from }: { rows: EvidenceRow[]; from?: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <h2>Veel samal teemal</h2>
      <ul className="evidence-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span className="badge">{row.sourceLabel}</span>{" "}
            {row.isPublic ? (
              <Link href={detailHref(row.detailId, from)}>{row.title}</Link>
            ) : (
              <span className="evidence-title">{row.title}</span>
            )}
            {row.displayDate && <span className="badge-date"> · {row.displayDate}</span>}
            {row.summary && <p className="item-excerpt small">{compactText(row.summary, 220)}</p>}
            {row.sourceUrl && (
              <a href={row.sourceUrl} target="_blank" rel="noopener noreferrer" className="item-source-link">
                {row.sourceCtaLabel} →
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AchievementDetail({ item, from }: { item: ContentDetail; from?: string }) {
  // v1 töövõidu value fields (what_changed_ee / koda_role_ee / business_value_ee)
  // are the primary structured content; fall back to the summary when absent.
  const summary = item.summary && !isUnsafePublicDetailText(item.summary) ? item.summary : null;
  const field = item.enrichment?.regulatoryArea || item.valdkonnad[0]?.name || null;

  return (
    <>
      <section className="card achievement-block">
        <h2>Koja töövõit</h2>
        {summary && <p>{summary}</p>}
        <dl className="detail-dl">
          {field && (
            <>
              <dt>Valdkond</dt>
              <dd>{field}</dd>
            </>
          )}
          {item.whatChanged && (
            <>
              <dt>Mis muutus?</dt>
              <dd>{item.whatChanged}</dd>
            </>
          )}
          {item.kodaRole && (
            <>
              <dt>Koja roll</dt>
              <dd>{item.kodaRole}</dd>
            </>
          )}
          {item.businessValue && (
            <>
              <dt>Väärtus ettevõttele</dt>
              <dd>{item.businessValue}</dd>
            </>
          )}
          {item.beforeAfter && (
            <>
              <dt>Enne ja pärast</dt>
              <dd>{item.beforeAfter}</dd>
            </>
          )}
        </dl>
        <SourceButton item={item} />
      </section>
      <TopicHistory rows={item.evidence.topicHistory} from={from} />
    </>
  );
}

function StandardDetail({ item, from }: { item: ContentDetail; from?: string }) {
  const summary = item.summary;
  return (
    <>
      {summary && (
        <section className="card">
          <h2>{item.isNews ? "Uudise kokkuvõte" : "Koja seisukoht ja mõju"}</h2>
          <p>{summary}</p>
          <SourceButton item={item} />
        </section>
      )}

      {!summary && item.sourceUrl && (
        <section className="card">
          <h2>Koda.ee materjal</h2>
          <p>Täistekst on kättesaadav algallikas.</p>
          <SourceButton item={item} />
        </section>
      )}

      <TopicHistory rows={item.evidence.topicHistory} from={from} />
    </>
  );
}

export default async function ContentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const item = await getContentDetail(id);
  if (!item) notFound();
  const admin = await isAdmin();

  const backHref = from ? `/tulemused?${from}` : "/";

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <Link href={backHref} className="btn btn-secondary btn-small">
            ← Tagasi otsingusse
          </Link>
          {admin && (
            <Link href={`/admin/content/${item.id}`} className="admin-edit-link" title="Muuda halduses">
              Muuda
            </Link>
          )}
          <p className="item-meta" style={{ marginTop: 16 }}>
            {item.isAchievement ? (
              <span className="badge win-badge">✓ Töövõit</span>
            ) : (
              <span className="badge">{item.sourceLabel}</span>
            )}
            {item.displayDate && <span className="badge-date">{item.displayDate}</span>}
            {!item.displayDate && item.reportYear && <span className="badge-date">{item.reportYear}</span>}
          </p>
          <h1>{item.title}</h1>
          {(item.valdkonnad.length > 0 ||
            item.tegevusalad.length > 0 ||
            item.laws.length > 0 ||
            item.recipient) && (
            <div className="filter-summary">
              {item.valdkonnad.map((t) => (
                <Link
                  key={`v-${t.slug}`}
                  href={`/tulemused?valdkond=${encodeURIComponent(t.slug)}`}
                  className="tag accent"
                >
                  {t.name}
                </Link>
              ))}
              {item.tegevusalad.map((t) => (
                <Link
                  key={`s-${t.slug}`}
                  href={`/tulemused?tegevusala=${encodeURIComponent(t.slug)}`}
                  className="tag"
                >
                  {t.name}
                </Link>
              ))}
              {item.laws.map((law) => (
                <Link
                  key={`l-${law.slug}`}
                  href={law.hasPage ? `/seadused/${law.slug}` : `/tulemused?q=${encodeURIComponent(law.canonicalName)}`}
                  className="tag tag-law"
                >
                  {law.canonicalName}
                </Link>
              ))}
              {item.recipient && (
                <Link
                  href={`/tulemused?recipient=${encodeURIComponent(item.recipient.slug)}`}
                  className="tag tag-recipient"
                >
                  {item.recipient.name}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="container results-body detail-body">
        {item.isAchievement ? <AchievementDetail item={item} from={from} /> : <StandardDetail item={item} from={from} />}

        {item.workWinNesting && <WorkWinNestingSection nesting={item.workWinNesting} from={from} />}

        <p style={{ marginTop: 24 }}>
          <Link href={backHref} className="btn btn-secondary btn-small">
            ← Tagasi otsingusse
          </Link>{" "}
          <Link href="/" className="btn btn-secondary btn-small">
            Avalehele
          </Link>
        </p>
      </div>
    </main>
  );
}
