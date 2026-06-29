import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getPublicDetailSummary, publicTitle } from "@/lib/content-display";
import { PUBLIC_TOPIC_FILTERS } from "@/lib/topics";
import { CROSS_SECTOR_ACTIVITY, PUBLIC_ACTIVITY_FILTERS } from "@/lib/activities";

export const dynamic = "force-dynamic";

function visibilityValue(value: boolean | null | undefined): string {
  if (value === true) return "visible";
  if (value === false) return "hidden";
  return "follow";
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

export default async function AdminContentEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; published?: string; cleared?: string }>;
}) {
  const { id } = await params;
  const status = await searchParams;

  const [item, allGroups, similarItems] = await Promise.all([
    prisma.contentItem.findUnique({
      where: { id },
      include: {
        tags: { include: { tag: true } },
        topicGroups: { include: { topicGroup: true } },
        adminDrafts: true,
      },
    }),
    prisma.topicGroup.findMany({ orderBy: { title: "asc" } }),
    prisma.contentItem.findMany({
      where: { id: { not: id }, isHidden: false },
      orderBy: [{ date: { sort: "desc", nulls: "last" } }],
      select: { id: true, title: true, displayTitle: true },
      take: 500,
    }),
  ]);

  if (!item) notFound();

  const externalId = item.externalId ?? item.id;
  const draft = item.adminDrafts[0] ?? null;
  const memberGroupIds = new Set(item.topicGroups.map((g) => g.topicGroupId));
  const currentTopics = item.tags
    .filter((t) => t.tag.type === "valdkond")
    .map((t) => t.tag.name)
    .join("; ");
  const currentActivities = item.tags
    .filter((t) => t.tag.type === "tegevusala")
    .map((t) => t.tag.name)
    .join("; ");
  const publicPreview = {
    title: publicTitle(item),
    summary: getPublicDetailSummary(item),
  };
  const draftVisibility = draft ? draft.visibilityOverride : item.adminVisibilityOverride;

  return (
    <>
      <p>
        <Link href="/admin/content">← Tagasi sisu haldusesse</Link>
      </p>
      <h1 style={{ fontSize: "1.4rem" }}>{publicPreview.title || item.displayTitle || item.title}</h1>
      <p className="muted small">
        ID: {externalId} · Allikas:{" "}
        <a href={item.canonicalUrl || item.sourceUrl || "#"} target="_blank" rel="noopener noreferrer">
          {item.canonicalUrl || item.sourceUrl || "(allikata)"}
        </a>{" "}
        · tüüp: {item.sourceDataset || item.sourceTypeDetail || item.sourceType} · imporditud{" "}
        {item.scrapedAt.toLocaleDateString("et-EE")}
      </p>

      {(status.saved || status.published || status.cleared) && (
        <div className="card notice">
          {status.saved && <p style={{ margin: 0 }}>Mustand salvestatud. Avalik vaade muutub pärast avaldamist.</p>}
          {status.published && <p style={{ margin: 0 }}>Muudatused avaldatud.</p>}
          {status.cleared && <p style={{ margin: 0 }}>Avaldatud override'id eemaldatud.</p>}
        </div>
      )}

      <section className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Avalik eelvaade</h2>
        <p>
          <strong>{publicPreview.title}</strong>
        </p>
        {publicPreview.summary && <p className="small">{publicPreview.summary}</p>}
        <div className="status-flags">
          <span className={`flag ${item.adminVisibilityOverride === false ? "hidden" : item.adminVisibilityOverride === true ? "evergreen" : "priority"}`}>
            {item.adminVisibilityOverride === false ? "admin peidetud" : item.adminVisibilityOverride === true ? "admin avalik" : "järgib importi"}
          </span>
          {draft && !draft.publishedAt && <span className="flag priority">avaldamata mustand</span>}
          {item.displayType && <span className="flag down">{item.displayType}</span>}
        </div>
      </section>

      <form method="post" action={`/api/admin/content/${item.id}`} className="card form-grid">
        <input type="hidden" name="_action" value="save-draft" />

        <div>
          <label className="field-label">Imporditud pealkiri</label>
          <input type="text" value={item.title} disabled />
        </div>

        <div>
          <label className="field-label" htmlFor="titleOverride">
            Avalik pealkiri
          </label>
          <input id="titleOverride" type="text" name="titleOverride" defaultValue={draft?.titleOverride ?? item.adminDisplayTitleOverride ?? ""} />
        </div>

        <div>
          <label className="field-label">Imporditud kokkuvõte</label>
          <textarea value={item.summary ?? ""} disabled />
        </div>

        <div>
          <label className="field-label" htmlFor="summaryOverride">
            Avalik kokkuvõte
          </label>
          <textarea id="summaryOverride" name="summaryOverride" defaultValue={draft?.summaryOverride ?? item.adminSummaryOverride ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="textOverride">
            Avalik lisatekst
          </label>
          <textarea id="textOverride" name="textOverride" defaultValue={draft?.textOverride ?? item.adminTextOverride ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="visibilityOverride">
            Nähtavus
          </label>
          <select id="visibilityOverride" name="visibilityOverride" defaultValue={visibilityValue(draftVisibility)}>
            <option value="follow">Järgi importi</option>
            <option value="visible">Tee avalikuks</option>
            <option value="hidden">Peida avalikust vaatest</option>
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="hiddenReason">
            Peitmise põhjus
          </label>
          <input id="hiddenReason" name="hiddenReason" defaultValue={draft?.hiddenReason ?? item.adminHiddenReason ?? ""} />
        </div>

        <fieldset>
          <legend>Teema</legend>
          <label className="field-label" htmlFor="topicPrimary">
            Peamine teema
          </label>
          <select id="topicPrimary" name="topicPrimary" defaultValue={draft?.topicPrimary ?? ""}>
            <option value="">Jäta import</option>
            {PUBLIC_TOPIC_FILTERS.map((topic) => (
              <option key={topic.slug} value={topic.name}>
                {topic.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="topicSecondary">
            Teisesed teemad
          </label>
          <textarea id="topicSecondary" name="topicSecondary" defaultValue={text(draft?.topicSecondary)} placeholder="Üks või mitu teemat, eralda semikooloniga" />
          <p className="muted small">Praegu importist: {currentTopics || "—"}</p>
        </fieldset>

        <fieldset>
          <legend>Tegevusala</legend>
          <label className="field-label" htmlFor="activityPrimary">
            Peamine tegevusala
          </label>
          <select id="activityPrimary" name="activityPrimary" defaultValue={draft?.activityPrimary ?? ""}>
            <option value="">Jäta import</option>
            {PUBLIC_ACTIVITY_FILTERS.map((activity) => (
              <option key={activity.slug} value={activity.name}>
                {activity.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="activitySecondary">
            Teisesed tegevusalad
          </label>
          <textarea id="activitySecondary" name="activitySecondary" defaultValue={text(draft?.activitySecondary)} placeholder="Üks või mitu 12 sektorist, eralda semikooloniga" />
          <p className="muted small">Praegu importist: {currentActivities || "—"}</p>
        </fieldset>

        <fieldset>
          <legend>Sildid ja sektorilehed</legend>
          <label className="field-label" htmlFor="publicActivityFilterTags">
            public_activity_filter_tags
          </label>
          <textarea id="publicActivityFilterTags" name="publicActivityFilterTags" defaultValue={text(draft?.publicActivityFilterTags)} placeholder={`${CROSS_SECTOR_ACTIVITY} või 12 sektori väärtused`} />
          <label className="field-label" htmlFor="publicActivityDisplayTags">
            public_activity_display_tags
          </label>
          <textarea id="publicActivityDisplayTags" name="publicActivityDisplayTags" defaultValue={text(draft?.publicActivityDisplayTags)} placeholder="Ainult 12 avalikku sektorit; cross-sector ei ole lubatud" />
          <label className="field-label" htmlFor="publicSectorPageAllowed">
            public_sector_page_allowed
          </label>
          <select id="publicSectorPageAllowed" name="publicSectorPageAllowed" defaultValue={draft?.publicSectorPageAllowed ?? ""}>
            <option value="">Jäta import</option>
            <option value="TRUE">TRUE</option>
            <option value="LIMITED">LIMITED</option>
            <option value="FALSE">FALSE</option>
          </select>
        </fieldset>

        <div>
          <label className="field-label" htmlFor="reviewerNote">
            Märkus logisse
          </label>
          <textarea id="reviewerNote" name="reviewerNote" defaultValue={text(draft?.reviewerNote)} />
        </div>

        <div>
          <button type="submit" className="btn">
            Salvesta mustand
          </button>
          <button type="submit" name="_action" value="publish" className="btn btn-secondary" style={{ marginLeft: 8 }}>
            Avalda
          </button>
          <button type="submit" name="_action" value="clear-published" className="btn btn-secondary" style={{ marginLeft: 8 }}>
            Eemalda override'id
          </button>
        </div>
      </form>

      {(item.rowOrigin || item.displayType || item.policyThreadKey || item.parentToovoitId || item.timelineYear) && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Töövõidu v1.2 seosed</h2>
          <table className="admin-table">
            <tbody>
              <tr><td>row_origin</td><td>{item.rowOrigin || "—"}</td></tr>
              <tr><td>display_type</td><td>{item.displayType || "—"}</td></tr>
              <tr><td>parent_toovoit_id</td><td>{item.parentToovoitId || "—"}</td></tr>
              <tr><td>parent_candidate_id</td><td>{item.parentCandidateId || "—"}</td></tr>
              <tr><td>policy_thread_key</td><td>{item.policyThreadKey || "—"}</td></tr>
              <tr><td>policy_thread_title</td><td>{item.policyThreadTitle || "—"}</td></tr>
              <tr><td>timeline_year</td><td>{item.timelineYear || "—"}</td></tr>
              <tr><td>timeline_stage</td><td>{item.timelineStage || "—"}</td></tr>
            </tbody>
          </table>
        </div>
      )}

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
              {item.bodyText.length > 3000 ? "..." : ""}
            </p>
          )}
        </div>
      )}
    </>
  );
}
