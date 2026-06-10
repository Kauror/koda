import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const TAG_TYPE_LABELS: Record<string, string> = {
  sector: "Sektorid",
  interest: "Huviteemad",
  size: "Ettevõtte suurus",
  activity: "Tegevusprofiil",
  region: "Regioonid",
  service: "Teenused",
};

export default async function AdminContentEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [item, allTags, allGroups, similarItems] = await Promise.all([
    prisma.contentItem.findUnique({
      where: { id },
      include: {
        tags: true,
        topicGroups: { include: { topicGroup: true } },
      },
    }),
    prisma.tag.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.topicGroup.findMany({ orderBy: { title: "asc" } }),
    prisma.contentItem.findMany({
      where: { id: { not: id }, isHidden: false },
      orderBy: [{ date: { sort: "desc", nulls: "last" } }],
      select: { id: true, title: true, displayTitle: true },
      take: 500,
    }),
  ]);

  if (!item) notFound();

  const selectedTagIds = new Set(item.tags.map((t) => t.tagId));
  const memberGroupIds = new Set(item.topicGroups.map((g) => g.topicGroupId));
  const tagsByType = new Map<string, typeof allTags>();
  for (const tag of allTags) {
    const list = tagsByType.get(tag.type) ?? [];
    list.push(tag);
    tagsByType.set(tag.type, list);
  }

  return (
    <>
      <p>
        <Link href="/admin/content">← Tagasi sisu nimekirja</Link>
      </p>
      <h1 style={{ fontSize: "1.4rem" }}>{item.displayTitle || item.title}</h1>
      <p className="muted small">
        Allikas:{" "}
        <a href={item.canonicalUrl} target="_blank" rel="noopener noreferrer">
          {item.canonicalUrl}
        </a>{" "}
        · tüüp: {item.sourceType} · imporditud {item.scrapedAt.toLocaleDateString("et-EE")}
      </p>

      <form method="post" action={`/api/admin/content/${item.id}`} className="card form-grid">
        <input type="hidden" name="_action" value="update" />

        <div>
          <label className="field-label">Originaalpealkiri (importer)</label>
          <input type="text" value={item.title} disabled />
        </div>

        <div>
          <label className="field-label" htmlFor="displayTitle">
            Kuvatav pealkiri (jäta tühjaks, et kasutada originaali)
          </label>
          <input id="displayTitle" type="text" name="displayTitle" defaultValue={item.displayTitle ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="summary">
            Lühikokkuvõte (kuvatakse tulemustes)
          </label>
          <textarea id="summary" name="summary" defaultValue={item.summary ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="date">
            Kuupäev
          </label>
          <input
            id="date"
            type="date"
            name="date"
            defaultValue={item.date ? item.date.toISOString().slice(0, 10) : ""}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="manualWeight">
            Käsitsi kaal
          </label>
          <select id="manualWeight" name="manualWeight" defaultValue={String(item.manualWeight)}>
            <option value="-2">-2 · Tugevalt madaldatud</option>
            <option value="-1">-1 · Madaldatud</option>
            <option value="0">0 · Tavaline</option>
            <option value="1">+1 · Oluline</option>
            <option value="2">+2 · Kõrge prioriteet</option>
          </select>
        </div>

        <div className="checkbox-row">
          <label className="option-pill">
            <input type="checkbox" name="isEvergreen" defaultChecked={item.isEvergreen} />
            Evergreen (ajatu sisu)
          </label>
          <label className="option-pill">
            <input type="checkbox" name="isHidden" defaultChecked={item.isHidden} />
            Peidetud (ei kuvata kasutajatele)
          </label>
        </div>

        {(["sector", "interest", "activity", "size"] as const).map((type) => (
          <fieldset key={type}>
            <legend>{TAG_TYPE_LABELS[type]}</legend>
            <div className="checkbox-row">
              {(tagsByType.get(type) ?? []).map((tag) => (
                <label key={tag.id} className="option-pill">
                  <input
                    type="checkbox"
                    name="tagIds"
                    value={tag.id}
                    defaultChecked={selectedTagIds.has(tag.id)}
                  />
                  {tag.name}
                </label>
              ))}
              {(tagsByType.get(type) ?? []).length === 0 && (
                <span className="muted small">Silte pole. Lisa need lehel „Sildid”.</span>
              )}
            </div>
          </fieldset>
        ))}

        <div>
          <button type="submit" className="btn">
            Salvesta
          </button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Teemagrupid</h2>
        {item.topicGroups.length === 0 && <p className="muted small">Ei kuulu ühtegi teemagruppi.</p>}
        {item.topicGroups.map((m) => (
          <p key={m.topicGroupId} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href={`/admin/topics/${m.topicGroupId}`}>{m.topicGroup.title}</Link>
            <span className="tag">{m.relationType}</span>
            <form method="post" action={`/api/admin/topics/${m.topicGroupId}`} className="inline-form">
              <input type="hidden" name="_action" value="remove-member" />
              <input type="hidden" name="contentItemId" value={item.id} />
              <input type="hidden" name="_redirect" value={`/admin/content/${item.id}`} />
              <button type="submit" className="btn btn-secondary btn-small">
                Eemalda
              </button>
            </form>
          </p>
        ))}
        <form
          method="post"
          action={`/api/admin/content/${item.id}`}
          style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          <input type="hidden" name="_action" value="add-to-group" />
          <select name="topicGroupId" required style={{ maxWidth: 320 }}>
            <option value="">— Vali teemagrupp —</option>
            {allGroups
              .filter((g) => !memberGroupIds.has(g.id))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
          </select>
          <select name="relationType" defaultValue="history" style={{ maxWidth: 160 }}>
            <option value="main">main</option>
            <option value="history">history</option>
            <option value="related">related</option>
          </select>
          <button type="submit" className="btn btn-secondary btn-small">
            Lisa gruppi
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Liida duplikaat</h2>
        <p className="muted small">
          Vali teine sisuelement, mis on selle duplikaat. Duplikaat peidetakse ning selle sildid ja
          teemagrupid liidetakse siia.
        </p>
        <form
          method="post"
          action={`/api/admin/content/${item.id}`}
          style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          <input type="hidden" name="_action" value="merge" />
          <select name="duplicateId" required style={{ maxWidth: 480 }}>
            <option value="">— Vali duplikaat —</option>
            {similarItems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayTitle || s.title}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-secondary btn-small">
            Liida
          </button>
        </form>
      </div>

      {(item.excerpt || item.bodyText) && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Imporditud sisu</h2>
          {item.excerpt && (
            <p className="small">
              <strong>Väljavõte:</strong> {item.excerpt}
            </p>
          )}
          {item.bodyText && (
            <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
              {item.bodyText.slice(0, 3000)}
              {item.bodyText.length > 3000 ? "…" : ""}
            </p>
          )}
        </div>
      )}
    </>
  );
}
