import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  computeReviewProgress,
  filterReviewCandidates,
  readReviewCandidates,
  stringValue,
  tagValues,
  uniqueValues,
} from "@/lib/admin-bundle";
import { DECISIONS_NOT_APPLIED_NOTICE } from "@/lib/admin-review-ui";
import MissingBundleNotice from "../_components/MissingBundleNotice";
import ReviewProgressCard from "../_components/ReviewProgressCard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const DEFAULT_DECISION_FILTER = "undecided";

type Params = {
  q?: string;
  decision?: string;
  confidence?: string;
  recommendedAction?: string;
  currentValdkond?: string;
  suggestedValdkond?: string;
  currentTegevusala?: string;
  suggestedTegevusala?: string;
  leht?: string;
};

function chips(values?: string[]): string {
  return values && values.length > 0 ? values.join(", ") : "—";
}

function hrefFor(params: Params, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "leht") continue;
    if (value) search.set(key, value);
  }
  search.set("leht", String(page));
  return `/admin/data-review?${search.toString()}`;
}

export default async function AdminDataReviewPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const bundle = readReviewCandidates();

  if (!bundle.ok) {
    return (
      <>
        <h1>Andmeülevaatus</h1>
        <ReviewProgressCard progress={null} />
        <MissingBundleNotice error={bundle.error} />
      </>
    );
  }

  const decisions = await prisma.dataReviewDecision.findMany({
    select: { candidateId: true, decision: true, reviewerName: true, updatedAt: true },
  });
  const decisionByCandidateId = new Map(decisions.map((row) => [row.candidateId, row.decision]));
  const progress = computeReviewProgress(
    bundle.data.map((row) => row.candidateId),
    decisionByCandidateId,
  );
  const decisionFilter = params.decision ?? DEFAULT_DECISION_FILTER;
  const { rows, pagination } = filterReviewCandidates(
    bundle.data,
    {
      ...params,
      decision: decisionFilter,
      page: parseInt(params.leht || "1", 10) || 1,
      pageSize: PAGE_SIZE,
    },
    decisionByCandidateId,
  );

  const confidenceOptions = uniqueValues(bundle.data, "confidence");
  const actionOptions = uniqueValues(bundle.data, "recommendedAction");
  const currentValdkondOptions = tagValues(bundle.data, "currentValdkond");
  const suggestedValdkondOptions = tagValues(bundle.data, "suggestedValdkond");
  const currentTegevusalaOptions = tagValues(bundle.data, "currentTegevusala");
  const suggestedTegevusalaOptions = tagValues(bundle.data, "suggestedTegevusala");

  return (
    <>
      <h1>Andmeülevaatus ({progress.total})</h1>

      <div className="card notice">
        <p style={{ margin: 0 }}>
          <strong>{DECISIONS_NOT_APPLIED_NOTICE}</strong>
        </p>
      </div>

      <ReviewProgressCard progress={progress} />

      <div className="card">
        <p className="section-sub">
          Need on taksonoomia ja kategooria soovitused andmepaketist. Otsuse salvestamine ei muuda avalikku sisu.
        </p>
        <div className="card-links">
          <Link href="/admin/data-bundle" className="btn btn-secondary btn-small">
            Andmepaketi staatus
          </Link>
          <a href="/api/admin/data-review/export?format=csv" className="btn btn-small">
            Ekspordi otsused (CSV)
          </a>
          <a href="/api/admin/data-review/export?format=jsonl" className="btn btn-small">
            Ekspordi otsused (JSONL)
          </a>
        </div>
      </div>

      <form method="get" className="card form-grid">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 }}>
          <input name="q" type="text" placeholder="Otsi pealkirja, URL-i või ID järgi..." defaultValue={params.q || ""} />
          <select name="decision" defaultValue={decisionFilter}>
            <option value="undecided">Otsustamata</option>
            <option value="approved">Kinnitatud</option>
            <option value="rejected">Tagasi lükatud</option>
            <option value="needs_review">Vajab ülevaatust</option>
            <option value="all">Kõik otsused</option>
          </select>
          <select name="confidence" defaultValue={params.confidence || ""}>
            <option value="">Kõik kindlused</option>
            {confidenceOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="recommendedAction" defaultValue={params.recommendedAction || ""}>
            <option value="">Kõik tegevused</option>
            {actionOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          <select name="currentValdkond" defaultValue={params.currentValdkond || ""}>
            <option value="">Praegune valdkond</option>
            {currentValdkondOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="suggestedValdkond" defaultValue={params.suggestedValdkond || ""}>
            <option value="">Soovitatud valdkond</option>
            {suggestedValdkondOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="currentTegevusala" defaultValue={params.currentTegevusala || ""}>
            <option value="">Praegune tegevusala</option>
            {currentTegevusalaOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <select name="suggestedTegevusala" defaultValue={params.suggestedTegevusala || ""}>
            <option value="">Soovitatud tegevusala</option>
            {suggestedTegevusalaOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div>
          <button type="submit" className="btn btn-small">
            Filtreeri
          </button>{" "}
          <Link href="/admin/data-review" className="btn btn-secondary btn-small">
            Tühjenda
          </Link>
        </div>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Kandidaat</th>
            <th>Soovitus</th>
            <th>Praegune</th>
            <th>Soovitatud</th>
            <th>Otsus</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const decision = decisionByCandidateId.get(row.candidateId) ?? "undecided";
            return (
              <tr key={row.candidateId}>
                <td>
                  <strong>{row.title || row.candidateId}</strong>
                  <div className="muted small">{row.contentId || row.candidateId}</div>
                  {row.url && (
                    <div className="muted small" style={{ wordBreak: "break-all" }}>
                      {row.url}
                    </div>
                  )}
                </td>
                <td>
                  <span className="tag accent">{row.recommendedAction || "—"}</span>
                  <div className="muted small">Kindlus: {row.confidence || "—"}</div>
                  <div className="muted small">{row.ruleSource || "—"}</div>
                </td>
                <td>
                  <div className="small">Valdkond: {chips(row.currentValdkond)}</div>
                  <div className="small">Tegevusala: {chips(row.currentTegevusala)}</div>
                  <div className="small">Täpsustus: {chips(row.currentTapsustus)}</div>
                </td>
                <td>
                  <div className="small">Valdkond: {chips(row.suggestedValdkond)}</div>
                  <div className="small">Tegevusala: {chips(row.suggestedTegevusala)}</div>
                  <div className="small">Täpsustus: {chips(row.suggestedTapsustus)}</div>
                </td>
                <td>
                  <span className={`flag ${decision === "approved" ? "evergreen" : decision === "rejected" ? "hidden" : "priority"}`}>
                    {decision}
                  </span>
                </td>
                <td>
                  <Link href={`/admin/data-review/${encodeURIComponent(stringValue(row.candidateId))}`} className="btn btn-secondary btn-small">
                    Ava
                  </Link>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                Sobivaid kandidaate ei leitud.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {pagination.pages > 1 && (
        <p>
          {Array.from({ length: pagination.pages }, (_, i) => i + 1).map((page) => (
            <Link
              key={page}
              href={hrefFor(params, page)}
              style={{ marginRight: 8, fontWeight: page === pagination.page ? 700 : 400 }}
            >
              {page}
            </Link>
          ))}
        </p>
      )}
    </>
  );
}
