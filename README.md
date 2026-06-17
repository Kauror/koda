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
automaatselt. Seejärel lae algandmed:

```bash
docker compose exec app npm run seed     # sildid + näidissisu + teemagrupid
docker compose exec app npm run crawl    # impordi päris sisu koda.ee-st
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
| `npm run crawl`          | Impordib sisu koda.ee avalikelt lehtedelt                |
| `npm run import:validate`| Valideerib merge-ready Exceli failid (ilma andmebaasita) |
| `npm run import:merge-ready` | Impordib merge-ready Exceli failid andmebaasi (idempotentne) |
| `npm run import:verify-db` | Kontrollib andmebaasi pärast importi (invariandid)     |
| `npm run import:test`    | Deterministlikud kontrollid merge-ready impordile        |
| `npm run public-ui:test` | DB-vabad avaliku UI kontrollid (CTA-d, detailivaate peitmise reeglid) |
| `npm run db:setup:pglite`| Lokaalne PGlite andmebaas + migratsioonid (verifitseerimiseks) |
| `npm run prisma:migrate` | `prisma migrate dev` (arendus)                           |
| `npm run prisma:deploy`  | `prisma migrate deploy` (server)                         |

## Merge-ready import (v1 andmemudel)

Rakenduse v1 sisu **tõeallikas** on neli puhastatud merge-ready Exceli faili
(`data/import/`), mitte crawler ega seed. Vt täielikku juhendit:
[`docs/import-merge-ready.md`](docs/import-merge-ready.md).

```bash
# Failid kausta data/import/ (vt data/import/README.md), siis:
npm run import:validate        # valideeri (ilma andmebaasita)
npm run prisma:deploy          # rakenda skeem (sh merge-ready migratsioonid)
npm run import:merge-ready     # impordi (idempotentne)
npm run import:verify-db       # kontrolli andmebaasi invariandid
```

- Sisuread: web **3937** + arvamused **759** + aastaaruanded **237** = **4933**
  (enne avalikkuse väljajätte). Töövõidud-rikastusfail on **ainult rikastus** ja
  **ei loo** uusi sisuridu (kui import tekitab 5009 rida, on see vale).
- 76 kanoonilist töövõidu-rida rikastatakse standalone failist pealkirjavõtme
  alusel; rikastus läheb `AchievementEnrichment` tabelisse.
- QA raport: `data/import/reports/import-report.{json,md}`.
- Import on **idempotentne** (upsert `externalId` järgi); teine jooks annab
  `created=0 updated=4933` ilma ridade paljunemiseta.
- Lokaalseks verifitseerimiseks ilma Postgresita on PGlite-haru
  (`KODA_DB_DRIVER=pglite`) — vt [`docs/import-merge-ready.md`](docs/import-merge-ready.md).
- Allikapõhised väljad kirjutatakse importimisel üle; admin-väljad
  (`manualWeight`, AI, `admin*Override`) säilivad. Vt impordilepingut dokumendis.
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
| `CRAWLER_ENABLED`          | `true/false` – kas `npm run crawl` üldse käivitub             |
| `CRAWLER_MAX_PAGES`        | Mitu lehekülge igast allikast (pagineerimine)                 |
| `CRAWLER_FETCH_BODY`       | Kas tõmmata ka artiklite täistekstid                          |
| `CRAWLER_MAX_BODY_FETCHES` | Viisakuspiir täisteksti päringutele ühe jooksu kohta          |
| `CRAWLER_DELAY_MS`         | Paus päringute vahel (ms)                                     |
| `AI_ENABLED`               | `false` – AI-otsing on MVP-s väljas                           |
| `OPENAI_API_KEY`           | Tulevikuks; MVP-s ei kasutata                                 |

## Crawler

Allikad (avalikud koda.ee lehed):

- <https://www.koda.ee/et/meie-arvamus>
- <https://www.koda.ee/et/meie-arvamus/archive>
- <https://www.koda.ee/et/uudised/meie_uudised>
- <https://www.koda.ee/et/meie-moju/hetkel-kasil/arhiiv>

Crawler on viisakas (vaikimisi 1 s paus päringute vahel, selge User-Agent,
piiratud lehtede arv), logib selgelt ja on idempotentne. Dubleerimist
välditakse kolmel tasandil: kanooniline URL, normaliseeritud pealkiri ja
sisuräsi (`contentHash`). Sama jooksutamine mitu korda ei tekita duplikaate.

Käsitsi: `npm run crawl` (või `docker compose exec app npm run crawl`).
Hiljem saab sama käsu panna cron'i, nt:

```
0 6 * * * cd /opt/koda && docker compose exec -T app npm run crawl
```

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
  et UI-d saaks kohe testida. Päris sisu tuleb crawleriga; näidiskirjed saab
  admin-vaates peita või kustutada, kui päris andmed olemas.
- Teadlikult väljas (spec'i järgi): Kubernetes, väline auth, tasuline otsing,
  chatbot, CRM/liikmesüsteemi integratsioon, e-posti kogumine, Drupali sõltuvus.
