# Koda liikmeväärtus — „Mida on koda teinud sinu ettevõtte heaks?"

Avalik eestikeelne tööriist, kus olemasolev või potentsiaalne Eesti
Kaubandus-Tööstuskoja liige valib oma ettevõtte tegevusala (ja soovi korral
täpsemad filtrid) ning näeb koja avaliku töö põhjal, mida koda on tema
valdkonna ettevõtete heaks teinud ja miks liikmelisus on väärtuslik.

**Põhimõte:** MVP on faktipõhine ja allikaviidetega. See ei ole vestlusrobot
ega genereeri väiteid – rakendus koondab, sildistab ja järjestab koja avalikku
sisu (koda.ee) teemagruppideks koos allikaviidetega. Sisemisi skoore
kasutajatele ei näidata.

Esmane juurutus: `https://liige.orgusaar.ee` (domeen on seadistatav `APP_URL`
keskkonnamuutujaga, et hiljem ametlikule Koja domeenile kolida).

## Tehnoloogia

- **Next.js 15 (App Router) + TypeScript** – avalik UI, admin ja API
- **PostgreSQL 16 + Prisma** – andmebaas ja migratsioonid
- **Docker Compose** – lokaalne arendus ja serverijuurutus
- **Crawler** – `cheerio`-põhine viisakas importija koda.ee avalikele lehtedele
- AI-otsing on **disainitud, aga välja lülitatud** (`AI_ENABLED=false`,
  skeemis on olemas `embedding`, `aiSummary` jm väljad)

## Disain ja bränd

UI järgib Koja CVI-d ja koda.ee visuaalset suunda. Kogu disainisüsteem on
defineeritud CSS-muutujatena failis `src/app/globals.css`:

- **Värvitokenid** – koja sinine `--color-primary: #009FDA` (aktsent ja
  tegevusnupud), grafiit `--color-brand-dark: #3B3B38` (jalus, tume CTA),
  valge taust, vaoshoitud hallid (`--color-bg-soft`, `--color-border`,
  `--color-muted`).
- **Tüpograafia** – brändikiri on **FF DIN Pro**. See on litsentseeritud font
  ja ei ole projektiga kaasas; font-stack on
  `"FF DIN Pro", Barlow, "Arial Narrow", Arial`. Barlow (DIN-ile lähim vaba
  font) laetakse `next/font` kaudu (`src/app/layout.tsx`) muutujasse
  `--font-din-fallback`. Kui FF DIN Pro litsents on olemas, lisa selle
  `@font-face` deklaratsioon `globals.css`-i – stack võtab selle automaatselt
  esimesena kasutusse.
- **Komponendiklassid** – `.hero`, `.section`, `.topic-card`, `.item-grid`,
  `.service-card`, `.cta-box`, `.stat-strip`, `.theme-link`, `.source-badge`
  jt on kirjeldatud `globals.css`-is; värve kasuta alati tokenite kaudu.
- **Sisu paigutus tulemustelehel** – teemakaardil on kuni kaks allikakasti
  (peamine + järgmine asjakohaseim), „Teema ajalugu" akordion ja sildid.
  Teenused (`sourceType=service`) ei segune teemakaartidega, vaid kuvatakse
  lehe lõpus eraldi sektsioonis „Teenused, mis võivad sulle kasulikud olla".

## Kiirstart Dockeriga (soovitatud)

```bash
cp .env.example .env        # muuda vähemalt ADMIN_PASSWORD!
docker compose up -d --build
```

Migratsioonid (`prisma migrate deploy`) jooksevad app-konteineri käivitumisel
automaatselt. Seejärel loo soovi korral demoandmed:

```bash
docker compose exec app npm run seed     # sildid + näidissisu + teemagrupid
# Päris v1 sisu tuleb merge-ready Excelitest, mitte legacy crawlerist.
```

Rakendus: <http://localhost:3000> · Admin: <http://localhost:3000/admin>

## Lokaalne arendus (ilma app-konteinerita)

```bash
cp .env.example .env
# muuda .env-is: DATABASE_URL=postgresql://koda:koda_password@localhost:5432/koda
docker compose up -d postgres
npm install
npx prisma migrate dev      # loob/uuendab andmebaasi skeemi
npm run seed
npm run dev                 # http://localhost:3000
```

## Käsud

