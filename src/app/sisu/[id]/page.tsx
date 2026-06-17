import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentDetail, type EvidenceRow } from "@/lib/content-detail";

export const dynamic = "force-dynamic";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("et-EE", { day: "numeric", month: "long", year: "numeric" });
}

function EvidenceList({
  title,
  note,
  rows,
  secondary,
}: {
  title: string;
  note?: string;
  rows: EvidenceRow[];
  secondary?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className={`card evidence-block${secondary ? " evidence-secondary" : ""}`}>
      <h2>{title}</h2>
      {note && <p className="section-sub">{note}</p>}
      <ul className="evidence-list">
        {rows.map((r) => (
          <li key={r.id}>
            <span className="badge">{r.sourceLabel}</span>{" "}
            {r.isPublic ? (
              <Link href={`/sisu/${encodeURIComponent(r.detailId)}`}>{r.title}</Link>
            ) : (
              <span className="evidence-title">{r.title}</span>
            )}
            {formatDate(r.date) && <span className="badge-date"> · {formatDate(r.date)}</span>}
            {r.summary && <p className="item-excerpt small">{r.summary}</p>}
            {r.sourceUrl && (
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="item-source-link">
                Vaata allikat →
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
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
  const hasEvidence =
    item.evidence.annualContext.length +
      item.evidence.relatedOpinions.length +
      item.evidence.topicHistory.length +
      item.evidence.duplicates.length >
    0;

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <Link href={backHref} className="btn btn-secondary btn-small">
            ← Tagasi otsingusse
          </Link>
          <p className="item-meta" style={{ marginTop: 16 }}>
            {item.isAchievement ? (
              <span className="badge win-badge">✔ Töövõit</span>
            ) : (
              <span className="badge">{item.sourceLabel}</span>
            )}
            {item.outcomeLabel && <span className="badge">{item.outcomeLabel}</span>}
            {formatDate(item.date) && <span className="badge-date">{formatDate(item.date)}</span>}
            {!item.date && item.reportYear && <span className="badge-date">{item.reportYear}</span>}
          </p>
          <h1>{item.title}</h1>
          {(item.valdkonnad.length > 0 || item.tegevusalad.length > 0) && (
            <div className="filter-summary">
              {item.valdkonnad.map((t) => (
                <span key={`v-${t.slug}`} className="tag accent">
                  {t.name}
                </span>
              ))}
              {item.tegevusalad.map((t) => (
                <span key={`s-${t.slug}`} className="tag">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="container results-body detail-body">
        {item.summary && (
          <section className="card">
            <h2>Allikapõhine kokkuvõte</h2>
            <p className="detail-lead">{item.summary}</p>
          </section>
        )}

        {item.enrichment && (
          <section className="card achievement-block">
            <h2>✔ Konkreetne töövõit</h2>
            <dl className="detail-dl">
              {item.enrichment.outcome && (
                <>
                  <dt>Tulemus</dt>
                  <dd>{item.enrichment.outcome}</dd>
                </>
              )}
              {item.enrichment.regulatoryArea && (
                <>
                  <dt>Valdkond / regulatsioon</dt>
                  <dd>{item.enrichment.regulatoryArea}</dd>
                </>
              )}
              {item.enrichment.valueType && (
                <>
                  <dt>Väärtuse tüüp</dt>
                  <dd>{item.enrichment.valueType}</dd>
                </>
              )}
              {item.enrichment.kodaRole && (
                <>
                  <dt>Koja roll</dt>
                  <dd>{item.enrichment.kodaRole}</dd>
                </>
              )}
              {item.enrichment.numericImpactStatement && (
                <>
                  <dt>Mõju</dt>
                  <dd>{item.enrichment.numericImpactStatement}</dd>
                </>
              )}
            </dl>
            {item.enrichment.sourceEvidence && (
              <p className="item-excerpt small">
                <strong>Allika põhjal:</strong> {item.enrichment.sourceEvidence}
              </p>
            )}
          </section>
        )}

        {item.companyRelevance && (
          <section className="card">
            <h2>Miks see ettevõtjale oluline on?</h2>
            <p>{item.companyRelevance}</p>
          </section>
        )}

        {(item.kodaPosition || item.sourceEvidence || item.excerpt || item.bodySnippet) && (
          <section className="card">
            <h2>Koja seisukoht ja mõju</h2>
            {item.kodaPosition && <p>{item.kodaPosition}</p>}
            {item.sourceEvidence && (
              <p className="item-excerpt small">
                <strong>Allika põhjal:</strong> {item.sourceEvidence}
              </p>
            )}
            {!item.kodaPosition && (item.excerpt || item.bodySnippet) && (
              <p className="item-excerpt small muted">{item.excerpt || item.bodySnippet}</p>
            )}
          </section>
        )}

        <section className="card">
          <h2>Algallikas</h2>
          <dl className="detail-dl">
            <dt>Allika tüüp</dt>
            <dd>
              {item.sourceLabel} · {item.datasetLabel}
            </dd>
            {item.sourceSection && (
              <>
                <dt>Sektsioon</dt>
                <dd>{item.sourceSection}</dd>
              </>
            )}
            {item.reportYear && (
              <>
                <dt>Aruande aasta</dt>
                <dd>{item.reportYear}</dd>
              </>
            )}
            {item.sourceFileName && (
              <>
                <dt>Allikafail</dt>
                <dd>{item.sourceFileName}</dd>
              </>
            )}
          </dl>
          {item.sourceUrl ? (
            <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-small">
              Vaata allikat koda.ee-l →
            </a>
          ) : (
            <p className="muted small">Avalik allikalink puudub (toetav allikas).</p>
          )}
          {item.canonicalUrl && item.canonicalUrl !== item.sourceUrl && (
            <p className="muted small">
              Püsilink:{" "}
              <a href={item.canonicalUrl} target="_blank" rel="noopener noreferrer">
                {item.canonicalUrl}
              </a>
            </p>
          )}
        </section>

        {hasEvidence && <h2 className="evidence-heading">Seotud allikad ja taust</h2>}
        <EvidenceList
          title="Aastaaruande kontekst"
          note="Koja aastaaruannetest pärinev taust samal teemal."
          rows={item.evidence.annualContext}
        />
        <EvidenceList
          title="Toetavad arvamused"
          note="Koja arvamuskirjad samal teemal – toetav taustamaterjal, mitte eraldi avalik tulemus."
          rows={item.evidence.relatedOpinions}
          secondary
        />
        <EvidenceList
          title="Teema ajalugu"
          note="Varasem koja töö samal teemal."
          rows={item.evidence.topicHistory}
        />
        <EvidenceList
          title="Seotud / duplikaatkirjed"
          rows={item.evidence.duplicates}
        />

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
