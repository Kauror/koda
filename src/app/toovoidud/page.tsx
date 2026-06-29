import Link from "next/link";
import { isAdmin } from "@/lib/auth";
import { getAllWorkWinCards } from "@/lib/search";
import PublicResultCard from "../PublicResultCard";
import LoadMore from "../tulemused/LoadMore";

export const dynamic = "force-dynamic";

const WORK_WIN_BATCH = 7;

export default async function WorkWinsPage() {
  const [cards, admin] = await Promise.all([getAllWorkWinCards(), isAdmin()]);

  return (
    <main>
      <div className="results-header">
        <div className="container">
          <span className="eyebrow">Koja töövõidud</span>
          <h1>Kõik töövõidud</h1>
          <p className="sub">
            Sirvi Eesti Kaubandus-Tööstuskoja töövõite uuemast vanemani. Kaartidel on seotud
            seadused, avalikud seosed ja detailivaated samamoodi nagu tulemuste lehel.
          </p>
          <p style={{ marginTop: 16 }}>
            <Link href="/#vorm" className="btn btn-secondary btn-small">
              Tagasi otsingu juurde
            </Link>
          </p>
        </div>
      </div>

      <div className="container results-body">
        {cards.length === 0 ? (
          <div className="card empty-state" style={{ marginTop: 36 }}>
            <h2>Töövõite ei leitud</h2>
            <p>Praegu ei ole avalikult kuvatavaid töövõite.</p>
          </div>
        ) : (
          <section className="results-section">
            <h2>Töövõidud</h2>
            <LoadMore batchSize={WORK_WIN_BATCH} initialVisibleCount={WORK_WIN_BATCH} label="Näita veel 7">
              {cards.map((card) => (
                <PublicResultCard key={card.id} card={card} sessionId={null} fromQuery="toovoidud" admin={admin} />
              ))}
            </LoadMore>
          </section>
        )}
      </div>
    </main>
  );
}
