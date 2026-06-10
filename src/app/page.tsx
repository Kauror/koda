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
          <ul className="hero-points">
            <li>Põhineb koja enda avalikel seisukohtadel, uudistel ja teemaarendustel.</li>
            <li>Aitab kiiresti näha, miks koja liikmelisus on sinu ettevõttele väärtuslik.</li>
          </ul>
          <div className="hero-actions">
            <a href="#vorm" className="btn">
              Vaata tulemusi
            </a>
            <a
              href="https://www.koda.ee/et/meie-moju/hetkel-kasil"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              Mis on kojal hetkel käsil?
            </a>
          </div>
        </div>
      </section>

      <section className="section" id="vorm">
        <div className="container-narrow">
          <h2 className="section-heading">Sinu ettevõtte profiil</h2>
          <p className="section-intro">
            Ainuüksi tegevusala valik annab juba tulemused. Täpsemad valikud muudavad ülevaate
            sinu ettevõttele asjakohasemaks.
          </p>
          <SearchForm />
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

      <section className="section">
        <div className="container-narrow">
          <h2 className="section-heading">Kuidas see töötab?</h2>
          <div className="steps-grid">
            <div className="step-card">
              <span className="step-number">1. samm</span>
              <h3>Vali profiil</h3>
              <p>Vali tegevusala ning soovi korral ettevõtte suurus, tegevused ja huviteemad.</p>
            </div>
            <div className="step-card">
              <span className="step-number">2. samm</span>
              <h3>Näe asjakohaseid teemasid</h3>
              <p>Koostame koja avaliku töö põhjal ülevaate just sinu ettevõttele olulisest.</p>
            </div>
            <div className="step-card">
              <span className="step-number">3. samm</span>
              <h3>Ava, mida koda on teinud</h3>
              <p>Iga teema juures näed koja seisukohti, töövõite ja viiteid algallikatele.</p>
            </div>
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

      <section className="section">
        <div className="container-narrow">
          <h2 className="section-heading">Osa koja ökosüsteemist</h2>
          <p className="section-intro">
            See tööriist põhineb koja avalikul tööl. Värskeima info leiad alati koja kodulehelt.
          </p>
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
    </main>
  );
}
