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
| `npm run crawl`          | Impordib sisu koda.ee avalikelt lehtedelt                |
| `npm run prisma:migrate` | `prisma migrate dev` (arendus)                           |
| `npm run prisma:deploy`  | `prisma migrate deploy` (server)                         |

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

Autentimine on teadlikult lihtne (MVP): üks parool keskkonnamuutujast
(`ADMIN_PASSWORD`), HMAC-allkirjastatud küpsis, ei mingit välist
autentimisteenust.

## Privaatsus

- Ettevõtte nime, isikunime ega e-posti **ei küsita ega salvestata**.
- Analüütikaks salvestatakse valitud filtrid ja tulemuste klikid.
- IP-aadressi hoitakse ainult päevasoolaga võtmestatud räsina
  (`anonymizedIpHash`), sama kehtib User-Agentile.
- Avalikul lehel on eestikeelne privaatsusmärge.

## Juurutus liige.orgusaar.ee peale

1. Klooni repo serverisse, `cp .env.example .env` ja sea:
   - `APP_URL=https://liige.orgusaar.ee`
   - tugev `ADMIN_PASSWORD` ja `POSTGRES_PASSWORD`
2. `docker compose up -d --build` – app kuulab pordil 3000.
3. Suuna pöördproksi (nt Caddy või nginx + certbot) `liige.orgusaar.ee` →
   `localhost:3000`. Näide Caddyfile:

   ```
   liige.orgusaar.ee {
       reverse_proxy localhost:3000
   }
   ```

4. `docker compose exec app npm run seed && docker compose exec app npm run crawl`
5. Eemalda/komenteeri `docker-compose.yml`-ist postgresi `ports` sektsioon või
   piira see tulemüüriga (avalikus serveris ei pea 5432 väljas olema).

Domeeni vahetuseks (ametlik Koja domeen) muuda ainult `APP_URL` ja proksi
seadistust.

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
