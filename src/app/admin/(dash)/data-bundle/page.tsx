import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  buildCandidateDateMap,
  computeReviewProgress,
  readBundleOverview,
  readContentItems,
  readReviewCandidates,
  stringValue,
} from "@/lib/admin-bundle";
import { extractItemDate, formatItemDate, type ItemDate } from "@/lib/admin-dates";
import MissingBundleNotice from "../_components/MissingBundleNotice";
import ReviewProgressCard from "../_components/ReviewProgressCard";

export const dynamic = "force-dynamic";

function countAt(rowCounts: unknown, key: string): string {
  if (!rowCounts || typeof rowCounts !== "object") return "0";
  return stringValue((rowCounts as Record<string, unknown>)[key]) || "0";
}

type DateCoverage = {
  byYear: { year: number; content: number; candidates: number }[];
  newest: ItemDate | null;
  oldest: ItemDate | null;
  missing: number;
};

function buildDateCoverage(): DateCoverage | null {
  const content = readContentItems();
  if (!content.ok) return null;
  const candidates = readReviewCandidates();
  const candidateDates = candidates.ok ? buildCandidateDateMap(candidates.data, content.data) : new Map<string, ItemDate>();

  const perYear = new Map<number, { content: number; candidates: number }>();
  let newest: ItemDate | null = null;
  let oldest: ItemDate | null = null;
  let missing = 0;
  const bump = (year: number, key: "content" | "candidates") => {
    const entry = perYear.get(year) ?? { content: 0, candidates: 0 };
    entry[key]++;
    perYear.set(year, entry);
  };

  for (const item of content.data) {
    const d = extractItemDate(item);
    if (!d.hasDate || d.year == null) {
      missing++;
      continue;
    }
    bump(d.year, "content");
    if (d.sortKey != null) {
      if (!newest || (newest.sortKey ?? 0) < d.sortKey) newest = d;
      if (!oldest || (oldest.sortKey ?? 0) > d.sortKey) oldest = d;
    }
  }
  for (const d of candidateDates.values()) {
    if (d.year != null) bump(d.year, "candidates");
  }

  const byYear = [...perYear.entries()]
    .map(([year, counts]) => ({ year, ...counts }))
    .sort((a, b) => b.year - a.year);
  return { byYear, newest, oldest, missing };
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

  const coverage = buildDateCoverage();

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

      {coverage && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Kuupäevade kate</h2>
          <p className="section-sub">
            Aitab kontrollida, kas pakett sisaldab oodatud uusimat materjali. Uusimad aastad eespool.
          </p>
          <div className="status-flags" style={{ marginBottom: 12 }}>
            <span className="flag evergreen">Uusim: {coverage.newest ? formatItemDate(coverage.newest) : "—"}</span>
            <span className="flag down">Vanim: {coverage.oldest ? formatItemDate(coverage.oldest) : "—"}</span>
            <span className="flag priority">Kuupäevata sisuridu: {coverage.missing}</span>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Aasta</th>
                <th>Sisuridu</th>
                <th>Ülevaatuse kandidaate</th>
              </tr>
            </thead>
            <tbody>
              {coverage.byYear.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{row.content}</td>
                  <td>{row.candidates}</td>
                </tr>
              ))}
              {coverage.byYear.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Kuupäevadega sisuridu ei leitud.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

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
