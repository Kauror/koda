"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { FilterOptions } from "@/lib/search";

const RESULT_TYPES = ["toovoit", "arvamus", "uudis"] as const;
type ResultType = (typeof RESULT_TYPES)[number];

const RESULT_TYPE_LABELS: Record<ResultType, string> = {
  toovoit: "Töövõit",
  arvamus: "Arvamus",
  uudis: "Uudis",
};

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

  const [q, setQ] = useState<string>(params.get("q") || "");
  const [tegevusala, setTegevusala] = useState<string[]>(
    listParam("tegevusala").filter((slug) => tegevusalaSlugs.has(slug))
  );
  const [valdkond, setValdkond] = useState<string[]>(listParam("valdkond"));
  const [tapsustus, setTapsustus] = useState<string[]>(listParam("tapsustus"));
  const [type, setType] = useState<string[]>(
    listParam("type").filter((slug) => RESULT_TYPES.includes(slug as ResultType))
  );
  const [showSectorError, setShowSectorError] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    listParam("valdkond").length > 0 || listParam("tapsustus").length > 0 || listParam("type").length > 0
  );

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
    ...tapsustus.map((s) => ({
      key: `p-${s}`,
      label: nameOf(options.tapsustused, s),
      remove: () => setTapsustus((v) => v.filter((x) => x !== s)),
    })),
    ...type.map((s) => ({
      key: `r-${s}`,
      label: RESULT_TYPE_LABELS[s as ResultType] ?? s,
      remove: () => setType((v) => v.filter((x) => x !== s)),
    })),
  ];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tegevusalaOptions.length > 0 && tegevusala.length === 0) {
      setShowSectorError(true);
      return;
    }
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (tegevusala.length) p.set("tegevusala", tegevusala.join(","));
    if (valdkond.length) p.set("valdkond", valdkond.join(","));
    if (tapsustus.length) p.set("tapsustus", tapsustus.join(","));
    if (type.length) p.set("type", type.join(","));
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

      <div className="search-primary">
        <label className="field-label" htmlFor="q">
          Otsi teemat või märksõna
        </label>
        <div className="search-row">
          <input
            id="q"
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Nt maksud, välistööjõud, mida on koda saavutanud..."
            className="search-input search-input--primary"
            aria-label="Otsi teemat või märksõna"
            enterKeyHint="search"
          />
          <button type="submit" className="btn search-submit">
            Otsi
          </button>
        </div>
        <p className="field-hint">
          Alusta tegevusalast ja lisa soovi korral märksõna või teema.
        </p>
      </div>

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
        {showAdvanced ? "Peida täpsemad valikud" : "Täpsemad valikud (teema, olukord)"}
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

          {options.tapsustused.length > 0 && (
            <fieldset>
              <legend>Ettevõtte olukord / täpsustus</legend>
              <ChipGroup
                options={options.tapsustused}
                selected={tapsustus}
                onToggle={toggle(tapsustus, setTapsustus)}
              />
            </fieldset>
          )}

          <fieldset>
            <legend>Tulemuse tüüp</legend>
            <p className="field-hint">Valikuline täpsustus, kui soovid näha ainult kindlat liiki tulemusi.</p>
            <ChipGroup
              options={RESULT_TYPES.map((slug) => ({ slug, name: RESULT_TYPE_LABELS[slug] }))}
              selected={type}
              onToggle={toggle(type, setType)}
            />
          </fieldset>
        </>
      )}

    </form>
  );
}
