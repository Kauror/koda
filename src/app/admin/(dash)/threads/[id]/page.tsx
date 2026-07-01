import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  THREAD_ROLES,
  THREAD_STATUSES,
  resolveThreadMembers,
  roleLabel,
  statusLabel,
  type ThreadItemMeta,
} from "@/lib/content-threads";

export const dynamic = "force-dynamic";

function contentLabel(c: { title: string; displayTitle: string | null }): string {
  return c.displayTitle || c.title;
}

export default async function AdminThreadEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const thread = await prisma.contentThread.findUnique({
    where: { id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!thread) notFound();

  const externalIds = thread.items.map((i) => i.contentExternalId);

  const [content, candidates] = await Promise.all([
    externalIds.length
      ? prisma.contentItem.findMany({
          where: { externalId: { in: externalIds } },
          select: { id: true, externalId: true, title: true, displayTitle: true, date: true },
        })
      : Promise.resolve([]),
    prisma.contentItem.findMany({
      where: { externalId: { not: null } },
      orderBy: [{ date: { sort: "desc", nulls: "last" } }],
      select: { id: true, externalId: true, title: true, displayTitle: true, date: true },
      take: 500,
    }),
  ]);

  const metas: ThreadItemMeta[] = thread.items.map((i) => ({
    contentExternalId: i.contentExternalId,
    role: i.role,
    note: i.note,
    sortOrder: i.sortOrder,
    isAnchor: i.isAnchor,
  }));
  const { members, unresolved } = resolveThreadMembers(metas, content);

  // Map externalId -> ContentThreadItem.id so member rows can post itemId actions.
  const itemIdByExternalId = new Map(thread.items.map((i) => [i.contentExternalId, i.id]));
  const memberExternalIds = new Set(externalIds);

  return (
    <>
      <p>
        <Link href="/admin/threads">← Tagasi teemaliinide nimekirja</Link>
      </p>
      <h1 style={{ fontSize: "1.4rem" }}>{thread.title}</h1>
      <p className="muted small">
        Olek: {statusLabel(thread.status)} · {members.length} nähtavat liiget
        {unresolved.length > 0 && ` · ${unresolved.length} lahendamata`}
      </p>

      <form method="post" action={`/api/admin/threads/${thread.id}`} className="card form-grid">
        <input type="hidden" name="_action" value="update" />

        <div>
          <label className="field-label" htmlFor="title">
            Pealkiri
          </label>
          <input id="title" type="text" name="title" defaultValue={thread.title} required />
        </div>

        <div>
          <label className="field-label" htmlFor="slug">
            Slug
          </label>
          <input id="slug" type="text" name="slug" defaultValue={thread.slug} required />
        </div>

        <div>
          <label className="field-label" htmlFor="description">
            Lühikirjeldus
          </label>
          <textarea id="description" name="description" defaultValue={thread.description ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="primaryTopic">
            Peamine valdkond (teema)
          </label>
          <input id="primaryTopic" type="text" name="primaryTopic" defaultValue={thread.primaryTopic ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="primarySector">
            Tegevusala (valikuline)
          </label>
          <input id="primarySector" type="text" name="primarySector" defaultValue={thread.primarySector ?? ""} />
        </div>

        <div>
          <label className="field-label" htmlFor="status">
            Olek
          </label>
          <select id="status" name="status" defaultValue={thread.status}>
            {THREAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <span className="muted small">Ainult „Avalik” teemaliin kuvatakse avalikel lehtedel.</span>
        </div>

        <div>
          <label className="field-label" htmlFor="sortPriority">
            Sortimise prioriteet (suurem enne)
          </label>
          <input id="sortPriority" type="number" name="sortPriority" defaultValue={thread.sortPriority} />
        </div>

        <div className="checkbox-row">
          <label className="option-pill">
            <input type="checkbox" name="featured" defaultChecked={thread.featured} />
            Esiletõstetud
          </label>
        </div>

        <div>
          <button type="submit" className="btn">
            Salvesta
          </button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Liikmed ({members.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Pealkiri</th>
              <th>Kuupäev</th>
              <th>Roll</th>
              <th>Järjekord</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const itemId = itemIdByExternalId.get(m.meta.contentExternalId)!;
              return (
                <tr key={itemId}>
                  <td>
                    <Link href={`/admin/content/${m.content.id}`}>{contentLabel(m.content)}</Link>
                    {m.meta.isAnchor && (
                      <span className="flag priority" style={{ marginLeft: 8 }}>
                        ankur
                      </span>
                    )}
                    <div className="muted small">{m.meta.contentExternalId}</div>
                  </td>
                  <td>{m.content.date ? m.content.date.toLocaleDateString("et-EE") : "—"}</td>
                  <td>
                    <form method="post" action={`/api/admin/threads/${thread.id}`} className="inline-form">
                      <input type="hidden" name="_action" value="set-role" />
                      <input type="hidden" name="itemId" value={itemId} />
                      <select name="role" defaultValue={m.meta.role ?? ""}>
                        <option value="">—</option>
                        {THREAD_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </select>{" "}
                      <button type="submit" className="btn btn-secondary btn-small">
                        Salvesta
                      </button>
                    </form>
                  </td>
                  <td>
                    <form method="post" action={`/api/admin/threads/${thread.id}`} className="inline-form">
                      <input type="hidden" name="_action" value="set-sort" />
                      <input type="hidden" name="itemId" value={itemId} />
                      <input
                        type="number"
                        name="sortOrder"
                        defaultValue={m.meta.sortOrder}
                        style={{ width: 64 }}
                      />{" "}
                      <button type="submit" className="btn btn-secondary btn-small">
                        OK
                      </button>
                    </form>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <form method="post" action={`/api/admin/threads/${thread.id}`} className="inline-form">
                      <input type="hidden" name="_action" value="set-anchor" />
                      <input type="hidden" name="itemId" value={itemId} />
                      <button type="submit" className="btn btn-secondary btn-small">
                        Määra ankruks
                      </button>
                    </form>{" "}
                    <form method="post" action={`/api/admin/threads/${thread.id}`} className="inline-form">
                      <input type="hidden" name="_action" value="remove-item" />
                      <input type="hidden" name="itemId" value={itemId} />
                      <button type="submit" className="btn btn-secondary btn-small">
                        Eemalda
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Teemaliinis pole veel sisu.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {unresolved.length > 0 && (
          <div className="status-flags" style={{ marginTop: 12 }}>
            <p className="muted small">
              Lahendamata sisuviited (import eemaldas selle sisu või muutis externalId-d) — eemalda need:
            </p>
            {unresolved.map((ext) => {
              const itemId = itemIdByExternalId.get(ext)!;
              return (
                <form
                  key={itemId}
                  method="post"
                  action={`/api/admin/threads/${thread.id}`}
                  className="inline-form"
                >
                  <input type="hidden" name="_action" value="remove-item" />
                  <input type="hidden" name="itemId" value={itemId} />
                  <span className="flag hidden">{ext}</span>{" "}
                  <button type="submit" className="btn btn-secondary btn-small">
                    Eemalda
                  </button>
                </form>
              );
            })}
          </div>
        )}

        <form
          method="post"
          action={`/api/admin/threads/${thread.id}`}
          style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}
        >
          <input type="hidden" name="_action" value="add-item" />
          <select name="contentExternalId" required style={{ maxWidth: 420 }}>
            <option value="">— Vali sisuelement —</option>
            {candidates
              .filter((c) => c.externalId && !memberExternalIds.has(c.externalId))
              .map((c) => (
                <option key={c.externalId} value={c.externalId!}>
                  {contentLabel(c)}
                  {c.date ? ` · ${c.date.getFullYear()}` : ""}
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
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Ajajoone eelvaade</h2>
        <p className="muted small">
          Kronoloogiline järjestus (vanimast uuemani; „järjekord” alistab kuupäeva). Nii kuvatakse
          teemaliin ka avalikult, kui olek on „Avalik”.
        </p>
        <ol className="nested-timeline">
          {members.map((m) => (
            <li key={m.meta.contentExternalId} className="nested-item">
              <p className="nested-meta">
                {m.content.date && <span className="badge-date">{m.content.date.getFullYear()}</span>}
                {m.meta.role && <span className="badge nested-stage">{roleLabel(m.meta.role)}</span>}
                {m.meta.isAnchor && <span className="badge">Ankur</span>}
              </p>
              <h3 style={{ fontSize: "1rem" }}>{contentLabel(m.content)}</h3>
            </li>
          ))}
          {members.length === 0 && <li className="muted">Ajajoon on tühi.</li>}
        </ol>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: "1.1rem" }}>Kustuta teemaliin</h2>
        <form method="post" action={`/api/admin/threads/${thread.id}`}>
          <input type="hidden" name="_action" value="delete" />
          <button type="submit" className="btn btn-secondary btn-small">
            Kustuta teemaliin (sisu jääb alles)
          </button>
        </form>
      </div>
    </>
  );
}