| Käsk                     | Mida teeb                                                |
| ------------------------ | -------------------------------------------------------- |
| `npm run dev`            | Arendusserver                                            |
| `npm run build`          | Prisma client + Next.js production build                 |
| `npm run start`          | Production server                                        |
| `npm run seed`           | Sildid (sektorid, suurused, huvid, profiilid) + näidissisu |
| `npm run site-texts:seed`| Loob puuduvad avalehe tekstiread, olemasolevaid muudatusi üle kirjutamata |
| `npm run freshness:audit`| Raporteerib avalike ridade värskuse ja 2025/2026 katvuse DB põhjal |
| `npm run crawl`          | Legacy crawler; requires `-- --legacy-ok` and `CRAWLER_ENABLED=true` |
| `npm run import:validate`| Valideerib merge-ready Exceli failid (ilma andmebaasita) |
| `npm run import:merge-ready` | Impordib merge-ready Exceli failid andmebaasi (idempotentne) |
| `npm run import:verify-db` | Kontrollib andmebaasi pärast importi (invariandid)     |
| `npm run import:test`    | Deterministlikud kontrollid merge-ready impordile        |
| `npm run public-ui:test` | DB-vabad avaliku UI kontrollid (CTA-d, detailivaate peitmise reeglid) |
| `npm run db:setup:pglite`| Lokaalne PGlite andmebaas + migratsioonid (verifitseerimiseks) |
| `npm run prisma:migrate` | `prisma migrate dev` (arendus)                           |
| `npm run prisma:deploy`  | `prisma migrate deploy` (server)                         |

## App-import (v1 andmemudel)

Rakenduse v1 sisu **tõeallikas** on **v1 app-import pakett** (`data/import/`),
mitte crawler ega seed. Vt täielikku juhendit:
[`docs/import-merge-ready.md`](docs/import-merge-ready.md).

v1 failid ja impordilehed (ainult need):

| Fail | Impordileht | Väljajäetud/ülevaatuse leht | Read |
| --- | --- | --- | ---: |
| `koda_opinions_v1.0.xlsx` | `opinions_app_import` | `excluded_rows` | 750 |
| `koda_web_content_v1.xlsx` | `web_app_import` | `web_excluded_review` | 1131 |
| `koda_toovoidud_v1.xlsx` | `toovoidud_app_import` | `toovoidud_excluded_review` | 90 |
| `koda_content_links_v1.xlsx` | `public_related_links` (+ valideerimise lehed) | — | — |
| `koda_taxonomy_rules_v1_0.txt` | — (reegistik, ei impordita) | — | — |

```bash
# Failid kausta data/import/ (vt data/import/README.md), siis:
npm run import:validate        # valideeri (ilma andmebaasita)
npm run prisma:deploy          # rakenda skeem (sh v1 migratsioon)
npm run import:merge-ready     # impordi (asendav import)
npm run import:verify-db       # kontrolli andmebaasi invariandid
```

- Imporditavad sisuread: web **1131** + arvamused **750** + töövõidud **90** =
  **1971**. Väljajäetud/ülevaatuse read **ei impordita** kunagi avaliku sisuna
  (web 1, arvamused 9, töövõidud 7).
- Avaliku kuvamise värav v1-s: rida on impordilehel, kihipõhine impordilipp on
  TRUE (`final_app_import_eligible` / `final_web_import_candidate` /
  `work_win_import_candidate`) ja avalik kokkuvõte on olemas.
- Avalikud "Veel samal teemal" / tõenduslingid tulevad **ainult**
  `koda_content_links_v1.xlsx` lehelt `public_related_links` (→
  `ContentEvidenceLink`). Kandidaat-/ülevaatuse-/blokeeritud lingid ei lähe
  avalikku kuvamisse.
- Töövõidud salvestavad struktuursed väljad (`whatChangedEt`, `kodaRoleEt`,
  `businessValueEt`, `beforeAfterEt`) ning kuupäeva täpsuse
  (`displayDatePrecision`/`dateConfidence`/`dateBasis`); avalik kuupäev austab
  täpsust (aasta-tasemel kindlust ei kuvata päeva täpsusena).
- QA raport: `data/import/reports/import-report.{json,md}`.
- Import on **asendav** (vana imporditud sisu varundatakse `data/import/backups/`
  ja kustutatakse enne uut paketti); ära jooksuta seda andmebaasil, kus on
  admin-muudatusi, ilma neid taastamata.
- Lokaalseks verifitseerimiseks ilma Postgresita on PGlite-haru
  (`KODA_DB_DRIVER=pglite`) — vt [`docs/import-merge-ready.md`](docs/import-merge-ready.md).
- **Legacy:** vanad v0.9.x töövihikud ja `*_merge_ready.xlsx` failid **ei ole**
  enam tõeallikas; crawler jääb legacy/mitteproduktsiooniliseks.
- AI jääb väljalülitatuks ja pole impordiks vajalik.

## Otsing ja järjestus (v1)

