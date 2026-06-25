/**
 * Canonical Koda topic taxonomy — the single source of truth for the public
 * `Teema / valdkond` filter.
 *
 * Source of truth: data/taxonomy/koda_taxonomy_rules_v0_9_1.txt, section
 * "2. AVALIKUD TEEMAD / VALDKONNAD" (taxonomy guide v2.1.6). The TOPICS array
 * below is a hand-maintained mirror of that section; `scripts/test-topics.ts`
 * parses the taxonomy file and FAILS if this list drifts from it, so this is a
 * derived-and-verified config, not a free-floating hardcoded list.
 *
 * Why this exists: the public filter was previously built from the distinct
 * `topic_primary` / `topic_secondary` values found on content rows
 * (getFilterOptions in search.ts). That leaked legacy/short aliases ("Energia",
 * "Eksport", "Digi, andmed"…) and the internal-only topic
 * ("Õigusloome kvaliteet ja kaasamine") into the public UI. The public filter
 * must instead come ONLY from this canonical allowlist.
 *
 * This module is pure (no Prisma / no I/O) so it can be shared by the importer,
 * the pure search core and the DB orchestration layer, and unit-tested directly.
 */
import { slugify } from "./slug";

export type Topic = {
  /** Canonical taxonomy id (underscore form, e.g. "energia_elektrihind_varustuskindlus"). */
  id: string;
  /** Canonical full label shown in the public UI. */
  label: string;
  /** Whether this topic appears in the public `Teema / valdkond` filter. */
  publicFilterVisible: boolean;
  /** Canonical sort order (1-based, from the taxonomy file). */
  order: number;
  /** Internal-only topics may exist in data/admin but never in the public filter. */
  internalOnly?: boolean;
};

/**
 * Canonical taxonomy v2.1.6: 26 public topics (order 1..26) + 1 internal-only.
 * Order here IS the public display order — do not sort dynamically.
 */
