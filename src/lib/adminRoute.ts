import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "./auth";

/** Returns a 401/redirect response if the request is not authenticated, otherwise null. */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  // Form posts come from the browser – send the user to the login page.
  return redirectTo(req, "/admin/login");
}

export function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(publicUrl(req, path), 303);
}

export function publicUrl(req: NextRequest, path: string): URL {
  if (/^https?:\/\//i.test(path)) return new URL(path);

  const internalUrl = new URL(req.url);
  const appUrl = process.env.APP_URL ? new URL(process.env.APP_URL) : null;
  const forwardedHost = firstHeader(req.headers.get("x-forwarded-host"));
  const forwardedProto = firstHeader(req.headers.get("x-forwarded-proto"));
  const requestHost = req.headers.get("host") || internalUrl.host;
  const appHost = appUrl?.host || "";
  const host = forwardedHost || (isLocalHost(requestHost) && appHost ? appHost : requestHost || appHost);
  const protocol = forwardedProto || appUrl?.protocol.replace(":", "") || internalUrl.protocol.replace(":", "");
  return new URL(path, `${protocol}://${host}`);
}

function firstHeader(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

function isLocalHost(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

/** Redirect back to an explicit _redirect field, the referring page, or a fallback. */
export function redirectBack(req: NextRequest, form: FormData, fallback: string): NextResponse {
  const explicit = form.get("_redirect");
  if (typeof explicit === "string" && explicit.startsWith("/")) {
    return redirectTo(req, explicit);
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      return redirectTo(req, url.pathname + url.search);
    } catch {
      // fall through
    }
  }
  return redirectTo(req, fallback);
}

export function str(form: FormData, key: string): string | null {
  const value = form.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
