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
  if (!title) return redirectBack(req, form, "/admin/threads");

  let slug = slugify(str(form, "slug") ?? title) || "teemaliin";
  // Ensure a unique slug.
  const existing = await prisma.contentThread.findUnique({ where: { slug } });
  if (existing) slug = `${slug}-${Date.now().toString(36)}`;

  const thread = await prisma.contentThread.create({
    data: {
      title,
      slug,
      description: str(form, "description"),
    },
  });

  return redirectTo(req, `/admin/threads/${thread.id}`);
}
