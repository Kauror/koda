/**
 * Seed script: tags for all filter options + a sample dataset of Koda-style
 * content and topic groups so the UI is testable before the crawler has run.
 *
 * NB: sample content is illustrative ("näidissisu") – it mirrors the kind of
 * work Koda does, but real items should come from `npm run crawl`.
 *
 * Usage: npm run seed   (idempotent, safe to re-run)
 */
import { PrismaClient, SourceType } from "@prisma/client";
import { loadEnv } from "./env";
import { ACTIVITIES, INTERESTS, SECTORS, SIZES } from "../src/lib/constants";
import { contentHash } from "../src/lib/hash";

loadEnv();

const prisma = new PrismaClient();

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(9, 0, 0, 0);
  return d;
}

type SeedItem = {
  key: string;
  title: string;
  daysAgo: number | null;
  sourceType: SourceType;
  excerpt: string;
  summary?: string;
  evergreen?: boolean;
  weight?: number;
  sectors?: string[];
  interests?: string[];
  activities?: string[];
  sizes?: string[];
};

// Sample source links point to the real koda.ee section pages (with a unique
// fragment so canonical URLs stay unique), so clicking them shows real content.
const SECTION_URL: Record<string, string> = {
  opinion: "https://www.koda.ee/et/meie-arvamus",
  archive_opinion: "https://www.koda.ee/et/meie-arvamus/archive",
  news: "https://www.koda.ee/et/uudised/meie_uudised",
  currently_handled: "https://www.koda.ee/et/meie-moju/hetkel-kasil/arhiiv",
  service: "https://www.koda.ee/et/teenused",
  event: "https://www.koda.ee/et/sundmused-koolitused",
  unknown: "https://www.koda.ee",
};

