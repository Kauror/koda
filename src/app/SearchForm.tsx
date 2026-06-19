"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FilterOptions } from "@/lib/search";

function isGenericSectorOption(option: { slug: string; name: string }): boolean {
  const text = `${option.slug} ${option.name}`.toLocaleLowerCase("et-EE");
  return (
    text.includes("kõik tegevusalad") ||
    text.includes("koik-tegevusalad") ||
    text.includes("valdkondadeülene") ||
    text.includes("valdkondadeulene")
  );
}

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
  const tegevusalaOptions = options.tegevusalad.filter((option) => !isGenericSectorOption(option));
  const tegevusalaSlugs = new Set(tegevusalaOptions.map((option) => option.slug));

  const [tegevusala, setTegevusala] = useState<string[]>(
    listParam("tegevusala").filter((slug) => tegevusalaSlugs.has(slug))
  );
  const [valdkond, setValdkond] = useState<string[]>(listParam("valdkond"));
  const [showSectorError, setShowSectorError] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(listParam("valdkond").length > 0);

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
    if (tegevusalaOptions.length > 0 && tegevusala.length === 0) {
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
            Vali vähemalt üks tegevusala.
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
              Palun vali tegevusala.
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

      <button
        type="button"
        className="btn btn-secondary btn-small disclosure"
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
      >
        {showAdvanced ? "Peida täpsemad valikud" : "Täpsemad valikud (teema)"}
      </button>

      {showAdvanced && (
        <>
          {options.valdkonnad.length > 0 && (
            <fieldset>
              <legend>Teema / valdkond</legend>
              <p className="field-hint">Vali üks või mitu teemat (valikuline).</p>
              <ChipGroup
                options={options.valdkonnad}
                selected={valdkond}
                onToggle={toggle(valdkond, setValdkond)}
              />
            </fieldset>
          )}

        </>
      )}

      <div className="search-actions">
        <button type="submit" className="btn search-submit">
          Otsi
        </button>
      </div>
    </form>
  );
}
