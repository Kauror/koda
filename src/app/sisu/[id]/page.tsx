import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentDetail, type ContentDetail, type EvidenceRow } from "@/lib/content-detail";
import { compactText, isGenericWorkWinUrl, isUnsafePublicDetailText } from "@/lib/content-display";

export const dynamic = "force-dynamic";

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

function TopicHistory({ rows }: { rows: EvidenceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <h2>Veel samal teemal</h2>
      <ul className="evidence-list">
        {rows.map((row) => (
          <li key={row.id}>
            <span className="badge">{row.sourceLabel}</span>{" "}
            {row.isPublic ? (
              <Link href={`/sisu/${encodeURIComponent(row.detailId)}`}>{row.title}</Link>
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

function AchievementDetail({ item }: { item: ContentDetail }) {
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
      <TopicHistory rows={item.evidence.topicHistory} />
    </>
  );
}

function StandardDetail({ item }: { item: ContentDetail }) {
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

      <TopicHistory rows={item.evidence.topicHistory} />
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

  const backHref = from ? `/tulemused?${from}` : "/";

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <Link href={backHref} className="btn btn-secondary btn-small">
            ← Tagasi otsingusse
          </Link>
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
        {item.isAchievement ? <AchievementDetail item={item} /> : <StandardDetail item={item} />}

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
