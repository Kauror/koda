import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "./auth";

/** Returns a 401/redirect response if the request is not authenticated, otherwise null. */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await isAdmin()) return null;
  // Form posts come from the browser – send the user to the login page.
  return NextResponse.redirect(new URL("/admin/login", req.url), 303);
}

export function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.url), 303);
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
