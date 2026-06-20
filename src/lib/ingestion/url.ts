/**
 * URL allowlisting and canonicalization for Koda.ee ingestion.
 *
 * Safety: only https://www.koda.ee (and koda.ee) public `/et/...` pages are ever
 * accepted. External domains, non-http(s) schemes and non-/et/ paths are rejected
 * so ingestion can never follow links off Koda.ee or crawl the wider internet.
 */
import { urlHash } from "../hash";

export { urlHash };

export const ALLOWED_HOSTS = ["www.koda.ee", "koda.ee"] as const;
export const CANONICAL_BASE = "https://www.koda.ee";

/** Is this an allowlisted Koda.ee https URL? */
export function isAllowedKodaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return (ALLOWED_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Canonicalize an href (optionally resolved against a base) to a stable
 * `https://www.koda.ee/et/...` URL, or null if it is not an allowlisted public
 * Koda.ee content path. Drops query/hash and trailing slashes.
 */
export function canonicalizeKodaUrl(href: string, base?: string): string | null {
  if (typeof href !== "string" || !href.trim()) return null;
  let url: URL;
  try {
    url = base ? new URL(href, base) : new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!(ALLOWED_HOSTS as readonly string[]).includes(url.hostname)) return null;
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  if (!path.startsWith("/et/")) return null;
  return `${CANONICAL_BASE}${path}`;
}

/** Article-like paths are deeper than a top-level section root. */
export function isLikelyArticlePath(canonicalUrl: string): boolean {
  try {
    const segments = new URL(canonicalUrl).pathname.split("/").filter(Boolean);
    return segments.length >= 3; // /et/<section>/<slug...>
  } catch {
    return false;
  }
}
