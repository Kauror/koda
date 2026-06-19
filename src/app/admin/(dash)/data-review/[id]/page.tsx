import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { findContentItem, findReviewCandidate, stringValue } from "@/lib/admin-bundle";
import { DECISIONS_NOT_APPLIED_NOTICE } from "@/lib/admin-review-ui";

export const dynamic = "force-dynamic";

function lines(values?: string[] | null): string {
  return values && values.length > 0 ? values.join("\n") : "";
}

function tags(values?: string[] | null): string {
  return values && values.length > 0 ? values.join(", ") : "—";
}

export default async function AdminDataReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidateResult = findReviewCandidate(decodeURIComponent(id));
  if (!candidateResult.ok) {
    return (
      <>
        <p>
          <Link href="/admin/data-review">← Tagasi ülevaatusse</Link>
        </p>
        <h1>Ülevaatuse kandidaat</h1>
        <div className="card notice">
          <p>{candidateResult.error}</p>
        </div>
      </>
    );
  }
  if (!candidateResult.data) notFound();

  const candidate = candidateResult.data;
  const [decision, contentResult] = await Promise.all([
    prisma.dataReviewDecision.findUnique({ where: { candidateId: candidate.candidateId } }),
    candidate.contentId ? Promise.resolve(findContentItem(candidate.contentId)) : Promise.resolve(null),
  ]);
  const contentItem = contentResult?.ok ? contentResult.data : null;

  const approvedValdkonnad = Array.isArray(decision?.approvedValdkonnad)
    ? (decision?.approvedValdkonnad as string[])
    : candidate.suggestedValdkond;
  const approvedTegevusalad = Array.isArray(decision?.approvedTegevusalad)
    ? (decision?.approvedTegevusalad as string[])
    : candidate.suggestedTegevusala;
  const approvedTapsustused = Array.isArray(decision?.approvedTapsustused)
    ? (decision?.approvedTapsustused as string[])
    : candidate.suggestedTapsustus;

  return (
    <>
      <p>
        <Link href="/admin/data-review" className="btn btn-secondary btn-small">
          ← Tagasi ülevaatusse
        </Link>
      </p>
      <h1>{candidate.title || candidate.candidateId}</h1>
      <p className="section-sub">
        Kandidaat: {candidate.candidateId} · otsus: {decision?.decision ?? "undecided"}
      </p>

      <div className="card notice">
        <p style={{ margin: 0 }}>
          <strong>{DECISIONS_NOT_APPLIED_NOTICE}</strong>
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Soovitus</h2>
        <table className="admin-table">
          <tbody>
            <tr>
              <td>Soovitatud tegevus</td>
              <td>{candidate.recommendedAction || "—"}</td>
            </tr>
            <tr>
              <td>Kindlus</td>
              <td>{candidate.confidence || "—"}</td>
            </tr>
            <tr>
              <td>Reegli allikas</td>
              <td>{candidate.ruleSource || "—"}</td>
            </tr>
            <tr>
              <td>Tõend / märksõnad</td>
              <td>{candidate.evidence || "—"}</td>
            </tr>
            <tr>
              <td>Ülevaatuse märkus</td>
              <td>{candidate.reviewNote || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sisu andmepaketis</h2>
        {contentItem ? (
          <>
            <p>
              <strong>{contentItem.displayTitle || contentItem.title || contentItem.externalId}</strong>
            </p>
            <p className="muted small">
              {contentItem.sourceDataset} · {contentItem.sourceLayer} · {contentItem.sourceTypeDetail}
            </p>
            {contentItem.canonicalUrl && (
              <p className="small" style={{ wordBreak: "break-all" }}>
                <a href={contentItem.canonicalUrl} target="_blank" rel="noopener noreferrer">
                  {contentItem.canonicalUrl}
                </a>
              </p>
            )}
            {stringValue(contentItem.summary) && <p>{stringValue(contentItem.summary)}</p>}
            {stringValue(contentItem.companyRelevance) && (
              <p className="muted small">
                <strong>Ettevõtte seos:</strong> {stringValue(contentItem.companyRelevance)}
              </p>
            )}
          </>
        ) : (
          <p className="muted">Sobivat sisurida ei leitud content_items.jsonl failist.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Praegused ja soovitatud sildid</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Väli</th>
              <th>Praegune</th>
              <th>Soovitatud</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Valdkond</td>
              <td>{tags(candidate.currentValdkond)}</td>
              <td>{tags(candidate.suggestedValdkond)}</td>
            </tr>
            <tr>
              <td>Tegevusala</td>
              <td>{tags(candidate.currentTegevusala)}</td>
              <td>{tags(candidate.suggestedTegevusala)}</td>
            </tr>
            <tr>
              <td>Täpsustus</td>
              <td>{tags(candidate.currentTapsustus)}</td>
              <td>{tags(candidate.suggestedTapsustus)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <form method="post" action={`/api/admin/data-review/${encodeURIComponent(candidate.candidateId)}`} className="card form-grid">
        <h2 style={{ marginTop: 0 }}>Salvesta ülevaatuse otsus</h2>
        <input type="hidden" name="contentExternalId" value={candidate.contentId || ""} />
        <input type="hidden" name="contentTitle" value={candidate.title || ""} />
        <input type="hidden" name="contentUrl" value={candidate.url || ""} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <div>
            <label className="field-label" htmlFor="approvedValdkonnad">
              Kinnitatud valdkonnad
            </label>
            <textarea id="approvedValdkonnad" name="approvedValdkonnad" defaultValue={lines(approvedValdkonnad)} />
          </div>
          <div>
            <label className="field-label" htmlFor="approvedTegevusalad">
              Kinnitatud tegevusalad
            </label>
            <textarea id="approvedTegevusalad" name="approvedTegevusalad" defaultValue={lines(approvedTegevusalad)} />
          </div>
          <div>
            <label className="field-label" htmlFor="approvedTapsustused">
              Kinnitatud täpsustused
            </label>
            <textarea id="approvedTapsustused" name="approvedTapsustused" defaultValue={lines(approvedTapsustused)} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div>
            <label className="field-label" htmlFor="approvedPublicPriority">
              Avalik prioriteet
            </label>
            <input id="approvedPublicPriority" name="approvedPublicPriority" type="number" defaultValue={decision?.approvedPublicPriority ?? ""} />
          </div>
          <div>
            <label className="field-label" htmlFor="approvedSectorWeight">
              Tegevusala kaal
            </label>
            <input id="approvedSectorWeight" name="approvedSectorWeight" type="number" step="0.1" defaultValue={decision?.approvedSectorWeight ?? ""} />
          </div>
          <div>
            <label className="field-label" htmlFor="approvedTopicWeight">
              Teema kaal
            </label>
            <input id="approvedTopicWeight" name="approvedTopicWeight" type="number" step="0.1" defaultValue={decision?.approvedTopicWeight ?? ""} />
          </div>
          <div>
            <label className="field-label" htmlFor="approvedGeneralWeight">
              Üldkaal
            </label>
            <input id="approvedGeneralWeight" name="approvedGeneralWeight" type="number" step="0.1" defaultValue={decision?.approvedGeneralWeight ?? ""} />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
          <div>
            <label className="field-label" htmlFor="reviewerName">
              Ülevaataja
            </label>
            <input id="reviewerName" name="reviewerName" type="text" defaultValue={decision?.reviewerName ?? ""} />
          </div>
          <div>
            <label className="field-label" htmlFor="reviewerNote">
              Märkus
            </label>
            <textarea id="reviewerNote" name="reviewerNote" defaultValue={decision?.reviewerNote ?? ""} />
          </div>
        </div>

        <div className="card-links">
          <button type="submit" name="decision" value="approved" className="btn btn-small">
            Kinnita soovitus
          </button>
          <button type="submit" name="decision" value="rejected" className="btn btn-secondary btn-small">
            Lükka tagasi
          </button>
          <button type="submit" name="decision" value="needs_review" className="btn btn-secondary btn-small">
            Vajab käsitsi ülevaatust
          </button>
        </div>
      </form>

      <details className="card">
        <summary>Algne kandidaadi JSON</summary>
        <pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {JSON.stringify(candidate, null, 2)}
        </pre>
      </details>
    </>
  );
}
