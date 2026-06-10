import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, requireAdmin, str } from "@/lib/adminRoute";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

const VALID_TYPES = ["sector", "interest", "size", "activity", "region", "service"] as const;
type TagType = (typeof VALID_TYPES)[number];

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const form = await req.formData();
  const name = str(form, "name");
  const type = str(form, "type");

  if (name && type && VALID_TYPES.includes(type as TagType)) {
    const slug = slugify(name);
    if (slug) {
      await prisma.tag.upsert({
        where: { type_slug: { type: type as TagType, slug } },
        create: { type: type as TagType, slug, name },
        update: { name },
      });
    }
  }

  return redirectBack(req, form, "/admin/tags");
}
