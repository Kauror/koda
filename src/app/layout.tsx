import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

const appUrl = process.env.APP_URL || "https://liige.orgusaar.ee";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Mida on koda teinud sinu ettevõtte heaks? | Eesti Kaubandus-Tööstuskoda",
  description:
    "Vali oma ettevõtte tegevusala ja vaata, mida Eesti Kaubandus-Tööstuskoda on sinu valdkonna ettevõtete heaks teinud.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="et">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              Kaubandus-Tööstuskoda <span>· liikmeväärtus</span>
            </Link>
            <nav>
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
              See on Eesti Kaubandus-Tööstuskoja avaliku sisu põhjal koostatud tööriist. Kõik
              materjalid pärinevad lehelt{" "}
              <a href="https://www.koda.ee" target="_blank" rel="noopener noreferrer">
                koda.ee
              </a>
              .
            </p>
            <p>
              Privaatsus: me ei küsi ega salvesta sinu ettevõtte nime, sinu nime ega e-posti
              aadressi. Valitud filtreid ja klikke võime kasutada anonüümselt tööriista
              parandamiseks.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
