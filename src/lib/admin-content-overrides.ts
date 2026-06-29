import { Prisma, TagType } from "@prisma/client";
import { prisma } from "./db";
import { slugify } from "./slug";
import { PUBLIC_ACTIVITY_FILTERS, CROSS_SECTOR_ACTIVITY } from "./activities";
import { PUBLIC_TOPIC_FILTERS, canonicalTopicLabel } from "./topics";

export type AdminOverrideInput = {
  titleOverride: string | null;
  summaryOverride: string | null;
  textOverride: string | null;
  visibilityOverride: boolean | null;
  hiddenReason: string | null;
  topicPrimary: string | null;
  topicSecondary: string | null;
  activityPrimary: string | null;
  activitySecondary: string | null;
  publicActivityFilterTags: string | null;
  publicActivityDisplayTags: string | null;
  publicSectorPageAllowed: string | null;
  reviewerNote: string | null;
};

export type ValidationResult =
  | { ok: true; value: AdminOverrideInput; topicValues: string[]; activityValues: string[] }
  | { ok: false; errors: string[] };

const PUBLIC_TOPIC_LABELS = new Set(PUBLIC_TOPIC_FILTERS.map((topic) => topic.name));
const PUBLIC_ACTIVITY_LABELS = new Set(PUBLIC_ACTIVITY_FILTERS.map((activity) => activity.name));
const SECTOR_PAGE_ALLOWED = new Set(["", "TRUE", "LIMITED", "FALSE"]);

export function adminActor(): string {
  return process.env.ADMIN_EMAIL || "admin";
}

