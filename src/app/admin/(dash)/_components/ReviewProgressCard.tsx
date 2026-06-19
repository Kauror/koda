import type { ReviewProgress } from "@/lib/admin-bundle";

/**
 * Review progress counters + a simple progress bar. `progress` is null when the
 * bundle is unavailable, in which case the counters render as "—".
 */
export default function ReviewProgressCard({ progress }: { progress: ReviewProgress | null }) {
  const unavailable = progress === null;
  const value = (n: number) => (unavailable ? "—" : String(n));
  const percent = unavailable ? 0 : progress.progressPercent;

  return (
    <section className="card">
      <h2 style={{ marginTop: 0 }}>Ülevaatuse edenemine</h2>
      <div className="status-flags" style={{ marginBottom: 12 }}>
        <span className="flag">Kokku: {value(progress?.total ?? 0)}</span>
        <span className="flag evergreen">Kinnitatud: {value(progress?.approved ?? 0)}</span>
        <span className="flag hidden">Tagasi lükatud: {value(progress?.rejected ?? 0)}</span>
        <span className="flag priority">Vajab ülevaatust: {value(progress?.needsReview ?? 0)}</span>
        <span className="flag down">Otsustamata: {value(progress?.undecided ?? 0)}</span>
      </div>
      <div
        aria-hidden="true"
        style={{
          height: 10,
          borderRadius: "var(--radius-sm)",
          background: "var(--color-bg-soft)",
          border: "1px solid var(--color-border)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: "100%",
            background: "var(--color-primary)",
            transition: "width 0.2s ease",
          }}
        />
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        {unavailable
          ? "Edenemine pole saadaval – andmepakett puudub."
          : `Otsustatud ${progress.decided} / ${progress.total} (${progress.progressPercent}%).`}
      </p>
    </section>
  );
}
