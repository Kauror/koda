import { Suspense } from "react";
import Link from "next/link";
import SearchForm from "./SearchForm";
import { getFilterOptions, type FilterOptions } from "@/lib/search";
import { getHomepageSiteTexts } from "@/lib/site-texts";

export const dynamic = "force-dynamic";

const fallbackOption = (slug: string, name: string) => ({ slug, name, count: 0 });

const FALLBACK_FILTER_OPTIONS: FilterOptions = {
  tegevusalad: [
    fallbackOption("toostus-ja-tootmine", "Tööstus ja tootmine"),
    fallbackOption("kaubandus", "Kaubandus"),
    fallbackOption("ehitus-ja-kinnisvara", "Ehitus ja kinnisvara"),
    fallbackOption("finants-kindlustus-ja-krediit", "Finants, kindlustus ja krediit"),
    fallbackOption("energia-ja-ressursimahukas-tegevus", "Energia ja ressursimahukas tegevus"),
    fallbackOption("ariteenused-ja-kutseteenused", "Äriteenused ja kutseteenused"),
    fallbackOption("pollumajandus-metsandus-ja-kalandus", "Põllumajandus, metsandus ja kalandus"),
    fallbackOption("majutus-toitlustus-ja-turism", "Majutus, toitlustus ja turism"),
    fallbackOption("transport-ja-logistika", "Transport ja logistika"),
    fallbackOption("haridus-ja-koolitus", "Haridus ja koolitus"),
    fallbackOption("tervishoid-farmaatsia-ja-meditsiiniseadmed", "Tervishoid, farmaatsia ja meditsiiniseadmed"),
    fallbackOption("info-side-ja-it", "Info, side ja IT"),
  ],
  valdkonnad: [
    fallbackOption("maksud-tasud-ja-aruandlus", "Maksud, tasud ja aruandlus"),
    fallbackOption("too-ja-sotsiaalpoliitika", "Töö ja sotsiaalpoliitika"),
    fallbackOption("haridus-oskused-ja-toojou-jarelkasv", "Haridus, oskused ja tööjõu järelkasv"),
    fallbackOption("valistoojoud-ja-ranne", "Välistööjõud ja ränne"),
    fallbackOption("keskkond-kliima-ja-jaatmed", "Keskkond, kliima ja jäätmed"),
    fallbackOption("energia", "Energia"),
    fallbackOption("pakendid", "Pakendid"),
    fallbackOption("tarbijakaitse-ja-muugireeglid", "Tarbijakaitse ja müügireeglid"),
    fallbackOption("e-kaubandus-ja-digiteenused", "E-kaubandus ja digiteenused"),
    fallbackOption("andmekaitse-kuberturvalisus-ja-ai", "Andmekaitse, küberturvalisus ja AI"),
    fallbackOption("valiskaubandus-ja-eksport", "Väliskaubandus ja eksport"),
    fallbackOption("euroopa-liit", "Euroopa Liit"),
    fallbackOption("riigihanked", "Riigihanked"),
    fallbackOption("halduskoormus-ja-aruandlus", "Halduskoormus ja aruandlus"),
    fallbackOption("ettevotluskeskkond-ja-konkurentsivoime", "Ettevõtluskeskkond ja konkurentsivõime"),
    fallbackOption("kinnisvara-planeerimine-ja-ehitus", "Kinnisvara, planeerimine ja ehitus"),
  ],
  tapsustused: [],
};

function withFallbackOptions(options: FilterOptions): FilterOptions {
  return {
    tegevusalad: options.tegevusalad.length ? options.tegevusalad : FALLBACK_FILTER_OPTIONS.tegevusalad,
    valdkonnad: options.valdkonnad.length ? options.valdkonnad : FALLBACK_FILTER_OPTIONS.valdkonnad,
    tapsustused: options.tapsustused,
  };
}

export default async function HomePage() {
  const [options, texts] = await Promise.all([
    getFilterOptions().catch(() => {
      console.warn("Failed to load filter options; using fallback filter list.");
      return FALLBACK_FILTER_OPTIONS;
    }),
    getHomepageSiteTexts(),
  ]);
  const filterOptions = withFallbackOptions(options);

  return (
    <main>
      <section className="hero">
        <div className="container">
          <span className="eyebrow">{texts["homepage.hero.eyebrow"]}</span>
          <h1>{texts["homepage.hero.title"]}</h1>
          <p className="lead">{texts["homepage.hero.lead"]}</p>
        </div>
      </section>

      <section className="section" id="vorm">
        <div className="container-narrow">
          <Suspense>
            <SearchForm options={filterOptions} />
          </Suspense>
        </div>
      </section>

      {filterOptions.valdkonnad.length > 0 && (
        <section className="section">
          <div className="container-narrow">
            <h2 className="section-heading">{texts["homepage.topics.title"]}</h2>
            {texts["homepage.topics.description"] && (
              <p className="section-intro">{texts["homepage.topics.description"]}</p>
            )}
            <div className="theme-links">
              {filterOptions.valdkonnad.map((t) => (
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
          {texts["homepage.footerNote"] && (
            <p className="section-intro" style={{ marginTop: 20, marginBottom: 0 }}>
              {texts["homepage.footerNote"]}
            </p>
          )}
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
