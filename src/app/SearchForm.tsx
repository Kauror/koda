"use client";

import { useRouter } from "next/navigation";
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
  const [sector, setSector] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [activities, setActivities] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const toggleIn = (list: string[], set: (v: string[]) => void) => (slug: string) =>
    set(list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sector) {
      setError("Palun vali oma ettevõtte tegevusala.");
      return;
    }
    const params = new URLSearchParams();
    params.set("sektor", sector);
    if (size) params.set("suurus", size);
    if (interests.length) params.set("huvid", interests.join(","));
    if (activities.length) params.set("tegevused", activities.join(","));
    router.push(`/tulemused?${params.toString()}`);
  }

  return (
    <form onSubmit={submit} className="card">
      <fieldset>
        <legend>1. Ettevõtte tegevusala</legend>
        <p className="field-hint">Kohustuslik. Ainuüksi tegevusala valik annab juba tulemused.</p>
        <PillGroup
          options={SECTORS}
          selected={sector ? [sector] : []}
          onToggle={(slug) => {
            setSector(slug);
            setError(null);
          }}
          type="radio"
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
        <p style={{ color: "#9c2b2b", fontWeight: 600, marginTop: 0 }} role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn">
        Näita tulemusi
      </button>

      <p className="privacy-note">
        Me ei küsi sinu ettevõtte nime ega isikuandmeid. Valitud filtreid võime kasutada
        anonüümselt selle tööriista parandamiseks.
      </p>
    </form>
  );
}
