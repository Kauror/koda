import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redirectBack, redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import {
  adminActor,
  parseAdminOverrideForm,
  publishAdminContentDraft,
  validateAdminOverrideInput,
} from "@/lib/admin-content-overrides";

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

  if (action === "save-draft" || action === "publish") {
    const externalId = item.externalId ?? item.id;
    const input = parseAdminOverrideForm(form);
    const validation = validateAdminOverrideInput(input);
    if (!validation.ok) {
      return NextResponse.json({ error: "Invalid admin override", details: validation.errors }, { status: 400 });
    }

    await prisma.adminContentDraft.upsert({
      where: { contentExternalId: externalId },
      create: {
        contentExternalId: externalId,
        contentItemId: item.id,
        ...validation.value,
        updatedBy: adminActor(),
      },
      update: {
        contentItemId: item.id,
        ...validation.value,
        publishedAt: null,
        updatedBy: adminActor(),
      },
    });

    if (action === "publish") {
      const result = await publishAdminContentDraft(item.id, adminActor());
      if (!result.ok) {
        return NextResponse.json({ error: "Publish failed", details: result.errors }, { status: 400 });
      }
      return redirectTo(req, `/admin/content/${id}?published=1`);
    }
    return redirectTo(req, `/admin/content/${id}?saved=1`);
  } else if (action === "clear-published") {
    const externalId = item.externalId ?? item.id;
    await prisma.$transaction([
      prisma.adminContentOverride.deleteMany({ where: { contentExternalId: externalId } }),
      prisma.adminContentDraft.deleteMany({ where: { contentExternalId: externalId } }),
      prisma.contentItem.update({
        where: { id },
        data: {
          adminDisplayTitleOverride: null,
          adminSummaryOverride: null,
          adminTextOverride: null,
          adminVisibilityOverride: null,
          adminHiddenReason: null,
          publicActivityFilterTags: null,
          publicActivityDisplayTags: null,
          publicSectorPageAllowed: null,
        },
      }),
      prisma.adminAuditLog.create({
        data: {
          action: "content_override_clear",
          contentExternalId: externalId,
          contentItemId: id,
          actor: adminActor(),
        },
      }),
    ]);
    return redirectTo(req, `/admin/content/${id}?cleared=1`);
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