Otsing kasutab imporditud taksonoomiat (mitte vanu konstante). Tegevusala ei ole
kohustuslik; toetatud on vabatekst `q` ning filtrid `valdkond`, `tegevusala`,
`tapsustus`, `type`. Tulemused on rühmitatud: **Töövõidud**, **Koja seisukohad ja
selgitused**, **Teema ajalugu ja taust**. Arvamused on vaikimisi tõendusmaterjal
(ei kuvata peamiste tulemustena). Avalik nähtavus käib läbi
`isPublicSearchEligible()` värava. Täielik kirjeldus:
[`docs/search-ranking-v1.md`](docs/search-ranking-v1.md).

Tulemuse kaardilt avaneb avalik detailileht `/sisu/[id]` (allikapõhine selgitus,
töövõidu rikastus, seotud aastaaruande kontekst ja toetavad arvamused).
Peidetud/toetavad read 404-vad otselingil ning kuvatakse ainult tõendusena
avaliku tulemuse all. Originaalallika link säilib eraldi. Vt
[`docs/public-detail-evidence-v1.md`](docs/public-detail-evidence-v1.md).

Avalik kasutajateekond (avaleht → otsing → rühmitatud tulemused → detailileht):
vabatekst on esmane, tegevusala pole kohustuslik, valitud filtrid on nähtavad ja
eemaldatavad, kaartidel on kaks eraldi tegevust („Vaata kokkuvõtet" ja „Ava
algallikas"). Vt [`docs/public-ux-v1.md`](docs/public-ux-v1.md).

## Keskkonnamuutujad (`.env.example`)

| Muutuja                    | Selgitus                                                     |
| -------------------------- | ------------------------------------------------------------ |
| `APP_URL`                  | Avalik baas-URL, vaikimisi `https://liige.orgusaar.ee`        |
| `DATABASE_URL`             | Postgres (Composes `postgres:5432`, lokaalselt `localhost`)   |
| `POSTGRES_USER/PASSWORD/DB`| Postgres konteineri seadistus                                 |
| `ADMIN_EMAIL`              | Admini e-post (valikuline; kui tühi, kontrollitakse vaid parooli) |
| `ADMIN_PASSWORD`           | Admini parool – **muuda kindlasti ära**                       |
| `CRAWLER_ENABLED`          | vaikimisi `false`; legacy crawler vajab lisaks `-- --legacy-ok` |
| `CRAWLER_MAX_PAGES`        | Mitu lehekülge igast allikast (pagineerimine)                 |
| `CRAWLER_FETCH_BODY`       | Kas tõmmata ka artiklite täistekstid                          |
| `CRAWLER_MAX_BODY_FETCHES` | Viisakuspiir täisteksti päringutele ühe jooksu kohta          |
| `CRAWLER_DELAY_MS`         | Paus päringute vahel (ms)                                     |
| `AI_ENABLED`               | `false` – AI-otsing on MVP-s väljas                           |
| `OPENAI_API_KEY`           | Tulevikuks; MVP-s ei kasutata                                 |

## Crawler

**Status:** legacy / not the v1 source of truth. The merge-ready workbooks in
`data/import/` are the supported ingestion path. `npm run crawl` refuses to run
unless it is a deliberate local legacy check with both:

```bash
CRAWLER_ENABLED=true npm run crawl -- --legacy-ok
```

Do not use the crawler for production ingestion until it is modernized and
reviewed against the current merge-ready schema and safety expectations.

Allikad (avalikud koda.ee lehed):

- <https://www.koda.ee/et/meie-arvamus>
- <https://www.koda.ee/et/meie-arvamus/archive>
- <https://www.koda.ee/et/uudised/meie_uudised>
- <https://www.koda.ee/et/meie-moju/hetkel-kasil/arhiiv>

Crawler on viisakas (vaikimisi 1 s paus päringute vahel, selge User-Agent,
piiratud lehtede arv), logib selgelt ja on idempotentne. Dubleerimist
välditakse kolmel tasandil: kanooniline URL, normaliseeritud pealkiri ja
sisuräsi (`contentHash`). Sama jooksutamine mitu korda ei tekita duplikaate.

Käsitsi ainult legacy-kontrolliks: `npm run crawl -- --legacy-ok` koos `CRAWLER_ENABLED=true`.
Legacy crawlerit ei soovitata cron'i panna enne moderniseerimist.

TODO: artikli täisteksti CSS-selektorid (`ARTICLE_BODY_SELECTORS` failis
`scripts/crawl.ts`) on koda.ee praeguse Drupali-markupi parim pakkumine – kui
saidi kujundus muutub, kohanda neid. Kui täisteksti ei õnnestu kätte saada,
imporditakse ikkagi pealkiri/kuupäev/link/väljavõte loendilehtedelt.

## Admin

- `/admin` – töölaud (statistika, viimased otsingud)
- `/admin/content` – imporditud sisu: kuvatava pealkirja ja kokkuvõtte
  muutmine, sektori/huvi/suuruse/profiili sildid, prioriteet ja madaldamine
  (käsitsi kaal −2…+2), evergreen, peitmine, duplikaatide liitmine,
  teemagruppidesse määramine
- `/admin/topics` – teemagrupid: loomine, „Miks see on sinu ettevõttele
  oluline" tekst, põhisisu valik, liikmete haldus, sildid
- `/admin/tags` – siltide haldus
- `/admin/site-texts` – avalehe suuremate tekstiplokkide muutmine

Autentimine on teadlikult lihtne (MVP): üks parool keskkonnamuutujast
(`ADMIN_PASSWORD`), HMAC-allkirjastatud küpsis, ei mingit välist
autentimisteenust.

Avalehe toimetatavad tekstid kasutavad `SiteText` tabelit ja koodis olevaid
vaikeväärtusi. Pärast uue võtme lisamist või värsket juurutust käivita
`npm run site-texts:seed`. Vt [`docs/site-texts-v1.md`](docs/site-texts-v1.md).

## Privaatsus

- Ettevõtte nime, isikunime ega e-posti **ei küsita ega salvestata**.
- Analüütikaks salvestatakse valitud filtrid ja tulemuste klikid.
- IP-aadressi hoitakse ainult päevasoolaga võtmestatud räsina
  (`anonymizedIpHash`), sama kehtib User-Agentile.
- Avalikul lehel on eestikeelne privaatsusmärge.

## Juurutus (Docker / Unraid, test: koda.orgusaar.ee)

Täielik juurutusjuhend: [`docs/deploy-unraid.md`](docs/deploy-unraid.md).
Lühidalt:

1. Klooni repo hostile, `cp .env.example .env` ja sea:
   - `APP_URL=https://koda.orgusaar.ee`
   - tugev `ADMIN_PASSWORD` ja `POSTGRES_PASSWORD`
   - `KODA_IMPORT_DIR=/mnt/user/appdata/koda/import` (Unraid)
2. Pane 4 merge-ready `.xlsx` faili `KODA_IMPORT_DIR` kausta (neid **ei**
   commitita gitti ega panda image'isse).
3. `docker compose build && docker compose up -d` – app kuulab pordil 3000;
   migratsioonid (`prisma migrate deploy`) jooksevad konteineri käivitumisel.
4. Impordi andmebaasi (konteineri sees, `@prisma/adapter-pg` + natiivne engine):
   ```bash
   docker compose exec app npm run import:validate
   docker compose exec app npm run import:merge-ready
   docker compose exec app npm run import:verify-db
   ```
5. Suuna pöördproksi / Cloudflare / Unraid `koda.orgusaar.ee` → app `:3000`.
6. Eemalda/komenteeri `docker-compose.yml`-ist postgresi `ports` või piira
   tulemüüriga (avalikus serveris ei pea 5432 väljas olema).

> Konteineris **ei** kasutata PGlite/x64-Node lahendust – see on ainult
> lokaalseks Windows-ARM arenduseks (vt [`docs/import-merge-ready.md`](docs/import-merge-ready.md)).
> `npm run seed` on demo-sisu ega kuulu test/prod juurutusse.

## AI-otsingu teekaart (hiljem, feature flag'i taga)

Skeem ja kood on ette valmistatud, midagi ümber ehitada pole vaja:

1. `AI_ENABLED=true` + `OPENAI_API_KEY` (või muu teenusepakkuja).
2. Genereeri sisule embeddings (`ContentItem.embedding`; suurema mahu korral
   vaheta `Float[]` pgvector'i vastu) ja AI-kokkuvõtted (`aiSummary`,
   `aiRelevanceReason`, `aiKeywords`, `aiModel`, `aiLastGeneratedAt`).
3. Lisa järjestamisse semantiline sarnasus lisasignaalina – olemasolev
   reeglipõhine skoor jääb alles ja töötab ka ilma AI-ta.
4. `aiReviewStatus` võimaldab admini ülevaatuse enne AI-teksti avalikku
   kuvamist (faktipõhisuse põhimõte kehtib ka siis).

## Märkused

- `npm run seed` loob **näidissisu** (selgelt koja-laadne, aga illustratiivne),
  et UI-d saaks kohe testida. Päris v1 sisu tuleb merge-ready Excelitest;
  näidiskirjed saab admin-vaates peita või kustutada, kui päris andmed olemas.
- Teadlikult väljas (spec'i järgi): Kubernetes, väline auth, tasuline otsing,
  chatbot, CRM/liikmesüsteemi integratsioon, e-posti kogumine, Drupali sõltuvus.
