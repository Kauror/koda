import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import { SITE_TEXT_DEFAULTS_BY_KEY } from "@/lib/site-text-defaults";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const form = await req.formData();
  const key = str(form, "key");
  if (!key) {
    return NextResponse.json({ error: "Site text key is required" }, { status: 400 });
  }

  const value = form.get("valueEt");
  const valueEt = typeof value === "string" ? value : "";
  if (!valueEt.trim() && form.get("allowEmpty") !== "1") {
    return redirectTo(req, `/admin/site-texts?error=empty&key=${encodeURIComponent(key)}`);
  }

  const fallback = SITE_TEXT_DEFAULTS_BY_KEY.get(key);
  const existing = await prisma.siteText.findUnique({ where: { key } });
  if (!fallback && !existing) {
    return NextResponse.json({ error: "Unknown site text key" }, { status: 400 });
  }

  await prisma.siteText.upsert({
    where: { key },
    create: {
      key,
      valueEt,
      description: fallback?.description ?? null,
      group: fallback?.group ?? null,
    },
    update: {
      valueEt,
      ...(fallback ? { description: fallback.description, group: fallback.group } : {}),
    },
  });

  return redirectTo(req, `/admin/site-texts?saved=${encodeURIComponent(key)}`);
}
