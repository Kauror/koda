import { prisma } from "@/lib/db";
import { SITE_TEXT_DEFAULTS, SITE_TEXT_DEFAULTS_BY_KEY } from "@/lib/site-text-defaults";

export const dynamic = "force-dynamic";

type PageRow = {
  key: string;
  valueEt: string;
  description: string | null;
  group: string;
  source: "default" | "database" | "unknown";
};

export default async function AdminSiteTextsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; key?: string }>;
}) {
  const params = await searchParams;
  const dbRows = await prisma.siteText.findMany({ orderBy: [{ group: "asc" }, { key: "asc" }] });
  const byKey = new Map(dbRows.map((row) => [row.key, row]));
  const rows: PageRow[] = [
    ...SITE_TEXT_DEFAULTS.map((item) => {
      const row = byKey.get(item.key);
      return {
        key: item.key,
        valueEt: row?.valueEt ?? item.valueEt,
        description: row?.description ?? item.description,
        group: row?.group ?? item.group,
        source: row ? "database" : "default",
      } satisfies PageRow;
    }),
    ...dbRows
      .filter((row) => !SITE_TEXT_DEFAULTS_BY_KEY.has(row.key))
      .map((row) => ({
        key: row.key,
        valueEt: row.valueEt,
        description: row.description,
        group: row.group ?? "unknown",
        source: "unknown" as const,
      })),
  ].sort((a, b) => a.group.localeCompare(b.group, "et") || a.key.localeCompare(b.key, "et"));

  const grouped = new Map<string, PageRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.group) ?? [];
    list.push(row);
    grouped.set(row.group, list);
  }

  return (
    <>
      <h1>Avalehe tekstid</h1>
      <div className="card">
        <p className="section-sub">
          Muuda siin avalehe suuremaid tekstiplokke. Võtmeid ei muudeta; kui andmebaasis rida veel pole,
          kasutatakse koodis olevat vaiketeksti.
        </p>
        {params.saved && <p className="flag evergreen">Salvestatud: {params.saved}</p>}
        {params.error === "empty" && (
          <p className="form-error">
            Tühja teksti salvestamiseks märgi sama rea juures kinnitusruut.
          </p>
        )}
      </div>

      {[...grouped.entries()].map(([group, items]) => (
        <section key={group} className="card">
          <h2 style={{ marginTop: 0 }}>{group}</h2>
          <div className="form-grid">
            {items.map((item) => (
              <form key={item.key} method="post" action="/api/admin/site-texts" className="site-text-editor">
                <input type="hidden" name="key" value={item.key} />
                <input type="hidden" name="_redirect" value="/admin/site-texts" />
                <div>
                  <label className="field-label" htmlFor={`text-${item.key}`}>
                    <code>{item.key}</code>
                  </label>
                  {item.description && <p className="field-hint">{item.description}</p>}
                  <p className="field-hint">
                    {item.source === "database" && "Muudetud tekst andmebaasis."}
                    {item.source === "default" && "Kasutusel on vaiketekst; salvestamine loob andmebaasi rea."}
                    {item.source === "unknown" && "Tundmatu võti andmebaasis; säilitatakse ja lubatakse väärtust muuta."}
                  </p>
                  <textarea id={`text-${item.key}`} name="valueEt" defaultValue={item.valueEt} rows={5} />
                </div>
                <label className="checkbox-row small">
                  <input type="checkbox" name="allowEmpty" value="1" />
                  Luba tühi tekst
                </label>
                {params.error === "empty" && params.key === item.key && (
                  <p className="form-error">See rida jäi salvestamata, sest väärtus oli tühi.</p>
                )}
                <div>
                  <button type="submit" className="btn btn-small">
                    Salvesta
                  </button>
                </div>
              </form>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
