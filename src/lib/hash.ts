import { createHash, createHmac } from "crypto";

function secret(): string {
  // MVP: derive the HMAC secret from the admin password so no extra env var is needed.
  return createHash("sha256")
    .update(`koda-liikmevaartus:${process.env.ADMIN_PASSWORD || "dev-secret"}`)
    .digest("hex");
}

export function hmac(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

/** Privacy: IP is never stored raw – only a keyed hash, salted per day so it cannot be tracked long-term. */
export function anonymizeIp(ip: string | null): string | null {
  if (!ip) return null;
  const day = new Date().toISOString().slice(0, 10);
  return hmac(`ip:${day}:${ip}`).slice(0, 32);
}

export function hashUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  return hmac(`ua:${ua}`).slice(0, 32);
}

export function contentHash(title: string, body: string | null | undefined): string {
  const normalized = `${title}\n${body || ""}`.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

/** Stable hash of a (canonical) URL — used as a safe unique key for staging rows. */
export function urlHash(url: string): string {
  return createHash("sha256").update(url.trim().toLowerCase()).digest("hex");
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
