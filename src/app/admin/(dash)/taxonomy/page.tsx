import { readTaxonomyBundle, stringValue } from "@/lib/admin-bundle";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => !!item && typeof item === "object") : [];
}

function list(value: unknown): string {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean).join(", ") || "—" : stringValue(value) || "—";
}

export default async function AdminTaxonomyPage() {
  const bundle = readTaxonomyBundle();

  if (!bundle.ok) {
    return (
      <>
        <h1>Taksonoomia</h1>
        <div className="card notice">
          <p>{bundle.error}</p>
        </div>
      </>
    );
  }

  const { taxonomy, taxonomyRules, tagDictionary } = bundle.data;
  const categories = rows(taxonomy.categories);
  const topicTerms = rows(taxonomyRules.topicTerms);
  const sectorRules = rows(taxonomyRules.sectorRelevanceRules);
  const crawlerRules = rows(taxonomyRules.crawlerClassificationRules);
  const boundaryRules = taxonomyRules.boundaryRules && typeof taxonomyRules.boundaryRules === "object"
    ? (taxonomyRules.boundaryRules as Row)
    : {};

  return (
    <>
      <h1>Taksonoomia ja reeglid</h1>
      <div className="card">
        <p className="section-sub">
          Read-only vaade andmepaketi taksonoomiale. Muudatused tehakse hiljem kontrollitud parandus- või impordisammu kaudu.
        </p>
        <div className="status-flags">
          <span className="flag priority">{categories.length} kategooriat</span>
          <span className="flag priority">{topicTerms.length} teema reeglit</span>
          <span className="flag priority">{sectorRules.length} tegevusala reeglit</span>
          <span className="flag priority">{crawlerRules.length} crawler reeglit</span>
        </div>
      </div>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Piirireeglid</h2>
        <table className="admin-table">
          <tbody>
            {Object.entries(boundaryRules).map(([key, value]) => (
              <tr key={key}>
                <td>
                  <strong>{key}</strong>
                </td>
                <td>{stringValue(value)}</td>
              </tr>
            ))}
            {Object.keys(boundaryRules).length === 0 && (
              <tr>
                <td className="muted">Piirireegleid ei leitud.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Kanoonilised kategooriad</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Kategooria</th>
              <th>Skoop</th>
              <th>Kaasa</th>
              <th>Välista</th>
              <th>Olek</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((row) => (
              <tr key={stringValue(row.slug) || stringValue(row.canonicalValdkond)}>
                <td>
                  <strong>{stringValue(row.canonicalValdkond)}</strong>
                  <div className="muted small">{stringValue(row.slug)}</div>
                </td>
                <td>{stringValue(row.scopeDescription)}</td>
                <td>{list(row.includeExamples)}</td>
                <td>{list(row.excludeExamples)}</td>
                <td>
                  <span className="flag priority">{stringValue(row.status) || "—"}</span>
                  <div className="muted small">{stringValue(row.confidence)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Teematerminid</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Valdkond</th>
              <th>Tugevad terminid</th>
              <th>Ankrud</th>
              <th>Välistused</th>
            </tr>
          </thead>
          <tbody>
            {topicTerms.map((row) => (
              <tr key={stringValue(row.canonicalValdkond)}>
                <td>{stringValue(row.canonicalValdkond)}</td>
                <td>{list(row.strongIncludeTerms)}</td>
                <td>{list(row.anchorTerms)}</td>
                <td>{list(row.excludeTerms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Tegevusala reeglid</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Tegevusala</th>
              <th>Ankrud / kaasamine</th>
              <th>Välistused</th>
              <th>Märkused</th>
            </tr>
          </thead>
          <tbody>
            {sectorRules.map((row, index) => (
              <tr key={stringValue(row.canonicalTegevusala) || String(index)}>
                <td>{stringValue(row.canonicalTegevusala) || stringValue(row.tegevusala) || "—"}</td>
                <td>{list(row.anchorTerms || row.includeTerms || row.strongIncludeTerms)}</td>
                <td>{list(row.excludeTerms || row.excludeRule)}</td>
                <td>{stringValue(row.notes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Crawler klassifitseerimisreeglid</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Valdkond</th>
              <th>URL / pealkiri</th>
              <th>Vaikimisi tegevusala</th>
              <th>Review reegel</th>
            </tr>
          </thead>
          <tbody>
            {crawlerRules.map((row, index) => (
              <tr key={`${stringValue(row.canonicalValdkond)}-${index}`}>
                <td>{stringValue(row.canonicalValdkond)}</td>
                <td>
                  <div>{list(row.urlPattern)}</div>
                  <div className="muted small">{list(row.titleTerms)}</div>
                </td>
                <td>{stringValue(row.defaultTegevusala)}</td>
                <td>{stringValue(row.needsReviewRule)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Sildisõnastik</h2>
        <pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {JSON.stringify(tagDictionary, null, 2)}
        </pre>
      </section>
    </>
  );
}
