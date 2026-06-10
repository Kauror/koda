import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const form = await req.formData();
  const title = str(form, "title");
  if (!title) return redirectBack(req, form, "/admin/topics");

  let slug = slugify(title) || "teema";
  // Ensure unique slug.
  const existing = await prisma.topicGroup.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const group = await prisma.topicGroup.create({
    data: {
      title,
      slug,
      summary: str(form, "summary"),
    },
  });

  return redirectTo(req, `/admin/topics/${group.id}`);
}
