import { NextRequest, NextResponse } from "next/server";
import { EvidenceLinkType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { redirectBack, redirectTo, requireAdmin, str } from "@/lib/adminRoute";
import {
  adminActor,
  parseAdminOverrideForm,
  publishAdminContentDraft,
  validateAdminOverrideInput,
} from "@/lib/admin-content-overrides";
import { isValidRole } from "@/lib/content-threads";

export const dynamic = "force-dynamic";

const MANUAL_RELATED_LINK_TYPES = new Set<EvidenceLinkType>([
  EvidenceLinkType.related_news,
  EvidenceLinkType.related_opinion,
  EvidenceLinkType.public_explanation,
  EvidenceLinkType.same_policy_thread,
  EvidenceLinkType.source_evidence,
]);

function linkLabelEt(type: EvidenceLinkType): string {
  switch (type) {
    case EvidenceLinkType.related_opinion:
      return "Koja seisukoht";
    case EvidenceLinkType.related_news:
    case EvidenceLinkType.public_explanation:
      return "Selgitav uudis";
    case EvidenceLinkType.same_policy_thread:
      return "Sama teema";
    case EvidenceLinkType.source_evidence:
      return "Seotud allikas";
    default:
      return "Seotud allikas";
  }
}

function parseSortPriority(value: string | null): number {
  if (!value) return 50;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 50;
}

function contentReferenceCandidates(raw: string): string[] {
  const values = new Set<string>([raw.trim()]);
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) values.add(decodeURIComponent(last));
    values.add(url.href);
  } catch {
    if (raw.startsWith("/")) {
      const parts = raw.split("?")[0].split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) values.add(decodeURIComponent(last));
    }
  }
  return [...values].filter(Boolean);
}

async function resolveContentReference(raw: string) {
  const candidates = contentReferenceCandidates(raw);
  return prisma.contentItem.findFirst({
    where: {
      OR: [
        { id: { in: candidates } },
        { externalId: { in: candidates } },
        { canonicalUrl: { in: candidates } },
        { sourceUrl: { in: candidates } },
      ],
    },
  });
}

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
  } else if (action === "attach-to-thread") {
    // Link this item to an admin thread by its stable externalId (survives
    // re-imports). Rows without an externalId cannot be linked.
    const threadId = str(form, "threadId");
    const role = str(form, "role");
    if (threadId && item.externalId) {
      await prisma.contentThreadItem.upsert({
        where: {
          threadId_contentExternalId: { threadId, contentExternalId: item.externalId },
        },
        create: {
          threadId,
          contentExternalId: item.externalId,
          role: isValidRole(role) ? role : null,
        },
        update: isValidRole(role) ? { role } : {},
      });
    }
  } else if (action === "detach-thread") {
    const threadId = str(form, "threadId");
    if (threadId && item.externalId) {
      await prisma.contentThreadItem.deleteMany({
        where: { threadId, contentExternalId: item.externalId },
      });
    }
  } else if (action === "add-related-link") {
    const targetContent = str(form, "targetContent");
    const rawLinkType = str(form, "linkType") as EvidenceLinkType | null;
    const linkType = rawLinkType && MANUAL_RELATED_LINK_TYPES.has(rawLinkType) ? rawLinkType : EvidenceLinkType.related_news;
    if (!targetContent) {
      return redirectTo(req, `/admin/content/${id}?linkError=${encodeURIComponent("target missing")}`);
    }
    const target = await resolveContentReference(targetContent);
    if (!target) {
      return redirectTo(req, `/admin/content/${id}?linkError=${encodeURIComponent("content not found")}`);
    }
    if (target.id === id) {
      return redirectTo(req, `/admin/content/${id}?linkError=${encodeURIComponent("cannot link item to itself")}`);
    }
    const sortPriority = parseSortPriority(str(form, "sortPriority"));
    const linkData = {
      relationRole: "manual_admin",
      relationLabelEt: linkLabelEt(linkType),
      linkConfidence: "high",
      linkBasis: `Manual admin relation: ${item.externalId ?? item.id} -> ${target.externalId ?? target.id}`,
      canonicalPolicyThreadId: item.topicGroupCandidate || target.topicGroupCandidate || item.policyThreadKey || target.policyThreadKey || null,
      sortPriority,
    };
    const existingLink = await prisma.contentEvidenceLink.findFirst({
      where: {
        linkType,
        OR: [
          { fromContentId: id, toContentId: target.id },
          { fromContentId: target.id, toContentId: id },
        ],
      },
    });
    await prisma.$transaction([
      existingLink
        ? prisma.contentEvidenceLink.update({ where: { id: existingLink.id }, data: linkData })
        : prisma.contentEvidenceLink.create({
            data: {
              fromContentId: id,
              toContentId: target.id,
              linkType,
              ...linkData,
            },
          }),
      prisma.adminAuditLog.create({
        data: {
          action: "content_related_link_add",
          contentExternalId: item.externalId ?? item.id,
          contentItemId: id,
          actor: adminActor(),
          newValues: { targetContentId: target.id, targetExternalId: target.externalId, linkType, sortPriority },
        },
      }),
    ]);
    return redirectTo(req, `/admin/content/${id}?linked=1`);
  } else if (action === "remove-related-link") {
    const relatedLinkId = str(form, "relatedLinkId");
    if (relatedLinkId) {
      const link = await prisma.contentEvidenceLink.findUnique({ where: { id: relatedLinkId } });
      if (link && (link.fromContentId === id || link.toContentId === id)) {
        await prisma.$transaction([
          prisma.contentEvidenceLink.delete({ where: { id: relatedLinkId } }),
          prisma.adminAuditLog.create({
            data: {
              action: "content_related_link_remove",
              contentExternalId: item.externalId ?? item.id,
              contentItemId: id,
              actor: adminActor(),
              oldValues: {
                fromContentId: link.fromContentId,
                toContentId: link.toContentId,
                linkType: link.linkType,
              },
            },
          }),
        ]);
      }
    }
    return redirectTo(req, `/admin/content/${id}?unlinked=1`);
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
