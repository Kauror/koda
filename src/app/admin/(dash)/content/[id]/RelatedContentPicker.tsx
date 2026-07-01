"use client";

import { useMemo, useState } from "react";

type RelatedContentCandidate = {
  id: string;
  externalId: string | null;
  title: string;
  displayTitle: string | null;
  date: string | null;
  sourceDataset: string | null;
  sourceTypeDetail: string | null;
};

type LinkTypeOption = {
  value: string;
  label: string;
};

type Props = {
  action: string;
  candidates: RelatedContentCandidate[];
  linkTypes: LinkTypeOption[];
  defaultLinkType: string;
};

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[äàáâãå]/g, "a")
    .replace(/[öòóôõ]/g, "o")
    .replace(/[üùúû]/g, "u")
    .replace(/[õ]/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function candidateTitle(candidate: RelatedContentCandidate): string {
  return candidate.displayTitle || candidate.title;
}

function candidateMeta(candidate: RelatedContentCandidate): string {
  const parts = [
    candidate.externalId,
    candidate.date ? new Date(candidate.date).toLocaleDateString("et-EE") : null,
    candidate.sourceDataset || candidate.sourceTypeDetail,
  ].filter(Boolean);
  return parts.join(" · ");
}

export default function RelatedContentPicker({ action, candidates, linkTypes, defaultLinkType }: Props) {
  const [query, setQuery] = useState("");
  const [manualTarget, setManualTarget] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const normalizedQuery = normalizeSearchText(query);
  const selectedCount = selectedIds.size;

  const rows = useMemo(() => {
    const matching = candidates.filter((candidate) => {
      if (selectedIds.has(candidate.id)) return true;
      if (!normalizedQuery) return true;
      const haystack = normalizeSearchText(
        [
          candidate.id,
          candidate.externalId,
          candidateTitle(candidate),
          candidate.sourceDataset,
          candidate.sourceTypeDetail,
        ]
          .filter(Boolean)
          .join(" ")
      );
      return haystack.includes(normalizedQuery);
    });

    return matching.sort((a, b) => {
      const aSelected = selectedIds.has(a.id);
      const bSelected = selectedIds.has(b.id);
      if (aSelected !== bSelected) return aSelected ? -1 : 1;
      const dateOrder = (b.date ?? "").localeCompare(a.date ?? "");
      if (dateOrder !== 0) return dateOrder;
      return candidateTitle(a).localeCompare(candidateTitle(b), "et");
    });
  }, [candidates, normalizedQuery, selectedIds]);

  const visibleRows = rows.slice(0, 160);
  const hiddenCount = Math.max(rows.length - visibleRows.length, 0);
  const canSubmit = selectedCount > 0 || manualTarget.trim().length > 0;

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <form method="post" action={action} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="_action" value="add-related-link" />
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(240px, 1fr) 190px 90px", alignItems: "end" }}>
        <div>
          <label className="field-label" htmlFor="relatedContentSearch">
            Otsi seotavat sisu
          </label>
          <input
            id="relatedContentSearch"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Otsi pealkirja või WEB-ID järgi"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="linkType">
            Seose tüüp
          </label>
          <select id="linkType" name="linkType" defaultValue={defaultLinkType}>
            {linkTypes.map((option) => (
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
          <input id="sortPriority" name="sortPriority" type="number" defaultValue="50" />
        </div>
      </div>

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(220px, 1fr) auto", alignItems: "end" }}>
        <div>
          <label className="field-label" htmlFor="targetContentText">
            Lisa ID või URL käsitsi
          </label>
          <input
            id="targetContentText"
            name="targetContentText"
            value={manualTarget}
            onChange={(event) => setManualTarget(event.target.value)}
            placeholder="WEB-01205 või /sisu/WEB-01205"
          />
        </div>
        <button type="submit" className="btn btn-secondary btn-small" disabled={!canSubmit}>
          Lisa seosed{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
      </div>

      <div className="muted small">
        {selectedCount > 0 ? `${selectedCount} valitud · ` : ""}
        {rows.length} vastet
        {hiddenCount > 0 ? ` · näitan esimest ${visibleRows.length}` : ""}
      </div>

      <div
        style={{
          border: "1px solid #d6dce5",
          borderRadius: 8,
          maxHeight: 360,
          overflow: "auto",
          background: "#fff",
        }}
      >
        {visibleRows.length === 0 && <p className="muted small" style={{ margin: 12 }}>Sobivat sisu ei leitud.</p>}
        {visibleRows.map((candidate) => {
          const checked = selectedIds.has(candidate.id);
          return (
            <label
              key={candidate.id}
              style={{
                display: "grid",
                gridTemplateColumns: "24px minmax(0, 1fr)",
                gap: 10,
                alignItems: "start",
                padding: "10px 12px",
                borderBottom: "1px solid #edf0f4",
                background: checked ? "#f1f7ff" : "#fff",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                name="targetContent"
                value={candidate.id}
                checked={checked}
                onChange={() => toggleSelected(candidate.id)}
                style={{ marginTop: 3 }}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontWeight: checked ? 700 : 600 }}>
                  {candidateTitle(candidate)}
                </span>
                <span className="muted small">{candidateMeta(candidate) || "sisu"}</span>
              </span>
            </label>
          );
        })}
      </div>
    </form>
  );
}
