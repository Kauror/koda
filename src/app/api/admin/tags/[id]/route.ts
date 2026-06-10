import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, requireAdmin, str } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const form = await req.formData();
  const action = str(form, "_action");

  if (action === "delete") {
    await prisma.tag.delete({ where: { id } }).catch(() => {});
  }

  return redirectBack(req, form, "/admin/tags");
}