const ITEMS: SeedItem[] = [
  // --- Maksud ---
  {
    key: "maksud-ettepanekud",
    title: "Koda esitas rahandusministeeriumile ettepanekud maksumuudatuste mõju leevendamiseks",
    daysAgo: 20,
    sourceType: "opinion",
    excerpt:
      "Koda juhtis tähelepanu, et maksumuudatused vajavad piisavat etteteatamisaega ja mõjuanalüüsi, et ettevõtjad jõuaksid kohaneda.",
    interests: ["maksud"],
    weight: 1,
  },
  {
    key: "maksud-kaibemaks",
    title: "Koja arvamus käibemaksuseaduse muutmise eelnõu kohta",
    daysAgo: 200,
    sourceType: "archive_opinion",
    excerpt:
      "Koda esitas seisukoha, et käibemaksumuudatuste jõustamisel tuleb arvestada ettevõtete raamatupidamis- ja IT-süsteemide kohandamise ajakuluga.",
    interests: ["maksud"],
  },
  {
    key: "maksud-ulevaade",
    title: "Ülevaade: ettevõtjaid puudutavad maksumuudatused",
    daysAgo: 45,
    sourceType: "news",
    excerpt:
      "Kokkuvõte olulisematest jõustunud ja kavandatavatest maksumuudatustest, mis puudutavad kõiki Eesti ettevõtjaid.",
    interests: ["maksud"],
    evergreen: true,
  },

  // --- Tööõigus ---
  {
    key: "toooigus-tls",
    title: "Koda esitas seisukohad töölepingu seaduse muutmise eelnõule",
    daysAgo: 35,
    sourceType: "opinion",
    excerpt:
      "Koda toetab paindlikumaid töösuhteid, kuid juhtis tähelepanu kohtadele, kus eelnõu suurendaks tööandjate halduskoormust.",
    interests: ["toooigus"],
    activities: ["tooandja"],
  },
  {
    key: "toooigus-paindlikkus",
    title: "Hetkel käsil: paindlikumad töösuhted ja tööaja arvestus",
    daysAgo: 120,
    sourceType: "currently_handled",
    excerpt:
      "Koda osaleb töösuhete paindlikkuse töörühmas, et tööaja reeglid vastaksid tänapäevasele töökorraldusele.",
    interests: ["toooigus"],
    activities: ["tooandja"],
  },

  // --- Välistööjõud ---
  {
    key: "valistoojoud-kvoot",
    title: "Koda: välistööjõu sisserände kvoot vajab paindlikumat süsteemi",
    daysAgo: 60,
    sourceType: "opinion",
    excerpt:
      "Koda on järjepidevalt seisnud selle eest, et välistööjõu kasutamine oleks lihtsam valdkondades, kus kohalikku tööjõudu ei jätku.",
    interests: ["valistoojoud", "haridus-ja-toojoud"],
    activities: ["valistoojoud"],
    sectors: ["toostus", "ehitus", "horeca-turism", "pollumajandus-ja-kalandus"],
  },
  {
    key: "valistoojoud-hooajatoo",
    title: "Hetkel käsil: hooajatöötajate regulatsiooni lihtsustamine",
    daysAgo: 300,
    sourceType: "currently_handled",
    excerpt:
      "Koda tegi ettepanekud hooajatöötajate palkamise reeglite lihtsustamiseks põllumajanduses ja turismis.",
    interests: ["valistoojoud"],
    activities: ["valistoojoud"],
    sectors: ["pollumajandus-ja-kalandus", "horeca-turism"],
  },

  // --- Energia ---
  {
    key: "energia-elektriturg",
    title: "Koja ettepanekud elektrituru korralduse parandamiseks",
    daysAgo: 25,
    sourceType: "opinion",
    excerpt:
      "Koda esitas ettepanekud, kuidas muuta elektri hind ettevõtjatele prognoositavamaks ja tagada varustuskindlus.",
    interests: ["energia"],
    activities: ["energiamahukas"],
    sectors: ["toostus", "pollumajandus-ja-kalandus"],
    weight: 1,
  },
  {
    key: "energia-vorgutasud",
    title: "Koda: võrgutasude tõus vajab selgemat põhjendust ja etteteatamist",
    daysAgo: 150,
    sourceType: "news",
    excerpt:
      "Koda juhtis tähelepanu, et võrgutasude muudatused mõjutavad eriti energiamahukaid tootmisettevõtteid.",
    interests: ["energia"],
    activities: ["energiamahukas"],
    sectors: ["toostus"],
  },

  // --- Bürokraatia ---
  {
    key: "burokraatia-ettepanekud",
    title: "Koja ettepanekud ettevõtjate halduskoormuse vähendamiseks",
    daysAgo: 40,
    sourceType: "opinion",
    excerpt:
      "Koda kogus liikmetelt kokku kümned konkreetsed ettepanekud bürokraatia vähendamiseks ja esitas need riigile.",
    interests: ["burokraatia"],
    evergreen: true,
    weight: 1,
  },
  {
    key: "burokraatia-aruandlus",
    title: "Aruandlus 3.0: vähem dubleerivat aruandlust riigile",
    daysAgo: 400,
    sourceType: "news",
    excerpt:
      "Koda osaleb algatuses, mille eesmärk on, et ettevõtja esitaks iga andme riigile vaid ühe korra.",
    interests: ["burokraatia"],
    evergreen: true,
  },

  // --- Väliskaubandus ---
  {
    key: "dokumendid-paritolusertifikaat",
    title: "Päritolusertifikaadid ja teised väliskaubanduse dokumendid",
    daysAgo: null,
    sourceType: "service",
    excerpt:
      "Koda väljastab eksportijatele päritolusertifikaate ja kinnitab väliskaubanduse dokumente – liikmetele soodsamalt.",
    interests: ["eksport-ja-valisturud"],
    activities: ["eksport", "import", "valiskaubandusdokumendid"],
    sectors: ["toostus", "kaubandus", "transport-ja-logistika"],
    evergreen: true,
  },
  {
    key: "dokumendid-ata-carnet",
    title: "ATA-märkmik (ATA Carnet) – kaupade ajutine väljavedu välisriiki",
    daysAgo: null,
    sourceType: "service",
    excerpt:
      "ATA-märkmik võimaldab viia kaupu ajutiselt välisriiki (messid, näidised, töövahendid) ilma tollimakse tasumata.",
    interests: ["eksport-ja-valisturud"],
    activities: ["eksport", "valiskaubandusdokumendid"],
    evergreen: true,
  },
  {
    key: "kontaktid-arivisiidid",
    title: "Koda aitab leida välispartnereid kontaktürituste ja ärivisiitide kaudu",
    daysAgo: 80,
    sourceType: "event",
    excerpt:
      "Koja korraldatavad ärivisiidid, kontaktüritused ja messikülastused aitavad ettevõtetel leida uusi eksporditurge ja partnereid.",
    interests: ["eksport-ja-valisturud"],
    activities: ["valispartnerid", "eksport"],
    evergreen: true,
  },

  // --- Pakendid ja keskkond ---
  {
    key: "pakendid-seadus",
    title: "Koja arvamus pakendiseaduse muutmise eelnõu kohta",
    daysAgo: 50,
    sourceType: "opinion",
    excerpt:
      "Koda juhtis tähelepanu, et pakendinõuete muudatused peavad olema kooskõlas EL-i pakendimäärusega ega tohi luua topeltnõudeid.",
    interests: ["pakendid", "keskkond-ja-kliima"],
    sectors: ["kaubandus", "toostus"],
    activities: ["e-pood"],
  },
  {
    key: "pakendid-aruandlus",
    title: "Hetkel käsil: pakendiaruandluse lihtsustamine",
    daysAgo: 250,
    sourceType: "currently_handled",
    excerpt:
      "Koda teeb ettepanekuid, et pakendiaruandlus oleks väikeettevõtjale jõukohane ega nõuaks kalleid vahendajaid.",
    interests: ["pakendid", "burokraatia"],
    sectors: ["kaubandus", "toostus"],
  },

  // --- E-kaubandus ---
  {
    key: "ekaubandus-tarbijakaitse",
    title: "Koda: tarbijakaitse muudatused mõjutavad kõiki e-poode",
    daysAgo: 70,
    sourceType: "opinion",
    excerpt:
      "Koda selgitas e-kauplejatele uusi tarbija õiguste reegleid ning esitas ettepanekud üleminekuaja pikendamiseks.",
    interests: ["e-kaubandus", "tarbijakaitse"],
    sectors: ["kaubandus", "it"],
    activities: ["e-pood"],
  },
  {
    key: "ekaubandus-digiteenused",
    title: "Uudis: digiteenuste uued reeglid e-kauplejatele",
    daysAgo: 320,
    sourceType: "news",
    excerpt:
      "Ülevaade EL-i digiteenuste õigusaktidest, mis toovad e-kauplejatele uusi kohustusi ja õigusi.",
    interests: ["e-kaubandus", "euroopa-liit"],
    sectors: ["kaubandus", "it"],
    activities: ["e-pood"],
  },

  // --- Riigihanked ---
  {
    key: "riigihanked-seadus",
    title: "Koja ettepanekud riigihangete seaduse muutmiseks",
    daysAgo: 90,
    sourceType: "opinion",
    excerpt:
      "Koda tegi ettepanekud, kuidas muuta riigihanked väikestele ja keskmistele ettevõtetele kättesaadavamaks.",
    interests: ["riigihanked"],
    activities: ["riigihanked"],
    sectors: ["ehitus", "it"],
    sizes: ["1-9", "10-49", "50-249"],
  },
  {
    key: "riigihanked-vaidlustus",
    title: "Hetkel käsil: riigihangete vaidlustusmenetluse kiirendamine",
    daysAgo: 280,
    sourceType: "currently_handled",
    excerpt:
      "Koda osaleb arutelus, kuidas muuta hangete vaidlustamine kiiremaks, et projektid ei seisaks.",
    interests: ["riigihanked"],
    activities: ["riigihanked"],
    sectors: ["ehitus"],
  },

  // --- Andmekaitse ja küberturvalisus ---
  {
    key: "kuberturvalisus-nis2",
    title: "Koda: küberturvalisuse nõuded (NIS2) vajavad selgeid juhiseid",
    daysAgo: 55,
    sourceType: "opinion",
    excerpt:
      "Koda juhtis tähelepanu, et uute küberturvalisuse nõuete täitmine eeldab riigilt selgeid juhendmaterjale ja mõistlikke tähtaegu.",
    interests: ["andmekaitse-kuberturvalisus"],
    sectors: ["it"],
    activities: ["reguleeritud"],
  },
  {
    key: "andmekaitse-meelespea",
    title: "Andmekaitse meelespea väikeettevõtjale",
    daysAgo: 380,
    sourceType: "news",
    excerpt:
      "Praktiline kokkuvõte, mida iga väikeettevõtja peaks isikuandmete töötlemisel silmas pidama.",
    interests: ["andmekaitse-kuberturvalisus"],
    sizes: ["1-9", "10-49"],
    evergreen: true,
  },

  // --- Standalone sector items (not in any group) ---
  {
    key: "kinnisvara-planeerimine",
    title: "Koja arvamus planeerimisseaduse muutmise kohta",
    daysAgo: 65,
    sourceType: "opinion",
    excerpt:
      "Koda toetab planeerimismenetluste kiirendamist, mis aitaks elavdada kinnisvara- ja ehitussektorit.",
    interests: ["burokraatia"],
    sectors: ["kinnisvara", "ehitus"],
  },
  {
    key: "pangandus-pangamaks",
    title: "Koda: pankade erimaks mõjutaks kogu ettevõtluskeskkonda",
    daysAgo: 110,
    sourceType: "opinion",
    excerpt:
      "Koda analüüsis pankade erimaksu mõju laenude kättesaadavusele ja ettevõtete rahastamisele.",
    interests: ["maksud"],
    sectors: ["pangandus-ja-kindlustus"],
  },
  {
    key: "transport-teekasutustasu",
    title: "Koja seisukoht raskeveokite teekasutustasu tõstmise kohta",
    daysAgo: 130,
    sourceType: "opinion",
    excerpt:
      "Koda juhtis tähelepanu, et teekasutustasu tõus kandub edasi kõigi kaupade hindadesse ja vähendab vedajate konkurentsivõimet.",
    interests: ["maksud"],
    sectors: ["transport-ja-logistika"],
  },
  {
    key: "horeca-kaibemaks",
    title: "Koda: majutusasutuste käibemaksu tõus kahjustab turismisektori konkurentsivõimet",
    daysAgo: 95,
    sourceType: "opinion",
    excerpt:
      "Koda võrdles naaberriikide majutuse käibemaksumäärasid ja hoiatas Eesti turismi konkurentsivõime languse eest.",
    interests: ["maksud"],
    sectors: ["horeca-turism"],
  },
  {
    key: "haridus-kutseharidus",
    title: "Koda ja ettevõtjad panustavad kutsehariduse ja praktikakohtade arendamisse",
    daysAgo: 75,
    sourceType: "news",
    excerpt:
      "Koda viib kokku koolid ja ettevõtted, et praktikakohad ja õppekavad vastaksid tööturu vajadustele.",
    interests: ["haridus-ja-toojoud"],
    activities: ["tooandja"],
    evergreen: true,
  },
  {
    key: "el-bruxelles",
    title: "Koja Brüsseli esindus: olulisemad EL-i algatused Eesti ettevõtjatele",
    daysAgo: 30,
    sourceType: "news",
    excerpt:
      "Koja esindaja Brüsselis hoiab liikmeid kursis EL-i algatustega, mis hakkavad mõjutama Eesti ettevõtteid.",
    interests: ["euroopa-liit"],
    evergreen: true,
  },
];

