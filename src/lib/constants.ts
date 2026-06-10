export type Option = { slug: string; name: string };

export const SECTORS: Option[] = [
  { slug: "toostus", name: "Tööstus" },
  { slug: "kaubandus", name: "Kaubandus" },
  { slug: "ehitus", name: "Ehitus" },
  { slug: "transport-ja-logistika", name: "Transport ja logistika" },
  { slug: "it", name: "Info ja side / IT" },
  { slug: "kinnisvara", name: "Kinnisvara" },
  { slug: "pangandus-ja-kindlustus", name: "Pangandus ja kindlustus" },
  { slug: "pollumajandus-ja-kalandus", name: "Põllumajandus ja kalandus" },
  { slug: "horeca-turism", name: "Hotellid, restoranid, turism" },
  { slug: "teenused", name: "Teenused" },
  { slug: "muu", name: "Muu" },
];

export const SIZES: Option[] = [
  { slug: "1-9", name: "1–9 töötajat" },
  { slug: "10-49", name: "10–49 töötajat" },
  { slug: "50-249", name: "50–249 töötajat" },
  { slug: "250-plus", name: "250+ töötajat" },
];

export const ACTIVITIES: Option[] = [
  { slug: "eksport", name: "Ekspordime" },
  { slug: "import", name: "Impordime" },
  { slug: "e-pood", name: "Müüme e-poes" },
  { slug: "valistoojoud", name: "Kasutame välistööjõudu" },
  { slug: "energiamahukas", name: "Oleme energiamahukas ettevõte" },
  { slug: "reguleeritud", name: "Tegutseme reguleeritud valdkonnas" },
  { slug: "riigihanked", name: "Osaleme riigihangetel" },
  { slug: "valiskaubandusdokumendid", name: "Vajame väliskaubandusdokumente" },
  { slug: "valispartnerid", name: "Soovime leida välispartnereid" },
];

export const INTERESTS: Option[] = [
  { slug: "maksud", name: "Maksud" },
  { slug: "toooigus", name: "Tööõigus" },
  { slug: "valistoojoud", name: "Välistööjõud" },
  { slug: "burokraatia", name: "Bürokraatia" },
  { slug: "keskkond-ja-kliima", name: "Keskkond ja kliima" },
  { slug: "energia", name: "Energia" },
  { slug: "pakendid", name: "Pakendid" },
  { slug: "tarbijakaitse", name: "Tarbijakaitse" },
  { slug: "e-kaubandus", name: "E-kaubandus" },
  { slug: "andmekaitse-kuberturvalisus", name: "Andmekaitse / küberturvalisus" },
  { slug: "haridus-ja-toojoud", name: "Haridus ja tööjõu järelkasv" },
  { slug: "eksport-ja-valisturud", name: "Eksport ja välisturud" },
  { slug: "euroopa-liit", name: "Euroopa Liit" },
  { slug: "riigihanked", name: "Riigihanked" },
];

export function optionName(options: Option[], slug: string | null | undefined): string | null {
  if (!slug) return null;
  return options.find((o) => o.slug === slug)?.name ?? null;
}

export const APP_URL = process.env.APP_URL || "https://liige.orgusaar.ee";
