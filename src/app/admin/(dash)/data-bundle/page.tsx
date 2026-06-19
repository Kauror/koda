import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeReviewProgress, readBundleOverview, readReviewCandidates, stringValue } from "@/lib/admin-bundle";
import MissingBundleNotice from "../_components/MissingBundleNotice";
import ReviewProgressCard from "../_components/ReviewProgressCard";

export const dynamic = "force-dynamic";

function countAt(rowCounts: unknown, key: string): string {
  if (!rowCounts || typeof rowCounts !== "object") return "0";
  return stringValue((rowCounts as Record<string, unknown>)[key]) || "0";
}

export default async function AdminDataBundlePage() {
  const result = readBundleOverview();

  if (!result.ok) {
    return (
      <>
        <h1>Andmepakett</h1>
        <ReviewProgressCard progress={null} />
        <MissingBundleNotice error={result.error} />
      </>
    );
  }

  const candidates = readReviewCandidates();
  let progress = null;
  if (candidates.ok) {
    const decisions = await prisma.dataReviewDecision.findMany({ select: { candidateId: true, decision: true } });
    const decisionByCandidateId = new Map(decisions.map((row) => [row.candidateId, row.decision]));
    progress = computeReviewProgress(
      candidates.data.map((row) => row.candidateId),
      decisionByCandidateId,
    );
  }

  const { manifest, qaReport, files } = result.data;
  const rowCounts = manifest.row_counts;
  const validationStatus = stringValue(manifest.validation_status || qaReport.validation_status);
  const warnings = Array.isArray(manifest.warnings) ? manifest.warnings : [];
  const errors = Array.isArray(manifest.errors) ? manifest.errors : [];

  return (
    <>
      <h1>Andmepakett</h1>
      <div className="card">
        <p className="section-sub">
          Read-only ülevaade genereeritud andmepaketist. See leht ei impordi andmeid ega muuda avalikke tulemusi.
        </p>
        <div className="status-flags">
          <span className={`flag ${errors.length > 0 ? "hidden" : "evergreen"}`}>
            {validationStatus || "unknown"}
          </span>
          <span className="flag priority">genereeritud {stringValue(manifest.generated_timestamp) || "teadmata"}</span>
        </div>
      </div>

      <ReviewProgressCard progress={progress} />

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Põhinäitajad</h2>
        <table className="admin-table">
          <tbody>
            <tr>
              <td>Sisuridu kokku</td>
              <td>
                <strong>{countAt(rowCounts, "content_items_rows")}</strong>
              </td>
            </tr>
            <tr>
              <td>Veebi read</td>
              <td>{countAt(rowCounts, "web_index_content_rows")}</td>
            </tr>
            <tr>
              <td>Arvamuste read</td>
              <td>{countAt(rowCounts, "opinion_support_rows")}</td>
            </tr>
            <tr>
              <td>Aastaaruannete read</td>
              <td>{countAt(rowCounts, "annual_context_rows")}</td>
            </tr>
            <tr>
              <td>Töövõitude rikastusread</td>
              <td>{countAt(rowCounts, "achievement_enrichment_rows")}</td>
            </tr>
            <tr>
              <td>Ülevaatuse kandidaadid</td>
              <td>{countAt(rowCounts, "review_candidates_jsonl_rows")}</td>
            </tr>
            <tr>
              <td>Taksonoomia kategooriad</td>
              <td>{countAt(rowCounts, "taxonomy_json_categories")}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Tööriistad</h2>
        <div className="card-links">
          <Link href="/admin/data-review" className="btn btn-secondary btn-small">
            Andmeülevaatuse kandidaadid
          </Link>
          <Link href="/admin/content-items" className="btn btn-secondary btn-small">
            Paketis olevad sisuread
          </Link>
          <Link href="/admin/taxonomy" className="btn btn-secondary btn-small">
            Taksonoomia ja reeglid
          </Link>
          <Link href="/api/admin/data-review/export?format=csv" className="btn btn-secondary btn-small">
            Ekspordi otsused CSV
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Failid</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Fail</th>
              <th>Olek</th>
              <th>Suurus</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr key={file.fileName}>
                <td>{file.fileName}</td>
                <td>{file.exists ? "olemas" : "puudub"}</td>
                <td>{file.sizeBytes ? `${Math.round(file.sizeBytes / 1024)} KB` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Hoiatused ja vead</h2>
        {warnings.length === 0 && errors.length === 0 && <p className="muted">Hoiatusi ega vigu ei ole.</p>}
        {warnings.map((warning, index) => (
          <p key={`w-${index}`} className="flag priority">
            {stringValue(warning)}
          </p>
        ))}
        {errors.map((error, index) => (
          <p key={`e-${index}`} className="flag hidden">
            {stringValue(error)}
          </p>
        ))}
      </section>
    </>
  );
}
