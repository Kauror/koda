import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, requireAdmin, str } from "@/lib/adminRoute";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const form = await req.formData();
  const action = str(form, "_action") ?? "update";

  const item = await prisma.contentItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Content item not found" }, { status: 404 });
  }

  if (action === "update") {
    const dateStr = str(form, "date");
    const manualWeight = parseInt(str(form, "manualWeight") ?? "0", 10) || 0;
    const tagIds = form.getAll("tagIds").filter((v): v is string => typeof v === "string");

    await prisma.$transaction([
      prisma.contentItem.update({
        where: { id },
        data: {
          displayTitle: str(form, "displayTitle"),
          summary: str(form, "summary"),
          date: dateStr ? new Date(dateStr) : null,
          manualWeight: Math.max(-2, Math.min(2, manualWeight)),
          isEvergreen: form.get("isEvergreen") != null,
          isHidden: form.get("isHidden") != null,
        },
      }),
      prisma.contentTag.deleteMany({ where: { contentItemId: id } }),
      prisma.contentTag.createMany({
        data: tagIds.map((tagId) => ({ contentItemId: id, tagId })),
        skipDuplicates: true,
      }),
    ]);
  } else if (action === "add-to-group") {
    const topicGroupId = str(form, "topicGroupId");
    const relationType = str(form, "relationType") ?? "history";
    if (topicGroupId) {
      await prisma.contentTopicGroup.upsert({
        where: { contentItemId_topicGroupId: { contentItemId: id, topicGroupId } },
        create: {
          contentItemId: id,
          topicGroupId,
          relationType: relationType as "main" | "history" | "related",
        },
        update: { relationType: relationType as "main" | "history" | "related" },
      });
    }
  } else if (action === "merge") {
    const duplicateId = str(form, "duplicateId");
    if (duplicateId && duplicateId !== id) {
      const duplicate = await prisma.contentItem.findUnique({
        where: { id: duplicateId },
        include: { tags: true, topicGroups: true },
      });
      if (duplicate) {
        await prisma.$transaction([
          // Carry over tags and group memberships the surviving item does not have yet.
          prisma.contentTag.createMany({
            data: duplicate.tags.map((t) => ({ contentItemId: id, tagId: t.tagId, weight: t.weight })),
            skipDuplicates: true,
          }),
          prisma.contentTopicGroup.createMany({
            data: duplicate.topicGroups.map((g) => ({
              contentItemId: id,
              topicGroupId: g.topicGroupId,
              relationType: g.relationType,
            })),
            skipDuplicates: true,
          }),
          // Groups whose main item was the duplicate now point at the survivor.
          prisma.topicGroup.updateMany({
            where: { mainContentItemId: duplicateId },
            data: { mainContentItemId: id },
          }),
          prisma.contentItem.update({ where: { id: duplicateId }, data: { isHidden: true } }),
        ]);
      }
    }
  }

  return redirectBack(req, form, `/admin/content/${id}`);
}