export const TOPICS: Topic[] = [
  { id: "ettevotluskeskkond_konkurentsivoime", label: "Ettevõtluskeskkond ja konkurentsivõime", publicFilterVisible: true, order: 1 },
  { id: "euroopa_liidu_poliitika_oigus", label: "Euroopa Liidu poliitika ja õigus", publicFilterVisible: true, order: 2 },
  { id: "maksud_tasud", label: "Maksud ja tasud", publicFilterVisible: true, order: 3 },
  { id: "raamatupidamine_audit_aruandlus", label: "Raamatupidamine, audit ja aruandlus", publicFilterVisible: true, order: 4 },
  { id: "burokraatia_halduskoormus", label: "Bürokraatia ja halduskoormus", publicFilterVisible: true, order: 5 },
  { id: "toojoud_toooigus", label: "Tööjõud ja tööõigus", publicFilterVisible: true, order: 6 },
  { id: "tootervishoid_tooohutus", label: "Töötervishoid ja tööohutus", publicFilterVisible: true, order: 7 },
  { id: "valistoojoud_ranne", label: "Välistööjõud ja ränne", publicFilterVisible: true, order: 8 },
  { id: "haridus_oskused_jarelkasv", label: "Haridus, oskused ja järelkasv", publicFilterVisible: true, order: 9 },
  { id: "teadus_arendus_innovatsioon", label: "Teadus, arendus ja innovatsioon", publicFilterVisible: true, order: 10 },
  { id: "pakend_jaatmed_ringmajandus", label: "Pakend, jäätmed ja ringmajandus", publicFilterVisible: true, order: 11 },
  { id: "tootjavastutus_probleemtooted", label: "Tootjavastutus ja probleemtooted", publicFilterVisible: true, order: 12 },
  { id: "kliima_kestlikkus_rohenouded", label: "Kliima, kestlikkus ja rohenõuded", publicFilterVisible: true, order: 13 },
  { id: "energia_elektrihind_varustuskindlus", label: "Energia, elektrihind ja varustuskindlus", publicFilterVisible: true, order: 14 },
  { id: "digi_andmed_ai_kuberturvalisus", label: "Digi, andmed, AI ja küberturvalisus", publicFilterVisible: true, order: 15 },
  { id: "ekaubandus_tarbijakaitse", label: "E-kaubandus ja tarbijakaitse", publicFilterVisible: true, order: 16 },
  { id: "finants_krediit_rahapesu", label: "Finants, krediit ja rahapesu nõuded", publicFilterVisible: true, order: 17 },
  { id: "arioigus_uhingud_ariregister", label: "Äriõigus, ühingud ja äriregister", publicFilterVisible: true, order: 18 },
  { id: "intellektuaalomand_autorioigus", label: "Intellektuaalomand ja autoriõigus", publicFilterVisible: true, order: 19 },
  { id: "tootenouded_ohutus_turujarelevalve", label: "Tootenõuded, ohutus ja turujärelevalve", publicFilterVisible: true, order: 20 },
  { id: "planeeringud_load_ehitus_kinnisvara", label: "Planeeringud, load, ehitus ja kinnisvara", publicFilterVisible: true, order: 21 },
  { id: "riigihanked_avaliku_sektori_ari", label: "Riigihanked ja avaliku sektoriga äri", publicFilterVisible: true, order: 22 },
  { id: "toetused_riigiabi_investeeringud", label: "Toetused, riigiabi ja investeeringud", publicFilterVisible: true, order: 23 },
  { id: "eksport_rahvusvahelistumine_toll", label: "Eksport, rahvusvahelistumine ja toll", publicFilterVisible: true, order: 24 },
  { id: "alkohol_tubakas_aktsiisikaubad", label: "Alkohol, tubakas ja aktsiisikaubad", publicFilterVisible: true, order: 25 },
  { id: "riigikaitse_julgeolek_kriisikindlus", label: "Riigikaitse, julgeolek ja kriisikindlus", publicFilterVisible: true, order: 26 },
  // Internal-only (taxonomy: "Avalik filtris: ei, internal-only") — exists in
  // data/admin/review, never a public filter option.
  { id: "oigusloome_kvaliteet_kaasamine", label: "Õigusloome kvaliteet ja kaasamine", publicFilterVisible: false, order: 27, internalOnly: true },
];

/**
 * Legacy / short / alias labels mapped to their canonical id. These may appear
 * in old or partially-cleaned data; they normalize into a canonical topic for
 * search/import/display but MUST NOT appear as separate public filter options.
 *
 * The first block is the authoritative alias list from the task / taxonomy
 * cleanup. The second block holds pre-canonical wordings seen in earlier data
 * packages (kept for defence-in-depth; harmless if absent from current data).
 */
const ALIAS_LABELS: Record<string, string> = {
  "Digi, andmed": "digi_andmed_ai_kuberturvalisus",
  "Energia": "energia_elektrihind_varustuskindlus",
  "Kliima": "kliima_kestlikkus_rohenouded",
  "Raamatupidamine": "raamatupidamine_audit_aruandlus",
  "Alkohol": "alkohol_tubakas_aktsiisikaubad",
  "Pakend": "pakend_jaatmed_ringmajandus",
  "Planeeringud": "planeeringud_load_ehitus_kinnisvara",
  "Planeeringud, load": "planeeringud_load_ehitus_kinnisvara",
  "Riigikaitse": "riigikaitse_julgeolek_kriisikindlus",
  "Teadus": "teadus_arendus_innovatsioon",
  "Toetused": "toetused_riigiabi_investeeringud",
  "Äriõigus": "arioigus_uhingud_ariregister",
  "Eksport": "eksport_rahvusvahelistumine_toll",

  // Pre-canonical wordings observed in earlier (v1/v0.9.x) data packages.
  "Maksud, tasud ja aruandlus": "maksud_tasud",
  "Tööjõud, tööõigus ja töökeskkond": "toojoud_toooigus",
  "Import, eksport, toll ja sanktsioonid": "eksport_rahvusvahelistumine_toll",
  "Välistööjõud ja oskustöötajad": "valistoojoud_ranne",
  "Haridus, oskused ja tööjõu järelkasv": "haridus_oskused_jarelkasv",
  "Pakend, jäätmed ja keskkonnakohustused": "pakend_jaatmed_ringmajandus",
  "Digi, andmed, e-arved ja küberturvalisus": "digi_andmed_ai_kuberturvalisus",
};

