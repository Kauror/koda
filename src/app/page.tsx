import { Suspense } from "react";
import Link from "next/link";
import SearchForm from "./SearchForm";
import { getFilterOptions, type FilterOptions } from "@/lib/search";
import { getHomepageSiteTexts } from "@/lib/site-texts";

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

const EMPTY_OPTIONS: FilterOptions = { valdkonnad: [], tegevusalad: [], tapsustused: [] };

export default async function HomePage() {
  const [options, texts] = await Promise.all([
    getFilterOptions().catch(() => {
      console.warn("Failed to load filter options; using empty filter list.");
      return EMPTY_OPTIONS;
    }),
    getHomepageSiteTexts(),
  ]);

  return (
    <main>
      <section className="hero">
        <div className="container">
          <span className="eyebrow">{texts["homepage.hero.eyebrow"]}</span>
          <h1>{texts["homepage.hero.title"]}</h1>
          <p className="lead">{texts["homepage.hero.lead"]}</p>
          <p className="lead-note">{texts["homepage.hero.note"]}</p>
        </div>
      </section>

      <section className="section" id="vorm">
        <div className="container-narrow">
          <Suspense>
            <SearchForm options={options} />
          </Suspense>

          <div className="examples">
            <span className="examples-label">{texts["homepage.search.examplesTitle"]}</span>
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
            <h2 className="section-heading">{texts["homepage.topics.title"]}</h2>
            <p className="section-intro">{texts["homepage.topics.description"]}</p>
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
          <h2 className="section-heading">{texts["homepage.explainer.title"]}</h2>
          <p className="section-intro">{texts["homepage.explainer.body"]}</p>
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

      <section className="section" aria-label="Koja kokkuvõte">
        <div className="container-narrow">
          <p className="section-intro">{texts["homepage.footerNote"]}</p>
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
