import { Suspense } from "react";
import Link from "next/link";
import SearchForm from "./SearchForm";
import { INTERESTS } from "@/lib/constants";

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="container">
          <span className="eyebrow">Koja mõju sinu ettevõttele</span>
          <h1>Vaata, mida on koda teinud sinu ettevõtte heaks</h1>
          <p className="lead">
            Vali oma ettevõtte tegevusala ja huvid ning näitame sulle kõige asjakohasemaid koja
            seisukohti, töövõite ja käsilolevaid teemasid.
          </p>
          <ol className="steps-row" aria-label="Kuidas see töötab">
            <li>
              <strong>1. Vali enda tegevusala ja huvipakkuvad teemad</strong>
            </li>
            <li>
              <strong>2. Tutvu koja arvamuste ja saavutustega</strong>
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="vorm">
        <div className="container-narrow">
          <h2 className="section-heading">Sinu tegevusvaldkond ning huvid</h2>
          <p className="section-intro">
            Ainuüksi tegevusala valik annab juba tulemused. Täpsemad valikud muudavad ülevaate
            sinu ettevõttele asjakohasemaks.
          </p>
          <Suspense>
            <SearchForm />
          </Suspense>
        </div>
      </section>

      <section className="section">
        <div className="container-narrow">
          <h2 className="section-heading">Sirvi koja seisukohti teemade kaupa</h2>
          <p className="section-intro">
            Ei taha profiili valida? Vaata kõiki koja ettepanekuid ja seisukohti ühe teema kohta.
          </p>
          <div className="theme-links">
            {INTERESTS.map((t) => (
              <Link key={t.slug} href={`/tulemused?huvid=${t.slug}`} className="theme-link">
                {t.name}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section" aria-label="Koja kodulehe viited">
        <div className="container-narrow">
          <div className="theme-links">
            <a
              href="https://www.koda.ee/et/uudised/meie_uudised"
              target="_blank"
              rel="noopener noreferrer"
              className="theme-link"
            >
              Uudised
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
