import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const TAG_TYPE_LABELS: Record<string, string> = {
  sector: "Sektorid",
  interest: "Huviteemad",
  size: "Ettevõtte suurus",
  activity: "Tegevusprofiil",
};

export default async function AdminTopicEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [group, allTags, candidates] = await Promise.all([
    prisma.topicGroup.findUnique({
      where: { id },
      include: {
        tags: true,
        contentItems: { include: { contentItem: true } },
      },
    }),
    prisma.tag.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.contentItem.findMany({
      orderBy: [{ date: { sort: "desc", nulls: "last" } }],
      select: { id: true, title: true, displayTitle: true },
      take: 500,
    }),
  ]);

  if (!group) notFound();

  const selectedTagIds = new Set(group.tags.map((t) => t.tagId));
  const memberIds = new Set(group.contentItems.map((m) => m.contentItemId));
  const tagsByType = new Map<string, typeof allTags>();
  for (const tag of allTags) {
    const list = tagsByType.get(tag.type) ?? [];
    list.push(tag);
    tagsByType.set(tag.type, list);
  }

  const members = [...group.contentItems].sort(
    (a, b) => (b.contentItem.date?.getTime() ?? 0) - (a.contentItem.date?.getTime() ?? 0)
  );

  return (
    <>
      <p>
        <Link href="/admin/topics">← Tagasi teemagruppide nimekirja</Link>
      </p>
      <h1 style={{ fontSize: "1.4rem" }}>{group.title}</h1>

      <form method="post" action={`/api/admin/topics/${group.id}`} className="card form-grid">
        <input type="hidden" name="_action" value="update" />

        <div>
          <label className="field-label" htmlFor="title">
            Pealkiri
          </label>
          <input id="title" type="text" name="title" defaultValue={group.title} required />
        </div>

        <div>
          <label className="field-label" htmlFor="slug">
            Slug
          </label>
          <input id="slug" type="text" name="slug" defaultValue={group.slug} required />
        </div>

        <div>
          <label className="field-label" htmlFor="summary">
            Lühikokkuvõte
          </label>
          <textarea id="summary" name="summary" defaultValue={group.summary ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="whyItMattersText">
            „Miks see on sinu ettevõttele oluline” tekst
          </label>
          <textarea id="whyItMattersText" name="whyItMattersText" defaultValue={group.whyItMattersText ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="mainContentItemId">
            Põhisisu (kuvatakse kaardi peamise viitena)
          </label>
          <select id="mainContentItemId" name="mainContentItemId" defaultValue={group.mainContentItemId ?? ""}>
            <option value="">— Automaatne (parima skooriga liige) —</option>
            {members.map((m) => (
              <option key={m.contentItemId} value={m.contentItemId}>
                {m.contentItem.displayTitle || m.contentItem.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="manualWeight">
            Käsitsi kaal
          </label>
          <select id="manualWeight" name="manualWeight" defaultValue={String(group.manualWeight)}>
            <option value="-2">-2 · Tugevalt madaldatud</option>
            <option value="-1">-1 · Madaldatud</option>
            <option value="0">0 · Tavaline</option>
            <option value="1">+1 · Oluline</option>
            <option value="2">+2 · Kõrge prioriteet</option>
          </select>
        </div>

        <div className="checkbox-row">
          <label className="option-pill">
            <input type="checkbox" name="isEvergreen" defaultChecked={group.isEvergreen} />
            Evergreen (ajatu teema)
          </label>
          <label className="option-pill">
            <input type="checkbox" name="isHidden" defaultChecked={group.isHidden} />
            Peidetud
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
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Grupi sisu ({members.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Pealkiri</th>
              <th>Kuupäev</th>
              <th>Seos</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.contentItemId}>
                <td>
                  <Link href={`/admin/content/${m.contentItemId}`}>
                    {m.contentItem.displayTitle || m.contentItem.title}
                  </Link>
                  {group.mainContentItemId === m.contentItemId && (
                    <span className="flag priority" style={{ marginLeft: 8 }}>
                      põhisisu
                    </span>
                  )}
                </td>
                <td>{m.contentItem.date ? m.contentItem.date.toLocaleDateString("et-EE") : "—"}</td>
                <td>{m.relationType}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <form method="post" action={`/api/admin/topics/${group.id}`} className="inline-form">
                    <input type="hidden" name="_action" value="set-main" />
                    <input type="hidden" name="contentItemId" value={m.contentItemId} />
                    <button type="submit" className="btn btn-secondary btn-small">
                      Määra põhisisuks
                    </button>
                  </form>{" "}
                  <form method="post" action={`/api/admin/topics/${group.id}`} className="inline-form">
                    <input type="hidden" name="_action" value="remove-member" />
                    <input type="hidden" name="contentItemId" value={m.contentItemId} />
                    <button type="submit" className="btn btn-secondary btn-small">
                      Eemalda
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Grupis pole veel sisu.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <form
          method="post"
          action={`/api/admin/topics/${group.id}`}
          style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}
        >
          <input type="hidden" name="_action" value="add-member" />
          <select name="contentItemId" required style={{ maxWidth: 420 }}>
            <option value="">— Vali sisuelement —</option>
            {candidates
              .filter((c) => !memberIds.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayTitle || c.title}
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
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Kustuta teemagrupp</h2>
        <form method="post" action={`/api/admin/topics/${group.id}`}>
          <input type="hidden" name="_action" value="delete" />
          <button type="submit" className="btn btn-secondary btn-small">
            Kustuta grupp (sisu jääb alles)
          </button>
        </form>
      </div>
    </>
  );
}
