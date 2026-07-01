import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import { slugify } from "@/lib/slug";
import { isValidRole, isValidStatus } from "@/lib/content-threads";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const form = await req.formData();
  const action = str(form, "_action") ?? "update";

  const thread = await prisma.contentThread.findUnique({ where: { id } });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  if (action === "update") {
    const status = str(form, "status");
    const sortPriority = parseInt(str(form, "sortPriority") ?? "0", 10) || 0;
    await prisma.contentThread.update({
      where: { id },
      data: {
        title: str(form, "title") ?? thread.title,
        slug: slugify(str(form, "slug") ?? thread.slug) || thread.slug,
        description: str(form, "description"),
        primaryTopic: str(form, "primaryTopic"),
        primarySector: str(form, "primarySector"),
        status: isValidStatus(status) ? status : thread.status,
        featured: form.get("featured") != null,
        sortPriority,
      },
    });
  } else if (action === "add-item") {
    // The content select carries the item's stable externalId as its value, so
    // rows without an externalId cannot be attached (they would not survive an
    // import). The @@unique([threadId, contentExternalId]) guards duplicates.
    const contentExternalId = str(form, "contentExternalId");
    const role = str(form, "role");
    if (contentExternalId) {
      await prisma.contentThreadItem.upsert({
        where: { threadId_contentExternalId: { threadId: id, contentExternalId } },
        create: {
          threadId: id,
          contentExternalId,
          role: isValidRole(role) ? role : null,
        },
        update: isValidRole(role) ? { role } : {},
      });
    }
  } else if (action === "remove-item") {
    const itemId = str(form, "itemId");
    if (itemId) {
      await prisma.contentThreadItem.deleteMany({ where: { id: itemId, threadId: id } });
    }
  } else if (action === "set-role") {
    const itemId = str(form, "itemId");
    const role = str(form, "role");
    if (itemId) {
      await prisma.contentThreadItem.updateMany({
        where: { id: itemId, threadId: id },
        data: { role: isValidRole(role) ? role : null },
      });
    }
  } else if (action === "set-anchor") {
    // Only one anchor per thread: clear the rest, then set this one.
    const itemId = str(form, "itemId");
    if (itemId) {
      await prisma.$transaction([
        prisma.contentThreadItem.updateMany({ where: { threadId: id }, data: { isAnchor: false } }),
        prisma.contentThreadItem.updateMany({ where: { id: itemId, threadId: id }, data: { isAnchor: true } }),
      ]);
    }
  } else if (action === "set-sort") {
    const itemId = str(form, "itemId");
    const sortOrder = parseInt(str(form, "sortOrder") ?? "0", 10) || 0;
    if (itemId) {
      await prisma.contentThreadItem.updateMany({
        where: { id: itemId, threadId: id },
        data: { sortOrder },
      });
    }
  } else if (action === "delete") {
    await prisma.contentThread.delete({ where: { id } });
    return redirectTo(req, "/admin/threads");
  }

  return redirectBack(req, form, `/admin/threads/${id}`);
}
