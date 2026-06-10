import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminCookieOptions, adminCookieValue, verifyAdminPassword } from "@/lib/auth";
import { redirectTo } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = typeof form.get("email") === "string" ? (form.get("email") as string) : "";
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";

  if (!verifyAdminPassword(email, password)) {
    return redirectTo(req, "/admin/login?viga=1");
  }

  const res = NextResponse.redirect(new URL("/admin", req.url), 303);
  res.cookies.set(ADMIN_COOKIE, adminCookieValue(), adminCookieOptions());
  return res;
}
