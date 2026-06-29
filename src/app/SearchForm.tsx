"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FilterOptions } from "@/lib/search";
import { isInternalFallbackActivity } from "@/lib/activities";

function ChipGroup({
  options,
  selected,
  onToggle,
}: {
  options: { slug: string; name: string }[];
  selected: string[];
  onToggle: (slug: string) => void;
}) {
  return (
    <div className="option-grid">
      {options.map((o) => {
        const isSelected = selected.includes(o.slug);
        return (
          <label key={o.slug} className={`option-pill${isSelected ? " selected" : ""}`}>
            <input
              type="checkbox"
              value={o.slug}
              checked={isSelected}
              onChange={() => onToggle(o.slug)}
            />
            {o.name}
          </label>
        );
      })}
    </div>
  );
}

export default function SearchForm({ options }: { options: FilterOptions }) {
  const router = useRouter();
  const params = useSearchParams();
  const listParam = (key: string) =>
    (params.get(key) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const tegevusalaOptions = options.tegevusalad.filter((option) => !isInternalFallbackActivity(option));
  const tegevusalaSlugs = new Set(tegevusalaOptions.map((option) => option.slug));

  const [tegevusala, setTegevusala] = useState<string[]>(
    listParam("tegevusala").filter((slug) => tegevusalaSlugs.has(slug))
  );
  const [valdkond, setValdkond] = useState<string[]>(listParam("valdkond"));
  const [showSectorError, setShowSectorError] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void) => (slug: string) =>
    set(list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);

  const nameOf = (opts: { slug: string; name: string }[], slug: string) =>
    opts.find((o) => o.slug === slug)?.name ?? slug;

  const activeFilters: { key: string; label: string; remove: () => void }[] = [
    ...tegevusala.map((s) => ({
      key: `t-${s}`,
      label: nameOf(tegevusalaOptions, s),
      remove: () => setTegevusala((v) => v.filter((x) => x !== s)),
    })),
    ...valdkond.map((s) => ({
      key: `v-${s}`,
      label: nameOf(options.valdkonnad, s),
      remove: () => setValdkond((v) => v.filter((x) => x !== s)),
    })),
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Tegevusala is no longer mandatory: a search needs at least one filter, but
    // the user may search by Teema alone. Only block a completely
    // empty search.
    const hasAnyFilter = tegevusala.length > 0 || valdkond.length > 0;
    if (!hasAnyFilter) {
      setShowSectorError(true);
      return;
    }
    const p = new URLSearchParams();
    if (tegevusala.length) p.set("tegevusala", tegevusala.join(","));
    if (valdkond.length) p.set("valdkond", valdkond.join(","));
    router.push(`/tulemused?${p.toString()}`);
  }

  return (
    <form onSubmit={submit} className="card search-form">
      {tegevusalaOptions.length > 0 && (
        <fieldset className="search-sector" aria-describedby="tegevusala-hint tegevusala-error">
          <legend>Tegevusala</legend>
          <p className="field-hint" id="tegevusala-hint">
            Vali üks või mitu tegevusala
          </p>
          <ChipGroup
            options={tegevusalaOptions}
            selected={tegevusala}
            onToggle={(slug) => {
              setShowSectorError(false);
              toggle(tegevusala, setTegevusala)(slug);
            }}
          />
          {showSectorError && (
            <p className="field-error" id="tegevusala-error" role="alert">
              Palun vali vähemalt üks tegevusala või teema.
            </p>
          )}
        </fieldset>
      )}

      {activeFilters.length > 0 && (
        <div className="selected-filters" aria-label="Valitud filtrid">
          {activeFilters.map((f) => (
            <button key={f.key} type="button" className="chip-remove" onClick={f.remove}>
              {f.label}
              <span aria-hidden="true"> ×</span>
              <span className="sr-only"> - eemalda filter</span>
            </button>
          ))}
        </div>
      )}

      {options.valdkonnad.length > 0 && (
        <fieldset>
          <legend>Teema</legend>
          <p className="field-hint">Vali üks või mitu teemat</p>
          <ChipGroup
            options={options.valdkonnad}
            selected={valdkond}
            onToggle={(slug) => {
              setShowSectorError(false);
              toggle(valdkond, setValdkond)(slug);
            }}
          />
        </fieldset>
      )}

      <div className="search-actions">
        <button type="submit" className="btn search-submit">
          Otsi
        </button>
      </div>
    </form>
  );
}
