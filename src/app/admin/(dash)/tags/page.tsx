import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const TAG_TYPE_LABELS: Record<string, string> = {
  sector: "Sektor",
  interest: "Huviteema",
  size: "Suurus",
  activity: "Tegevusprofiil",
  region: "Regioon",
  service: "Teenus",
};

export default async function AdminTagsPage() {
  const tags = await prisma.tag.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: { contentItems: true, topicGroups: true },
  });

  const types = ["sector", "interest", "activity", "size", "region", "service"];

  return (
    <>
      <h1>Sildid ({tags.length})</h1>

      <form method="post" action="/api/admin/tags" className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <select name="type" required>
          {types.map((t) => (
            <option key={t} value={t}>
              {TAG_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input type="text" name="name" placeholder="Sildi nimi" required style={{ maxWidth: 280 }} />
        <button type="submit" className="btn btn-small">
          Lisa silt
        </button>
      </form>

      {types.map((type) => {
        const typeTags = tags.filter((t) => t.type === type);
        if (typeTags.length === 0) return null;
        return (
          <div key={type} className="card">
            <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>{TAG_TYPE_LABELS[type]}</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nimi</th>
                  <th>Slug</th>
                  <th>Kasutusi (sisu / grupid)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {typeTags.map((tag) => (
                  <tr key={tag.id}>
                    <td>{tag.name}</td>
                    <td>{tag.slug}</td>
                    <td>
                      {tag.contentItems.length} / {tag.topicGroups.length}
                    </td>
                    <td>
                      <form method="post" action={`/api/admin/tags/${tag.id}`} className="inline-form">
                        <input type="hidden" name="_action" value="delete" />
                        <button type="submit" className="btn btn-secondary btn-small">
                          Kustuta
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