type SeedGroup = {
  slug: string;
  title: string;
  summary: string;
  why: string;
  evergreen?: boolean;
  weight?: number;
  sectors?: string[];
  interests?: string[];
  activities?: string[];
  sizes?: string[];
  members: string[]; // item keys, first one is the main item
};

const GROUPS: SeedGroup[] = [
  {
    slug: "maksukeskkond",
    title: "Maksukeskkond ja maksumuudatused",
    summary:
      "Koda seisab selle eest, et maksumuudatused oleksid ettevõtjatele etteaimatavad, põhjendatud ja võimalikult väikese halduskoormusega.",
    why: "Maksumuudatused mõjutavad otseselt sinu ettevõtte kulusid ja rahavoogu. Koja järjepidev töö seadusloomes aitab ära hoida läbimõtlemata muudatusi ja annab ettevõtjatele aega kohaneda.",
    evergreen: true,
    weight: 1,
    interests: ["maksud"],
    members: ["maksud-ettepanekud", "maksud-ulevaade", "maksud-kaibemaks"],
  },
  {
    slug: "toooigus",
    title: "Tööõigus ja töösuhted",
    summary:
      "Koda osaleb tööõiguse muudatuste väljatöötamisel, et töösuhted oleksid paindlikud ja reeglid tööandjale selged.",
    why: "Kui sul on töötajaid, puudutavad töölepingu seaduse muudatused sind otse – alates tööaja arvestusest kuni lepingute vormistamiseni. Koda esindab tööandjate vaadet läbirääkimistel riigiga.",
    interests: ["toooigus"],
    activities: ["tooandja"],
    members: ["toooigus-tls", "toooigus-paindlikkus"],
  },
  {
    slug: "valistoojoud",
    title: "Välistööjõud ja tööjõupuudus",
    summary:
      "Koda seisab selle eest, et välistööjõu kaasamine oleks lihtsam valdkondades, kus kohalikku tööjõudu ei jätku.",
    why: "Tööjõupuudus on paljude sektorite suurim kasvupiirang. Koja ettepanekud kvoodisüsteemi ja hooajatöö reeglite muutmiseks aitavad sul vajalikke töötajaid leida ja palgata.",
    interests: ["valistoojoud", "haridus-ja-toojoud"],
    activities: ["valistoojoud"],
    sectors: ["toostus", "ehitus", "horeca-turism", "pollumajandus-ja-kalandus"],
    members: ["valistoojoud-kvoot", "valistoojoud-hooajatoo"],
  },
  {
    slug: "energia",
    title: "Energia hind ja varustuskindlus",
    summary:
      "Koda esindab ettevõtjaid energiapoliitika kujundamisel – eesmärk on prognoositav hind ja kindel varustus.",
    why: "Energia hind on tootmiskulude võtmetegur. Koja töö elektrituru ja võrgutasude teemal aitab hoida sinu ettevõtte energiakulud kontrolli all.",
    interests: ["energia"],
    activities: ["energiamahukas"],
    sectors: ["toostus", "pollumajandus-ja-kalandus"],
    members: ["energia-elektriturg", "energia-vorgutasud"],
  },
  {
    slug: "burokraatia",
    title: "Bürokraatia vähendamine",
    summary:
      "Koda kogub liikmetelt ettepanekuid halduskoormuse vähendamiseks ja viib need otsustajateni – aruandlusest loamenetlusteni.",
    why: "Iga tund, mille sinu ettevõte säästab aruandluse ja asjaajamise pealt, on otsene võit. Koja bürokraatia vähendamise ettepanekud on viinud konkreetsete lihtsustusteni.",
    evergreen: true,
    weight: 1,
    interests: ["burokraatia"],
    members: ["burokraatia-ettepanekud", "burokraatia-aruandlus"],
  },
  {
    slug: "valiskaubandus",
    title: "Eksport ja väliskaubandusdokumendid",
    summary:
      "Koda väljastab väliskaubanduse dokumente, korraldab ärivisiite ja aitab leida välispartnereid.",
    why: "Kui ekspordid või impordid, saad koja kaudu päritolusertifikaadid ja ATA-märkmikud kiiresti ja liikmena soodsamalt. Koja kontaktüritused avavad uksi uutele turgudele.",
    evergreen: true,
    interests: ["eksport-ja-valisturud"],
    activities: ["eksport", "import", "valiskaubandusdokumendid", "valispartnerid"],
    sectors: ["toostus", "kaubandus", "transport-ja-logistika"],
    members: ["dokumendid-paritolusertifikaat", "dokumendid-ata-carnet", "kontaktid-arivisiidid"],
  },
  {
    slug: "pakendid",
    title: "Pakendid ja keskkonnanõuded",
    summary:
      "Koda osaleb pakendi- ja keskkonnanõuete kujundamisel, et need oleksid täidetavad ega looks topeltkohustusi.",
    why: "Pakendinõuded puudutavad kõiki, kes tooteid müüvad või pakendavad. Koja töö aitab hoida aruandluse lihtsa ja nõuded mõistlikud, eriti väiksematele ettevõtetele.",
    interests: ["pakendid", "keskkond-ja-kliima"],
    sectors: ["kaubandus", "toostus"],
    activities: ["e-pood"],
    members: ["pakendid-seadus", "pakendid-aruandlus"],
  },
  {
    slug: "e-kaubandus",
    title: "E-kaubandus ja tarbijakaitse",
    summary:
      "Koda hoiab e-kauplejaid kursis tarbijaõiguse ja digiteenuste reeglite muudatustega ning kaitseb nende huve seadusloomes.",
    why: "E-poe pidajana pead järgima kiiresti muutuvaid tarbijakaitse ja digiteenuste reegleid. Koda selgitab muudatusi varakult ja seisab selle eest, et üleminekuajad oleksid mõistlikud.",
    interests: ["e-kaubandus", "tarbijakaitse"],
    sectors: ["kaubandus", "it"],
    activities: ["e-pood"],
    members: ["ekaubandus-tarbijakaitse", "ekaubandus-digiteenused"],
  },
  {
    slug: "riigihanked",
    title: "Riigihanked",
    summary:
      "Koda teeb ettepanekuid, et riigihanked oleksid väikestele ja keskmistele ettevõtetele kättesaadavamad ning menetlused kiiremad.",
    why: "Kui osaled riigihangetel, mõjutavad hankereeglite muudatused otseselt sinu võimalusi lepinguid võita. Koja ettepanekud aitavad muuta hanked VKE-sõbralikumaks.",
    interests: ["riigihanked"],
    activities: ["riigihanked"],
    sectors: ["ehitus", "it"],
    members: ["riigihanked-seadus", "riigihanked-vaidlustus"],
  },
  {
    slug: "andmekaitse-kuberturvalisus",
    title: "Andmekaitse ja küberturvalisus",
    summary:
      "Koda aitab ettevõtjatel mõista andmekaitse ja küberturvalisuse nõudeid ning seisab selgete juhiste eest.",
    why: "Küberintsident või andmekaitserikkumine võib olla väikeettevõttele laastav. Koja selgitustöö ja ettepanekud aitavad nõudeid täita ilma liigse kuluta.",
    interests: ["andmekaitse-kuberturvalisus"],
    sectors: ["it"],
    activities: ["reguleeritud", "e-pood"],
    members: ["kuberturvalisus-nis2", "andmekaitse-meelespea"],
  },
];

