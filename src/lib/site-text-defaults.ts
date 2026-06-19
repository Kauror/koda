export type SiteTextDefault = {
  key: string;
  valueEt: string;
  description: string;
  group: string;
};

export const SITE_TEXT_DEFAULTS = [
  {
    key: "homepage.hero.eyebrow",
    valueEt: "Ülevaade koja tööst",
    description: "Avalehe kangelase ala väike ülarida.",
    group: "homepage.hero",
  },
  {
    key: "homepage.hero.title",
    valueEt: "Mida koda sinu ettevõtte heaks teeb",
    description: "Avalehe põhipealkiri.",
    group: "homepage.hero",
  },
  {
    key: "homepage.hero.lead",
    valueEt:
      "Siit saad mugavalt otsida Sind huvitavaid Eesti Kaubandus-Tööstuskoja töövõite, koja seisukohti ja teemade teemasid millega koda on läbi aastate tegelenud",
    description: "Avalehe põhiline sissejuhatav tekst.",
    group: "homepage.hero",
  },
  {
    key: "homepage.hero.note",
    valueEt: "",
    description: "Lühike täpsustus avalehe sissejuhatuse all.",
    group: "homepage.hero",
  },
  {
    key: "homepage.topics.title",
    valueEt: "Sirvi teemade kaupa",
    description: "Teemade sirvimise ploki pealkiri.",
    group: "homepage.topics",
  },
  {
    key: "homepage.topics.description",
    valueEt: "",
    description: "Teemade sirvimise ploki lühikirjeldus.",
    group: "homepage.topics",
  },
  {
    key: "homepage.explainer.title",
    valueEt: "Otse koja kodulehel",
    description: "Koda.ee otseviidete ploki pealkiri.",
    group: "homepage.explainer",
  },
  {
    key: "homepage.explainer.body",
    valueEt: "Kiired viited koja avalikele lehtedele, kust leiab töövõidud, seisukohad, käsil olevad teemad ja teenused.",
    description: "Koda.ee otseviidete ploki lühikirjeldus.",
    group: "homepage.explainer",
  },
  {
    key: "homepage.footerNote",
    valueEt:
      "Koda seisab ettevõtjate huvide eest seadusloomes, nõustab liikmeid ja aitab ettevõtetel kasvada Eestis ning välisturgudel.",
    description: "Avalehe alumine kokkuvõttev märkus numbririba järel.",
    group: "homepage.footer",
  },
] as const satisfies readonly SiteTextDefault[];

export type SiteTextKey = (typeof SITE_TEXT_DEFAULTS)[number]["key"];
export type SiteTextMap = Record<SiteTextKey, string>;

export type SiteTextRowLike = {
  key: string;
  valueEt: string;
};

export const SITE_TEXT_DEFAULTS_BY_KEY = new Map<string, SiteTextDefault>(
  SITE_TEXT_DEFAULTS.map((item) => [item.key, item])
);

const LEGACY_SITE_TEXT_VALUES = new Map<string, string>([
  ["homepage.hero.eyebrow", "Allikapõhine ülevaade koja tööst"],
  ["homepage.hero.title", "Mida on koda sinu ettevõtte jaoks teinud ja öelnud?"],
  [
    "homepage.hero.lead",
    "Allikapõhine ülevaade sellest, mida Eesti Kaubandus-Tööstuskoda on ettevõtjate huvide kaitseks teinud ja öelnud. Otsi konkreetseid töövõite, koja seisukohti ja teemade tausta - kõik viidetega algallikatele.",
  ],
  [
    "homepage.hero.note",
    "See ei ole vestlusrobot ega uudistearhiiv. Tulemused põhinevad koja avalikel materjalidel ja indekseeritud allikatel.",
  ],
  ["homepage.topics.description", "Ei taha otsida? Vaata koja tööd ühe teema kaupa."],
]);

export function defaultSiteTextMap(): SiteTextMap {
  return Object.fromEntries(SITE_TEXT_DEFAULTS.map((item) => [item.key, item.valueEt])) as SiteTextMap;
}

export function resolveSiteTexts(rows: SiteTextRowLike[]): SiteTextMap {
  const texts = defaultSiteTextMap();
  for (const row of rows) {
    if (row.key in texts) {
      const legacyDefault = LEGACY_SITE_TEXT_VALUES.get(row.key);
      if (legacyDefault && row.valueEt === legacyDefault) continue;
      texts[row.key as SiteTextKey] = row.valueEt;
    }
  }
  return texts;
}

export function missingSiteTextDefaults(existingKeys: Iterable<string>): SiteTextDefault[] {
  const existing = new Set(existingKeys);
  return SITE_TEXT_DEFAULTS.filter((item) => !existing.has(item.key));
}
