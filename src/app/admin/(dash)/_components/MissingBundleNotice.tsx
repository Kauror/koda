import { BUNDLE_GENERATE_COMMAND, BUNDLE_VALIDATE_COMMAND } from "@/lib/admin-review-ui";

/**
 * Friendly, path-free message shown when the generated data bundle is missing
 * or unreadable. `error` is the already-sanitised BundleReadResult message
 * (lists missing files, never absolute paths or stack traces).
 */
export default function MissingBundleNotice({
  title = "Andmepakett puudub",
  error,
}: {
  title?: string;
  error: string;
}) {
  return (
    <section className="card notice">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p>{error}</p>
      <p>
        Andmeülevaatuse tööriist vajab genereeritud andmepaketti. Failid on puudu või veel
        genereerimata. Genereeri pakett lokaalselt selle käsuga:
      </p>
      <pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
        {BUNDLE_GENERATE_COMMAND}
      </pre>
      <p>Seejärel saad paketi valideerida:</p>
      <pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
        {BUNDLE_VALIDATE_COMMAND}
      </pre>
    </section>
  );
}