async function main() {
  console.log("[seed] Seeding tags…");

  const tagSpecs = [
    ...SECTORS.map((o) => ({ type: "sector" as const, ...o })),
    ...SIZES.map((o) => ({ type: "size" as const, ...o })),
    ...INTERESTS.map((o) => ({ type: "interest" as const, ...o })),
    ...ACTIVITIES.map((o) => ({ type: "activity" as const, ...o })),
  ];

  const tagIdByTypeSlug = new Map<string, string>();
  for (const spec of tagSpecs) {
    const tag = await prisma.tag.upsert({
      where: { type_slug: { type: spec.type, slug: spec.slug } },
      create: { type: spec.type, slug: spec.slug, name: spec.name },
      update: { name: spec.name },
    });
    tagIdByTypeSlug.set(`${spec.type}:${spec.slug}`, tag.id);
  }
  console.log(`[seed] ${tagSpecs.length} tags upserted.`);

  console.log("[seed] Seeding sample content items…");
  const itemIdByKey = new Map<string, string>();

  for (const spec of ITEMS) {
    const url = `${SECTION_URL[spec.sourceType] ?? SECTION_URL.unknown}#naidis-${spec.key}`;
    const date = spec.daysAgo === null ? null : daysAgo(spec.daysAgo);

    const item = await prisma.contentItem.upsert({
      where: { canonicalUrl: url },
      create: {
        sourceUrl: url,
        canonicalUrl: url,
        title: spec.title,
        date,
        sourceType: spec.sourceType,
        excerpt: spec.excerpt,
        summary: spec.summary ?? null,
        contentHash: contentHash(spec.title, spec.excerpt),
        isEvergreen: spec.evergreen ?? false,
        manualWeight: spec.weight ?? 0,
        language: "et",
      },
      update: {
        title: spec.title,
        date,
        excerpt: spec.excerpt,
        isEvergreen: spec.evergreen ?? false,
        manualWeight: spec.weight ?? 0,
      },
    });
    itemIdByKey.set(spec.key, item.id);

    const tagIds = [
      ...(spec.sectors ?? []).map((s) => tagIdByTypeSlug.get(`sector:${s}`)),
      ...(spec.interests ?? []).map((s) => tagIdByTypeSlug.get(`interest:${s}`)),
      ...(spec.activities ?? []).map((s) => tagIdByTypeSlug.get(`activity:${s}`)),
      ...(spec.sizes ?? []).map((s) => tagIdByTypeSlug.get(`size:${s}`)),
    ].filter((id): id is string => !!id);

    await prisma.contentTag.deleteMany({ where: { contentItemId: item.id } });
    await prisma.contentTag.createMany({
      data: tagIds.map((tagId) => ({ contentItemId: item.id, tagId })),
      skipDuplicates: true,
    });
  }
  console.log(`[seed] ${ITEMS.length} content items upserted.`);

  console.log("[seed] Seeding topic groups…");
  for (const spec of GROUPS) {
    const mainItemId = itemIdByKey.get(spec.members[0]) ?? null;

    const group = await prisma.topicGroup.upsert({
      where: { slug: spec.slug },
      create: {
        slug: spec.slug,
        title: spec.title,
        summary: spec.summary,
        whyItMattersText: spec.why,
        isEvergreen: spec.evergreen ?? false,
        manualWeight: spec.weight ?? 0,
        mainContentItemId: mainItemId,
      },
      update: {
        title: spec.title,
        summary: spec.summary,
        whyItMattersText: spec.why,
        isEvergreen: spec.evergreen ?? false,
        manualWeight: spec.weight ?? 0,
        mainContentItemId: mainItemId,
      },
    });

    const tagIds = [
      ...(spec.sectors ?? []).map((s) => tagIdByTypeSlug.get(`sector:${s}`)),
      ...(spec.interests ?? []).map((s) => tagIdByTypeSlug.get(`interest:${s}`)),
      ...(spec.activities ?? []).map((s) => tagIdByTypeSlug.get(`activity:${s}`)),
      ...(spec.sizes ?? []).map((s) => tagIdByTypeSlug.get(`size:${s}`)),
    ].filter((id): id is string => !!id);

    await prisma.topicGroupTag.deleteMany({ where: { topicGroupId: group.id } });
    await prisma.topicGroupTag.createMany({
      data: tagIds.map((tagId) => ({ topicGroupId: group.id, tagId })),
      skipDuplicates: true,
    });

    await prisma.contentTopicGroup.deleteMany({ where: { topicGroupId: group.id } });
    await prisma.contentTopicGroup.createMany({
      data: spec.members
        .map((key, index) => {
          const contentItemId = itemIdByKey.get(key);
          if (!contentItemId) return null;
          return {
            contentItemId,
            topicGroupId: group.id,
            relationType: (index === 0 ? "main" : "history") as "main" | "history",
          };
        })
        .filter((m): m is NonNullable<typeof m> => !!m),
      skipDuplicates: true,
    });
  }
  console.log(`[seed] ${GROUPS.length} topic groups upserted.`);
  console.log("[seed] Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
