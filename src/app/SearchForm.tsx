"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ACTIVITIES, INTERESTS, SECTORS, SIZES, type Option } from "@/lib/constants";

function PillGroup({
  options,
  selected,
  onToggle,
  type,
  name,
}: {
  options: Option[];
  selected: string[];
  onToggle: (slug: string) => void;
  type: "radio" | "checkbox";
  name: string;
}) {
  return (
    <div className="option-grid">
      {options.map((o) => {
        const isSelected = selected.includes(o.slug);
        return (
          <label key={o.slug} className={`option-pill${isSelected ? " selected" : ""}`}>
            <input
              type={type}
              name={name}
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

export default function SearchForm() {
  const router = useRouter();
  // Prefill from URL params so "Muuda filtreid" on the results page
  // brings the user back with their previous selections intact.
  const params = useSearchParams();
  const listParam = (key: string) =>
    (params.get(key) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const [sectors, setSectors] = useState<string[]>(listParam("sektor"));
  const [size, setSize] = useState<string | null>(params.get("suurus"));
  const [activities, setActivities] = useState<string[]>(listParam("tegevused"));
  const [interests, setInterests] = useState<string[]>(listParam("huvid"));
  const [error, setError] = useState<string | null>(null);

  const toggleIn = (list: string[], set: (v: string[]) => void) => (slug: string) =>
    set(list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sectors.length === 0) {
      setError("Palun vali vähemalt üks tegevusala.");
      return;
    }
    const params = new URLSearchParams();
    params.set("sektor", sectors.join(","));
    if (size) params.set("suurus", size);
    if (interests.length) params.set("huvid", interests.join(","));
    if (activities.length) params.set("tegevused", activities.join(","));
    router.push(`/tulemused?${params.toString()}`);
  }

  return (
    <form onSubmit={submit} className="card">
      <fieldset>
        <legend>1. Ettevõtte tegevusala</legend>
        <p className="field-hint">
          Kohustuslik. Võid valida mitu tegevusala – ainuüksi see valik annab juba tulemused.
        </p>
        <PillGroup
          options={SECTORS}
          selected={sectors}
          onToggle={(slug) => {
            setSectors(
              sectors.includes(slug) ? sectors.filter((s) => s !== slug) : [...sectors, slug]
            );
            setError(null);
          }}
          type="checkbox"
          name="sektor"
        />
      </fieldset>

      <fieldset>
        <legend>2. Ettevõtte suurus (valikuline)</legend>
        <PillGroup
          options={SIZES}
          selected={size ? [size] : []}
          onToggle={(slug) => setSize(size === slug ? null : slug)}
          type="radio"
          name="suurus"
        />
      </fieldset>

      <fieldset>
        <legend>3. Ettevõtte profiil (valikuline)</legend>
        <p className="field-hint">Vali kõik, mis sinu ettevõtte kohta kehtib.</p>
        <PillGroup
          options={ACTIVITIES}
          selected={activities}
          onToggle={toggleIn(activities, setActivities)}
          type="checkbox"
          name="tegevused"
        />
      </fieldset>

      <fieldset>
        <legend>4. Teemad, mis sind huvitavad (valikuline)</legend>
        <PillGroup
          options={INTERESTS}
          selected={interests}
          onToggle={toggleIn(interests, setInterests)}
          type="checkbox"
          name="huvid"
        />
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn">
        Vaata tulemusi
      </button>

      <p className="privacy-note">
        Me ei küsi sinu ettevõtte nime ega isikuandmeid. Valitud filtreid võime kasutada
        anonüümselt selle tööriista parandamiseks.
      </p>
    </form>
  );
}
