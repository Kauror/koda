import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const form = await req.formData();
  const action = str(form, "_action") ?? "update";

  const group = await prisma.topicGroup.findUnique({ where: { id } });
  if (!group) {
    return NextResponse.json({ error: "Topic group not found" }, { status: 404 });
  }

  if (action === "update") {
    const manualWeight = parseInt(str(form, "manualWeight") ?? "0", 10) || 0;
    const tagIds = form.getAll("tagIds").filter((v): v is string => typeof v === "string");
    const mainContentItemId = str(form, "mainContentItemId");

    await prisma.$transaction([
      prisma.topicGroup.update({
        where: { id },
        data: {
          title: str(form, "title") ?? group.title,
          slug: slugify(str(form, "slug") ?? group.slug) || group.slug,
          summary: str(form, "summary"),
          whyItMattersText: str(form, "whyItMattersText"),
          mainContentItemId,
          manualWeight: Math.max(-2, Math.min(2, manualWeight)),
          isEvergreen: form.get("isEvergreen") != null,
          isHidden: form.get("isHidden") != null,
        },
      }),
      prisma.topicGroupTag.deleteMany({ where: { topicGroupId: id } }),
      prisma.topicGroupTag.createMany({
        data: tagIds.map((tagId) => ({ topicGroupId: id, tagId })),
        skipDuplicates: true,
      }),
    ]);
  } else if (action === "add-member") {
    const contentItemId = str(form, "contentItemId");
    const relationType = (str(form, "relationType") ?? "history") as "main" | "history" | "related";
    if (contentItemId) {
      await prisma.contentTopicGroup.upsert({
        where: { contentItemId_topicGroupId: { contentItemId, topicGroupId: id } },
        create: { contentItemId, topicGroupId: id, relationType },
        update: { relationType },
      });
      if (relationType === "main") {
        await prisma.topicGroup.update({ where: { id }, data: { mainContentItemId: contentItemId } });
      }
    }
  } else if (action === "remove-member") {
    const contentItemId = str(form, "contentItemId");
    if (contentItemId) {
      await prisma.contentTopicGroup.deleteMany({ where: { contentItemId, topicGroupId: id } });
      if (group.mainContentItemId === contentItemId) {
        await prisma.topicGroup.update({ where: { id }, data: { mainContentItemId: null } });
      }
    }
  } else if (action === "set-main") {
    const contentItemId = str(form, "contentItemId");
    if (contentItemId) {
      await prisma.$transaction([
        prisma.topicGroup.update({ where: { id }, data: { mainContentItemId: contentItemId } }),
        prisma.contentTopicGroup.upsert({
          where: { contentItemId_topicGroupId: { contentItemId, topicGroupId: id } },
          create: { contentItemId, topicGroupId: id, relationType: "main" },
          update: { relationType: "main" },
        }),
      ]);
    }
  } else if (action === "delete") {
    await prisma.topicGroup.delete({ where: { id } });
    return redirectTo(req, "/admin/topics");
  }

  return redirectBack(req, form, `/admin/topics/${id}`);
}
