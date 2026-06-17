import { cookies } from "next/headers";
import { hmac } from "./hash";

export const ADMIN_COOKIE = "koda_admin";

/** Value stored in the admin cookie: HMAC of a fixed string keyed by the admin password. */
export function adminCookieValue(): string {
  return hmac("admin-session-v1");
}

/**
 * Cookie options for the admin session.
 *
 * `secure` is derived from APP_URL's protocol, not NODE_ENV: the Docker image
 * runs in production mode but is often reached over plain HTTP locally
 * (http://localhost:3000), where a Secure cookie would be silently dropped and
 * admin login would appear to "do nothing". Real deployments use
 * https://koda.orgusaar.ee, so the cookie is Secure there.
 */
export function adminCookieOptions() {
  const secure = (process.env.APP_URL || "").startsWith("https://");
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // one week
  };
}

export function verifyAdminPassword(email: string, password: string): boolean {
  const expectedEmail = process.env.ADMIN_EMAIL || "";
  const expectedPassword = process.env.ADMIN_PASSWORD || "";
  if (!expectedPassword) return false;
  // Email check is lenient if ADMIN_EMAIL is unset.
  const emailOk = !expectedEmail || email.trim().toLowerCase() === expectedEmail.trim().toLowerCase();
  return emailOk && password === expectedPassword;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(ADMIN_COOKIE)?.value;
  return !!value && value === adminCookieValue();
}
