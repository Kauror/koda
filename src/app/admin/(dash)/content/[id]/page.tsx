import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceLinkType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPublicDetailSummary, publicTitle } from "@/lib/content-display";
import { PUBLIC_TOPIC_FILTERS } from "@/lib/topics";
import { CROSS_SECTOR_ACTIVITY, PUBLIC_ACTIVITY_FILTERS } from "@/lib/activities";
import { THREAD_ROLES, roleLabel, statusLabel } from "@/lib/content-threads";
import { pickPrimaryDoc } from "@/lib/source-documents";
import RelatedContentPicker from "./RelatedContentPicker";

export const dynamic = "force-dynamic";

function visibilityValue(value: boolean | null | undefined): string {
  if (value === true) return "visible";
  if (value === false) return "hidden";
  return "follow";
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

function splitValues(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[;\n|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function importLabel(value: string | null | undefined): string {
  return `Jäta import (praegu: ${value?.trim() || "—"})`;
}

const FILTER_TAG_OPTIONS = [
  { name: CROSS_SECTOR_ACTIVITY },
  ...PUBLIC_ACTIVITY_FILTERS,
];

const RELATED_LINK_TYPE_OPTIONS = [
  { value: EvidenceLinkType.related_news, label: "Selgitav uudis" },
  { value: EvidenceLinkType.related_opinion, label: "Koja seisukoht" },
  { value: EvidenceLinkType.public_explanation, label: "Avalik selgitus" },
  { value: EvidenceLinkType.same_policy_thread, label: "Sama teema" },
  { value: EvidenceLinkType.source_evidence, label: "Seotud allikas" },
] as const;

function evidenceLinkLabel(type: EvidenceLinkType): string {
  return RELATED_LINK_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export default async function AdminContentEdit({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; published?: string; cleared?: string; linked?: string; unlinked?: string; linkError?: string }>;
}) {
  const { id } = await params;
  const status = await searchParams;

  const [item, allGroups, similarItems, relatedLinks, linkCandidates] = await Promise.all([
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
    prisma.contentEvidenceLink.findMany({
      where: { OR: [{ fromContentId: id }, { toContentId: id }] },
      include: {
        from: { select: { id: true, externalId: true, title: true, displayTitle: true, sourceDataset: true, sourceTypeDetail: true } },
        to: { select: { id: true, externalId: true, title: true, displayTitle: true, sourceDataset: true, sourceTypeDetail: true } },
      },
      orderBy: [{ sortPriority: "desc" }, { createdAt: "desc" }],
    }),
    prisma.contentItem.findMany({
      where: { id: { not: id }, isHidden: false },
      orderBy: [{ date: { sort: "desc", nulls: "last" } }, { title: "asc" }],
      select: {
        id: true,
        externalId: true,
        title: true,
        displayTitle: true,
        date: true,
        sourceDataset: true,
        sourceTypeDetail: true,
      },
      take: 2500,
    }),
  ]);

  if (!item) notFound();

  // Admin topic threads: membership is keyed by the stable externalId, so it
  // survives re-imports. Legacy rows without an externalId cannot be linked.
  const [allThreads, threadMemberships, sourceDocs] = await Promise.all([
    prisma.contentThread.findMany({ orderBy: { title: "asc" } }),
    item.externalId
      ? prisma.contentThreadItem.findMany({
          where: { contentExternalId: item.externalId },
          include: { thread: true },
        })
      : Promise.resolve([]),
    item.externalId
      ? prisma.sourceDocument.findMany({ where: { contentExternalId: item.externalId, kind: "opinion_pdf" } })
      : Promise.resolve([]),
  ]);
  const memberThreadIds = new Set(threadMemberships.map((m) => m.threadId));
  const isOpinion = item.sourceDataset === "opinions";
  const primaryDoc = pickPrimaryDoc(sourceDocs);
  const relatedContentIds = new Set(
    relatedLinks.map((link) => (link.fromContentId === item.id ? link.toContentId : link.fromContentId))
  );
  const availableLinkCandidates = linkCandidates
    .filter((candidate) => !relatedContentIds.has(candidate.id))
    .map((candidate) => ({
      ...candidate,
      date: candidate.date?.toISOString() ?? null,
    }));

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
  const importedTopicPrimary = item.topicPrimary;
  const importedTopicSecondary = item.topicSecondary || currentTopics;
  const importedActivityPrimary = item.activityPrimary;
  const importedActivitySecondary = item.activitySecondary || currentActivities;
  const importedFilterTags = item.publicActivityFilterTags || currentActivities;
  const importedDisplayTags = item.publicActivityDisplayTags || currentActivities;
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

      {(status.linked || status.unlinked || status.linkError) && (
        <div className="card notice">
          {status.linked && (
            <p style={{ margin: 0 }}>
              {Number(status.linked) > 1 ? `${status.linked} seotud allikat lisatud.` : "Seotud allikas lisatud."}
            </p>
          )}
          {status.unlinked && <p style={{ margin: 0 }}>Seotud allikas eemaldatud.</p>}
          {status.linkError && <p style={{ margin: 0 }}>Seost ei saanud lisada: {status.linkError}</p>}
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
            <option value="">{importLabel(importedTopicPrimary)}</option>
            {PUBLIC_TOPIC_FILTERS.map((topic) => (
              <option key={topic.slug} value={topic.name}>
                {topic.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="topicSecondary">
            Teisesed teemad
          </label>
          <select id="topicSecondary" name="topicSecondary" multiple size={8} defaultValue={splitValues(draft?.topicSecondary)}>
            <option value="" disabled>
              {importLabel(importedTopicSecondary)}
            </option>
            {PUBLIC_TOPIC_FILTERS.map((topic) => (
              <option key={topic.slug} value={topic.name}>
                {topic.name}
              </option>
            ))}
          </select>
          <p className="muted small">Kui midagi ei vali, jääb import. Mitme valimiseks kasuta Ctrl/Cmd-klikki.</p>
          <p className="muted small">Praegu importist: {importedTopicSecondary || "—"}</p>
        </fieldset>

        <fieldset>
          <legend>Tegevusala</legend>
          <label className="field-label" htmlFor="activityPrimary">
            Peamine tegevusala
          </label>
          <select id="activityPrimary" name="activityPrimary" defaultValue={draft?.activityPrimary ?? ""}>
            <option value="">{importLabel(importedActivityPrimary)}</option>
            {PUBLIC_ACTIVITY_FILTERS.map((activity) => (
              <option key={activity.slug} value={activity.name}>
                {activity.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="activitySecondary">
            Teisesed tegevusalad
          </label>
          <select id="activitySecondary" name="activitySecondary" multiple size={8} defaultValue={splitValues(draft?.activitySecondary)}>
            <option value="" disabled>
              {importLabel(importedActivitySecondary)}
            </option>
            {PUBLIC_ACTIVITY_FILTERS.map((activity) => (
              <option key={activity.slug} value={activity.name}>
                {activity.name}
              </option>
            ))}
          </select>
          <p className="muted small">Kui midagi ei vali, jääb import. Valitud sektorile luuakse avaldamisel tag, kui seda veel ei ole.</p>
          <p className="muted small">Praegu importist: {importedActivitySecondary || "—"}</p>
        </fieldset>

        <fieldset>
          <legend>Sildid ja sektorilehed</legend>
          <label className="field-label" htmlFor="publicActivityFilterTags">
            public_activity_filter_tags
          </label>
          <select id="publicActivityFilterTags" name="publicActivityFilterTags" multiple size={7} defaultValue={splitValues(draft?.publicActivityFilterTags)}>
            <option value="" disabled>
              {importLabel(importedFilterTags)}
            </option>
            {FILTER_TAG_OPTIONS.map((activity) => (
              <option key={activity.name} value={activity.name}>
                {activity.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="publicActivityDisplayTags">
            public_activity_display_tags
          </label>
          <select id="publicActivityDisplayTags" name="publicActivityDisplayTags" multiple size={7} defaultValue={splitValues(draft?.publicActivityDisplayTags)}>
            <option value="" disabled>
              {importLabel(importedDisplayTags)}
            </option>
            {PUBLIC_ACTIVITY_FILTERS.map((activity) => (
              <option key={activity.slug} value={activity.name}>
                {activity.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="publicSectorPageAllowed">
            public_sector_page_allowed
          </label>
          <select id="publicSectorPageAllowed" name="publicSectorPageAllowed" defaultValue={draft?.publicSectorPageAllowed ?? ""}>
            <option value="">{importLabel(item.publicSectorPageAllowed)}</option>
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

      {isOpinion && (
        <div className="card">
          <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Pöördumise PDF</h2>
          {primaryDoc ? (
            <table className="admin-table">
              <tbody>
                <tr>
                  <td>Pöördumise PDF</td>
                  <td>
                    {primaryDoc.fileVerified ? (
                      <span className="flag evergreen">olemas</span>
                    ) : (
                      <span className="flag hidden">fail puudub kettalt</span>
                    )}
                  </td>
                </tr>
                <tr><td>Fail</td><td>{primaryDoc.pdfFilename}</td></tr>
                <tr><td>Algne failinimi</td><td>{primaryDoc.originalFilename}</td></tr>
                <tr>
                  <td>Ava PDF</td>
                  <td>
                    <a href={primaryDoc.pdfUrl} target="_blank" rel="noopener noreferrer">
                      {primaryDoc.pdfUrl}
                    </a>
                  </td>
                </tr>
                <tr><td>Tekst</td><td>{primaryDoc.txtFilename ? "olemas" : "puudub"}</td></tr>
                <tr><td>Extraction status</td><td>{primaryDoc.extractionStatus ?? "—"}</td></tr>
                <tr><td>Vaste</td><td>{primaryDoc.matchMethod ?? "—"} · {primaryDoc.matchConfidence ?? "—"}</td></tr>
                {sourceDocs.length > 1 && (
                  <tr><td>Lisadokumendid</td><td>{sourceDocs.length - 1}</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <p className="muted small">
              ⚠ Pöördumise PDF puudub — sellele arvamusele pole veel seotud allikadokumenti.
            </p>
          )}
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
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Teemaliinid / ajajoon</h2>
        {!item.externalId && (
          <p className="muted small">
            Sellel sisuelemendil puudub stabiilne externalId, mistõttu seda ei saa teemaliini lisada.
          </p>
        )}
        {item.externalId && threadMemberships.length === 0 && (
          <p className="muted small">Ei kuulu ühtegi teemaliini.</p>
        )}
        {threadMemberships.map((m) => (
          <p key={m.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href={`/admin/threads/${m.threadId}`}>{m.thread.title}</Link>
            <span className="tag">{statusLabel(m.thread.status)}</span>
            {m.role && <span className="tag">{roleLabel(m.role)}</span>}
            <form method="post" action={`/api/admin/content/${item.id}`} className="inline-form">
              <input type="hidden" name="_action" value="detach-thread" />
              <input type="hidden" name="threadId" value={m.threadId} />
              <input type="hidden" name="_redirect" value={`/admin/content/${item.id}`} />
              <button type="submit" className="btn btn-secondary btn-small">
                Eemalda
              </button>
            </form>
          </p>
        ))}
        {item.externalId && (
          <form
            method="post"
            action={`/api/admin/content/${item.id}`}
            style={{ display: "flex", gap: 10, flexWrap: "wrap" }}
          >
            <input type="hidden" name="_action" value="attach-to-thread" />
            <input type="hidden" name="_redirect" value={`/admin/content/${item.id}`} />
            <select name="threadId" required style={{ maxWidth: 320 }}>
              <option value="">— Vali teemaliin —</option>
              {allThreads
                .filter((t) => !memberThreadIds.has(t.id))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
            <select name="role" defaultValue="" style={{ maxWidth: 180 }}>
              <option value="">Roll (valikuline)</option>
              {THREAD_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn-secondary btn-small">
              Lisa teemaliini
            </button>
          </form>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Seotud allikad</h2>
        <p className="muted small">
          Seo uudis, arvamus või muu sisu sama teemaga. Avalikus otsingus saab seotud uudis/arvamus ilmuda ühe kaardina,
          kus uuem kirje on peal ja teine on pesastatud all.
        </p>
        {relatedLinks.length === 0 && <p className="muted small">Seotud allikaid ei ole veel lisatud.</p>}
        {relatedLinks.length > 0 && (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Seotud sisu</th>
                <th>Tüüp</th>
                <th>Suund</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {relatedLinks.map((link) => {
                const other = link.fromContentId === item.id ? link.to : link.from;
                const direction = link.fromContentId === item.id ? "sellest sisust" : "sellele sisule";
                return (
                  <tr key={link.id}>
                    <td>
                      <Link href={`/admin/content/${other.id}`}>
                        {other.externalId ? `${other.externalId} · ` : ""}
                        {other.displayTitle || other.title}
                      </Link>
                      <div className="muted small">{other.sourceDataset || other.sourceTypeDetail || "sisu"}</div>
                    </td>
                    <td>{evidenceLinkLabel(link.linkType)}</td>
                    <td>{direction}</td>
                    <td>
                      <form method="post" action={`/api/admin/content/${item.id}`} className="inline-form">
                        <input type="hidden" name="_action" value="remove-related-link" />
                        <input type="hidden" name="relatedLinkId" value={link.id} />
                        <button type="submit" className="btn btn-secondary btn-small">
                          Eemalda
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <RelatedContentPicker
          action={`/api/admin/content/${item.id}`}
          candidates={availableLinkCandidates}
          linkTypes={[...RELATED_LINK_TYPE_OPTIONS]}
          defaultLinkType={EvidenceLinkType.related_news}
        />
        <form
          method="post"
          action={`/api/admin/content/${item.id}`}
          style={{ display: "none" }}
          aria-hidden="true"
        >
          <input type="hidden" name="_action" value="add-related-link" />
          <div>
            <label className="field-label" htmlFor="targetContent">
              Seotava sisu ID või URL
            </label>
            <input id="targetContent" name="targetContent" placeholder="WEB-01205 või /sisu/WEB-01205" required />
          </div>
          <div>
            <label className="field-label" htmlFor="linkType">
              Seose tüüp
            </label>
            <select id="legacyLinkType" name="linkType" defaultValue={EvidenceLinkType.related_news}>
              {RELATED_LINK_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="sortPriority">
              Järjekord
            </label>
            <input id="legacySortPriority" name="sortPriority" type="number" defaultValue="50" />
          </div>
          <button type="submit" className="btn btn-secondary btn-small">
            Lisa seos
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