const byId = new Map<string, Topic>(TOPICS.map((t) => [t.id, t]));

/**
 * Lookup table from any recognised key -> canonical id. Keys registered per
 * topic: the canonical id, the canonical label, and `slugify(label)`. Plus, for
 * each alias: the alias label and `slugify(alias)`. All keys are matched
 * case-insensitively (lowercased) so DB tag slugs, raw labels and the canonical
 * id all resolve to the same canonical topic.
 */
const keyToId = new Map<string, string>();
function registerKey(key: string, id: string) {
  const k = key.trim().toLowerCase();
  if (k) keyToId.set(k, id);
}
for (const t of TOPICS) {
  registerKey(t.id, t.id);
  registerKey(t.label, t.id);
  registerKey(slugify(t.label), t.id);
}
for (const [label, id] of Object.entries(ALIAS_LABELS)) {
  registerKey(label, id);
  registerKey(slugify(label), id);
}

/**
 * Resolve any topic string (canonical id, canonical label, DB tag slug, or a
 * legacy/short alias) to its canonical topic id. Returns null for unknown
 * strings — unknown topics are never silently promoted into the taxonomy.
 */
export function canonicalTopicId(input: string | null | undefined): string | null {
  if (!input) return null;
  return keyToId.get(input.trim().toLowerCase()) ?? null;
}

/** Resolve any topic string to its canonical full label, or null if unknown. */
export function canonicalTopicLabel(input: string | null | undefined): string | null {
  const id = canonicalTopicId(input);
  return id ? byId.get(id)!.label : null;
}

export type TopicOption = { slug: string; name: string };

/**
 * The public `Teema / valdkond` filter options: exactly the 26 canonical public
 * topics, in canonical order. `slug` is the canonical id (the URL `valdkond=`
 * value), `name` is the canonical label. This is the ONLY source of public
 * topic filters — never build them from distinct content values.
 */
export const PUBLIC_TOPIC_FILTERS: TopicOption[] = TOPICS.filter((t) => t.publicFilterVisible)
  .sort((a, b) => a.order - b.order)
  .map((t) => ({ slug: t.id, name: t.label }));

/** Set of canonical ids that are public filter options. */
export const PUBLIC_TOPIC_IDS = new Set(PUBLIC_TOPIC_FILTERS.map((o) => o.slug));

/**
 * Normalize a set of raw topic tags (slug/name pairs) to the canonical PUBLIC
 * topics they belong to, de-duplicated and returned in canonical order. Unknown
 * and internal-only topics are dropped — used for public display (detail page)
 * so legacy aliases / internal-only topics never leak into the public UI.
 */
export function canonicalPublicValdkonnad(tags: { slug: string; name: string }[]): TopicOption[] {
  const ids = new Set<string>();
  for (const t of tags) {
    const id = canonicalTopicId(t.slug) ?? canonicalTopicId(t.name);
    if (id && PUBLIC_TOPIC_IDS.has(id)) ids.add(id);
  }
  return PUBLIC_TOPIC_FILTERS.filter((o) => ids.has(o.slug));
}

/**
 * Importer helper: normalize a raw topic label to its canonical label. Returns
 * `{ label, known }` — when `known` is false the label is unrecognised and the
 * caller should keep it internal (and warn) rather than expose it publicly.
 */
export function normalizeTopicLabel(raw: string): { label: string; known: boolean } {
  const label = canonicalTopicLabel(raw);
  return label ? { label, known: true } : { label: raw, known: false };
}
