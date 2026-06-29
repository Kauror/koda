import type { Metadata } from "next";
import Link from "next/link";
import { Barlow } from "next/font/google";
import "./globals.css";

/**
 * Brand typeface is FF DIN Pro (Koda CVI). It is licensed and not bundled;
 * Barlow is the closest freely available match and is exposed as
 * --font-din-fallback so the CSS stack "FF DIN Pro", Barlow, Arial works
 * now and picks up the real font automatically once its @font-face is added.
 */
const barlow = Barlow({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-din-fallback",
});

const DEFAULT_APP_URL = "https://koda.orgusaar.ee";

/**
 * Resolve metadataBase defensively: a malformed APP_URL (e.g. missing the
 * https:// scheme) must not throw here, or the root layout would 500 every page.
 */
function resolveMetadataBase(): URL {
  for (const candidate of [process.env.APP_URL, DEFAULT_APP_URL]) {
    if (!candidate) continue;
    try {
      return new URL(candidate);
    } catch {
      // try the next candidate
    }
  }
  return new URL(DEFAULT_APP_URL);
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "Mida on koda teinud sinu ettevõtte heaks? | Eesti Kaubandus-Tööstuskoda",
  description:
    "Vali oma ettevõtte tegevusala ja vaata, mida Eesti Kaubandus-Tööstuskoda on sinu valdkonna ettevõtete heaks teinud.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="et" className={barlow.variable}>
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              {/* Official logo from koda.ee (themes/custom/ekt). */}
              <img src="/koda-logo-mobile.svg" alt="Eesti Kaubandus-Tööstuskoda" className="brand-logo" />
              <span className="brand-text">
                <span>Koja mõju sinu ettevõttele</span>
              </span>
            </Link>
            <nav aria-label="Peamenüü">
              <a href="https://www.koda.ee/et/meie-moju/hetkel-kasil" target="_blank" rel="noopener noreferrer">
                Hetkel käsil
              </a>
              <a href="https://www.koda.ee/et/liikmed/miks-olla-meie-liige" target="_blank" rel="noopener noreferrer">
                Liikmelisus
              </a>
              <a href="https://www.koda.ee" target="_blank" rel="noopener noreferrer">
                koda.ee
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container">
            <p>
              Privaatsus: Valitud filtreid võidakse kasutada anonüümselt tööriista parandamiseks.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
