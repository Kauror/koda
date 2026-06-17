import { Suspense } from "react";
import Link from "next/link";
import SearchForm from "./SearchForm";
import { getFilterOptions } from "@/lib/search";

export const dynamic = "force-dynamic";

// Example searches shown on the homepage (source-based discovery prompts).
const EXAMPLE_SEARCHES: { label: string; href: string }[] = [
  { label: "Maksud ja aruandlus", href: "/tulemused?q=maksud" },
  { label: "Tööjõud ja tööõigus", href: "/tulemused?q=t%C3%B6%C3%B6j%C3%B5ud" },
  { label: "Pakendid", href: "/tulemused?q=pakendid" },
  { label: "Energia", href: "/tulemused?q=energia" },
  { label: "Välistööjõud", href: "/tulemused?q=v%C3%A4list%C3%B6%C3%B6j%C3%B5ud" },
  { label: "Ekspordiga seotud teemad", href: "/tulemused?q=eksport" },
  { label: "Mida on koda saavutanud?", href: "/tulemused?type=toovoit" },
];

export default async function HomePage() {
  const options = await getFilterOptions();

  return (
    <main>
      <section className="hero">
        <div className="container">
          <span className="eyebrow">Allikapõhine ülevaade koja tööst</span>
          <h1>Mida on koda sinu ettevõtte jaoks teinud ja öelnud?</h1>
          <p className="lead">
            Allikapõhine ülevaade sellest, mida Eesti Kaubandus-Tööstuskoda on ettevõtjate huvide
            kaitseks teinud ja öelnud. Otsi konkreetseid töövõite, koja seisukohti ja teemade
            tausta – kõik viidetega algallikatele.
          </p>
          <p className="lead-note">
            See ei ole vestlusrobot ega uudistearhiiv. Tulemused põhinevad koja avalikel
            materjalidel ja indekseeritud allikatel.
          </p>
        </div>
      </section>

      <section className="section" id="vorm">
        <div className="container-narrow">
          <Suspense>
            <SearchForm options={options} />
          </Suspense>

          <div className="examples">
            <span className="examples-label">Näiteks:</span>
            <div className="theme-links">
              {EXAMPLE_SEARCHES.map((e) => (
                <Link key={e.href} href={e.href} className="theme-link">
                  {e.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {options.valdkonnad.length > 0 && (
        <section className="section">
          <div className="container-narrow">
            <h2 className="section-heading">Sirvi teemade kaupa</h2>
            <p className="section-intro">
              Ei taha otsida? Vaata koja tööd ühe teema kaupa.
            </p>
            <div className="theme-links">
              {options.valdkonnad.map((t) => (
                <Link
                  key={t.slug}
                  href={`/tulemused?valdkond=${encodeURIComponent(t.slug)}`}
                  className="theme-link"
                >
                  {t.name}
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section" aria-label="Koja kodulehe viited">
        <div className="container-narrow">
          <h2 className="section-heading">Otse koja kodulehel</h2>
          <div className="theme-links">
            <a
              href="https://www.koda.ee/et/meie-moju/meie-toovoidud"
              target="_blank"
              rel="noopener noreferrer"
              className="theme-link"
            >
              Töövõidud
            </a>
            <a
              href="https://www.koda.ee/et/meie-arvamus"
              target="_blank"
              rel="noopener noreferrer"
              className="theme-link"
            >
              Meie arvamus
            </a>
            <a
              href="https://www.koda.ee/et/meie-moju/hetkel-kasil"
              target="_blank"
              rel="noopener noreferrer"
              className="theme-link"
            >
              Hetkel käsil
            </a>
            <a
              href="https://www.koda.ee/et/teenused"
              target="_blank"
              rel="noopener noreferrer"
              className="theme-link"
            >
              Teenused
            </a>
          </div>
        </div>
      </section>

      <section className="stat-strip" aria-label="Koda numbrites">
        <div className="container">
          <div className="stat">
            <strong>3400+</strong>
            <span>ettevõtet on koja liikmed</span>
          </div>
          <div className="stat">
            <strong>1925</strong>
            <span>aastast esindame Eesti ettevõtjate huve</span>
          </div>
          <div className="stat">
            <strong>100+</strong>
            <span>seisukohta ja ettepanekut riigile igal aastal</span>
          </div>
          <div className="stat">
            <strong>Teenused</strong>
            <span>väliskaubandusdokumendid, nõustamine, kontaktid</span>
          </div>
        </div>
      </section>
    </main>
  );
}