export function nullable(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseVisibility(value: string | null): boolean | null {
  if (value === "visible") return true;
  if (value === "hidden") return false;
  return null;
}

export function parseAdminOverrideForm(form: FormData): AdminOverrideInput {
  return {
    titleOverride: nullable(form.get("titleOverride")),
    summaryOverride: nullable(form.get("summaryOverride")),
    textOverride: nullable(form.get("textOverride")),
    visibilityOverride: parseVisibility(nullable(form.get("visibilityOverride"))),
    hiddenReason: nullable(form.get("hiddenReason")),
    topicPrimary: nullable(form.get("topicPrimary")),
    topicSecondary: nullable(form.get("topicSecondary")),
    activityPrimary: nullable(form.get("activityPrimary")),
    activitySecondary: nullable(form.get("activitySecondary")),
    publicActivityFilterTags: nullable(form.get("publicActivityFilterTags")),
    publicActivityDisplayTags: nullable(form.get("publicActivityDisplayTags")),
    publicSectorPageAllowed: nullable(form.get("publicSectorPageAllowed")),
    reviewerNote: nullable(form.get("reviewerNote")),
  };
}

function splitList(value: string | null): string[] {
  return (value ?? "")
    .split(/[;\n,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(values: string[]): string | null {
  return values.length ? values.join("; ") : null;
}

function normalizeTopic(value: string): string | null {
  return canonicalTopicLabel(value) ?? (PUBLIC_TOPIC_LABELS.has(value) ? value : null);
}

function normalizePublicActivity(value: string, allowCrossSector: boolean): string | null {
  if (allowCrossSector && value === CROSS_SECTOR_ACTIVITY) return value;
  return PUBLIC_ACTIVITY_LABELS.has(value) ? value : null;
}

export function validateAdminOverrideInput(input: AdminOverrideInput): ValidationResult {
  const errors: string[] = [];
  const topicValues: string[] = [];
  const activityValues: string[] = [];

  const primaryTopic = input.topicPrimary ? normalizeTopic(input.topicPrimary) : null;
  if (input.topicPrimary && !primaryTopic) errors.push("Teema peab olema kehtiv v1.2 taksonoomia teema.");

  const secondaryTopics = splitList(input.topicSecondary);
  const normalizedSecondaryTopics = secondaryTopics.map((topic) => normalizeTopic(topic));
  normalizedSecondaryTopics.forEach((topic, i) => {
    if (!topic) errors.push(`Teisene teema ei ole lubatud: ${secondaryTopics[i]}`);
  });
  if (primaryTopic) topicValues.push(primaryTopic);
  topicValues.push(...normalizedSecondaryTopics.filter((topic): topic is string => !!topic));

  const primaryActivity = input.activityPrimary ? normalizePublicActivity(input.activityPrimary, false) : null;
  if (input.activityPrimary && !primaryActivity) errors.push("Tegevusala peab olema üks lukustatud 12 sektorist.");

  const secondaryActivities = splitList(input.activitySecondary);
  const normalizedSecondaryActivities = secondaryActivities.map((activity) => normalizePublicActivity(activity, false));
  normalizedSecondaryActivities.forEach((activity, i) => {
    if (!activity) errors.push(`Teisene tegevusala ei ole lubatud: ${secondaryActivities[i]}`);
  });
  if (primaryActivity) activityValues.push(primaryActivity);
  activityValues.push(...normalizedSecondaryActivities.filter((activity): activity is string => !!activity));

  const filterTags = splitList(input.publicActivityFilterTags);
  const normalizedFilterTags = filterTags.map((tag) => normalizePublicActivity(tag, true));
  normalizedFilterTags.forEach((tag, i) => {
    if (!tag) errors.push(`Avaliku filtri silt ei ole lubatud: ${filterTags[i]}`);
  });

  const displayTags = splitList(input.publicActivityDisplayTags);
  const normalizedDisplayTags = displayTags.map((tag) => normalizePublicActivity(tag, false));
  displayTags.forEach((tag, i) => {
    if (tag === CROSS_SECTOR_ACTIVITY) errors.push("Kõik tegevusalad / valdkondadeülene ei tohi olla public display tag.");
    if (!normalizedDisplayTags[i]) errors.push(`Avalik kuvamissilt ei ole lubatud: ${tag}`);
  });

  const sectorPageAllowed = input.publicSectorPageAllowed ?? "";
  if (!SECTOR_PAGE_ALLOWED.has(sectorPageAllowed)) {
    errors.push("Sektorilehe nähtavus peab olema TRUE, LIMITED või FALSE.");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    topicValues: [...new Set(topicValues)],
    activityValues: [...new Set(activityValues)],
    value: {
      ...input,
      topicPrimary: primaryTopic,
      topicSecondary: joinList(normalizedSecondaryTopics.filter((topic): topic is string => !!topic)),
      activityPrimary: primaryActivity,
      activitySecondary: joinList(normalizedSecondaryActivities.filter((activity): activity is string => !!activity)),
      publicActivityFilterTags: joinList(normalizedFilterTags.filter((tag): tag is string => !!tag)),
      publicActivityDisplayTags: joinList(normalizedDisplayTags.filter((tag): tag is string => !!tag)),
      publicSectorPageAllowed: input.publicSectorPageAllowed || null,
    },
  };
}

async function ensureTag(tx: Prisma.TransactionClient, type: TagType, name: string): Promise<string> {
  const slug = slugify(name) || "x";
  const tag = await tx.tag.upsert({
    where: { type_slug: { type, slug } },
    create: { type, slug, name },
    update: { name },
  });
  return tag.id;
}

export async function publishAdminContentDraft(contentItemId: string, actor = adminActor()) {
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { tags: { include: { tag: true } } },
  });
  if (!item) return { ok: false as const, errors: ["Kirjet ei leitud."] };
  const externalId = item.externalId ?? item.id;
  const draft = await prisma.adminContentDraft.findUnique({ where: { contentExternalId: externalId } });
  if (!draft) return { ok: false as const, errors: ["Avaldamiseks pole mustandit."] };

  const validation = validateAdminOverrideInput({
    titleOverride: draft.titleOverride,
    summaryOverride: draft.summaryOverride,
    textOverride: draft.textOverride,
    visibilityOverride: draft.visibilityOverride,
    hiddenReason: draft.hiddenReason,
    topicPrimary: draft.topicPrimary,
    topicSecondary: draft.topicSecondary,
    activityPrimary: draft.activityPrimary,
    activitySecondary: draft.activitySecondary,
    publicActivityFilterTags: draft.publicActivityFilterTags,
    publicActivityDisplayTags: draft.publicActivityDisplayTags,
    publicSectorPageAllowed: draft.publicSectorPageAllowed,
    reviewerNote: draft.reviewerNote,
  });
  if (!validation.ok) return validation;

  const run = await prisma.adminPublishRun.create({
    data: { kind: "content_override", status: "started", actor },
  });

  try {
    const oldValues = {
      adminDisplayTitleOverride: item.adminDisplayTitleOverride,
      adminSummaryOverride: item.adminSummaryOverride,
      adminTextOverride: item.adminTextOverride,
      adminVisibilityOverride: item.adminVisibilityOverride,
      adminHiddenReason: item.adminHiddenReason,
      tags: item.tags
        .filter((ct) => ct.tag.type === TagType.valdkond || ct.tag.type === TagType.tegevusala)
        .map((ct) => ({ type: ct.tag.type, name: ct.tag.name })),
    };

    await prisma.$transaction(async (tx) => {
      await tx.adminContentOverride.upsert({
        where: { contentExternalId: externalId },
        create: {
          contentExternalId: externalId,
          contentItemId: item.id,
          titleOverride: validation.value.titleOverride,
          summaryOverride: validation.value.summaryOverride,
          textOverride: validation.value.textOverride,
          visibilityOverride: validation.value.visibilityOverride,
          hiddenReason: validation.value.hiddenReason,
          topicPrimary: validation.value.topicPrimary,
          topicSecondary: validation.value.topicSecondary,
          activityPrimary: validation.value.activityPrimary,
          activitySecondary: validation.value.activitySecondary,
          publicActivityFilterTags: validation.value.publicActivityFilterTags,
          publicActivityDisplayTags: validation.value.publicActivityDisplayTags,
          publicSectorPageAllowed: validation.value.publicSectorPageAllowed,
          updatedBy: actor,
        },
        update: {
          contentItemId: item.id,
          titleOverride: validation.value.titleOverride,
          summaryOverride: validation.value.summaryOverride,
          textOverride: validation.value.textOverride,
          visibilityOverride: validation.value.visibilityOverride,
          hiddenReason: validation.value.hiddenReason,
          topicPrimary: validation.value.topicPrimary,
          topicSecondary: validation.value.topicSecondary,
          activityPrimary: validation.value.activityPrimary,
          activitySecondary: validation.value.activitySecondary,
          publicActivityFilterTags: validation.value.publicActivityFilterTags,
          publicActivityDisplayTags: validation.value.publicActivityDisplayTags,
          publicSectorPageAllowed: validation.value.publicSectorPageAllowed,
          updatedBy: actor,
          publishedAt: new Date(),
        },
      });

      await tx.contentItem.update({
        where: { id: item.id },
        data: {
          adminDisplayTitleOverride: validation.value.titleOverride,
          adminSummaryOverride: validation.value.summaryOverride,
          adminTextOverride: validation.value.textOverride,
          adminVisibilityOverride: validation.value.visibilityOverride,
          adminHiddenReason: validation.value.hiddenReason,
          publicActivityFilterTags: validation.value.publicActivityFilterTags,
          publicActivityDisplayTags: validation.value.publicActivityDisplayTags,
          publicSectorPageAllowed: validation.value.publicSectorPageAllowed,
        },
      });

      if (validation.topicValues.length || validation.activityValues.length) {
        const existing = await tx.contentTag.findMany({
          where: { contentItemId: item.id, tag: { type: { in: [TagType.valdkond, TagType.tegevusala] } } },
          select: { tagId: true },
        });
        await tx.contentTag.deleteMany({
          where: { contentItemId: item.id, tagId: { in: existing.map((row) => row.tagId) } },
        });
        const tagIds: string[] = [];
        for (const name of validation.topicValues) tagIds.push(await ensureTag(tx, TagType.valdkond, name));
        for (const name of validation.activityValues) tagIds.push(await ensureTag(tx, TagType.tegevusala, name));
        if (tagIds.length) {
          await tx.contentTag.createMany({
            data: [...new Set(tagIds)].map((tagId) => ({ contentItemId: item.id, tagId })),
            skipDuplicates: true,
          });
        }
      }

      await tx.adminContentDraft.update({
        where: { contentExternalId: externalId },
        data: { publishedAt: new Date(), updatedBy: actor },
      });
      await tx.adminAuditLog.create({
        data: {
          action: "content_override_publish",
          contentExternalId: externalId,
          contentItemId: item.id,
          oldValues: oldValues as Prisma.InputJsonValue,
          newValues: validation.value as Prisma.InputJsonValue,
          actor,
          publishRunId: run.id,
        },
      });
    });

    await prisma.adminPublishRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), validationJson: { ok: true } },
    });
    return { ok: true as const };
  } catch (error) {
    await prisma.adminPublishRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), errorSummary: error instanceof Error ? error.message : String(error) },
    });
    return { ok: false as const, errors: ["Avaldamine ebaõnnestus."] };
  }
}
