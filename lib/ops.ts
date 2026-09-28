import { Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "./prisma";
import { HttpError } from "./authz";
import { realignSegment, ms, type WordLike } from "./realign";
import { reanchorAnnotation, validateSpan, type WordSnapshot } from "./anchor";
import {
  restoreSnapshot,
  takeSnapshot,
  type Snapshot,
  type Tx,
} from "./snapshot";
import { CORRECTION } from "./labels";
import type { AnnotationDTO, OpsResultDTO, SegmentDTO } from "./dto";

/**
 * The operation log (§9.5).
 *
 * The client mutates optimistically and sends an ordered batch. The server
 * applies the batch in one transaction, records an inverse patch per
 * operation, and returns the authoritative state of everything it touched.
 */

const timecode = z.number().min(0).max(60 * 60 * 24);

export const opSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("segment.edit"),
    segmentId: z.string().min(1),
    text: z.string().max(20000),
  }),
  z.object({
    kind: z.literal("segment.split"),
    segmentId: z.string().min(1),
    /** index of the word that starts the second half */
    wordIndex: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal("segment.merge"),
    /** this segment is merged into the one before it */
    segmentId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("segment.timing"),
    segmentId: z.string().min(1),
    start: timecode.optional(),
    end: timecode.optional(),
    pushNeighbour: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal("segment.review"),
    segmentId: z.string().min(1),
    isReviewed: z.boolean(),
  }),
  z.object({
    kind: z.literal("ann.create"),
    tempId: z.string().min(1).optional(),
    wordIds: z.array(z.string().min(1)).min(1),
    type: z.string().min(1).max(64),
    languageTag: z.string().max(35).nullable().optional(),
    nativeAlternative: z.string().max(500).nullable().optional(),
    pronunciation: z.enum(["local", "foreign", "mixed/unclear"]).nullable().optional(),
    confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    kind: z.literal("ann.update"),
    annotationId: z.string().min(1),
    type: z.string().min(1).max(64).optional(),
    languageTag: z.string().max(35).nullable().optional(),
    nativeAlternative: z.string().max(500).nullable().optional(),
    pronunciation: z.enum(["local", "foreign", "mixed/unclear"]).nullable().optional(),
    confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  }),
  z.object({
    kind: z.literal("ann.delete"),
    annotationId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("ann.reattach"),
    annotationId: z.string().min(1),
    wordIds: z.array(z.string().min(1)).min(1),
  }),
]);

export type Op = z.infer<typeof opSchema>;

export const opsRequestSchema = z.object({
  ops: z.array(opSchema).min(1).max(200),
});

export const MAX_REVISIONS = 100;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const segmentInclude = {
  words: { orderBy: { index: "asc" } },
} satisfies Prisma.SegmentInclude;

type SegmentRow = Prisma.SegmentGetPayload<{ include: typeof segmentInclude }>;

function toSegmentDTO(row: SegmentRow): SegmentDTO {
  return {
    id: row.id,
    index: row.index,
    start: row.start,
    end: row.end,
    text: row.text,
    speakerTag: row.speakerTag,
    isReviewed: row.isReviewed,
    words: row.words.map((w) => ({
      id: w.id,
      index: w.index,
      text: w.text,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      timing: w.timing,
      annotationId: w.annotationId,
      correctionId: w.correctionId,
    })),
  };
}

type AnnotationWordRef = { id: string; segmentId: string; index: number };

type AnnotationRow = Prisma.AnnotationGetPayload<{
  include: {
    createdBy: { select: { name: true } };
    words: { select: { id: true; segmentId: true; index: true } };
    correctedWords: { select: { id: true; segmentId: true; index: true } };
  };
}>;

function annotationAnchors(
  row: { words: AnnotationWordRef[]; correctedWords?: AnnotationWordRef[] },
): AnnotationWordRef[] {
  return [...row.words, ...(row.correctedWords ?? [])].sort((a, b) => {
    if (a.segmentId !== b.segmentId) return a.segmentId.localeCompare(b.segmentId);
    return a.index - b.index;
  });
}

export function toAnnotationDTO(row: AnnotationRow): AnnotationDTO {
  const words = annotationAnchors(row);
  return {
    id: row.id,
    type: row.type,
    surface: row.surface,
    start: row.start,
    end: row.end,
    languageTag: row.languageTag,
    nativeAlternative: row.nativeAlternative,
    pronunciation: row.pronunciation,
    confidence: row.confidence,
    note: row.note,
    status: row.status,
    createdById: row.createdById,
    createdByName: row.createdBy.name,
    updatedAt: row.updatedAt.toISOString(),
    segmentId: words[0]?.segmentId ?? null,
    wordIds: words.map((w) => w.id),
  };
}

const annotationInclude = {
  createdBy: { select: { name: true } },
  words: { select: { id: true, segmentId: true, index: true } },
  correctedWords: { select: { id: true, segmentId: true, index: true } },
} satisfies Prisma.AnnotationInclude;

async function loadSegment(tx: Tx, segmentId: string, recordingId: string) {
  const segment = await tx.segment.findUnique({
    where: { id: segmentId },
    include: segmentInclude,
  });
  if (!segment || segment.recordingId !== recordingId) {
    throw new HttpError(404, "segment-not-found", "That segment no longer exists.");
  }
  return segment;
}

async function annotationIdsForSegments(
  tx: Tx,
  segmentIds: string[],
): Promise<string[]> {
  if (segmentIds.length === 0) return [];
  const rows = await tx.word.findMany({
    where: {
      segmentId: { in: segmentIds },
      OR: [{ annotationId: { not: null } }, { correctionId: { not: null } }],
    },
    select: { annotationId: true, correctionId: true },
  });
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.annotationId) ids.add(row.annotationId);
    if (row.correctionId) ids.add(row.correctionId);
  }
  return [...ids];
}

/**
 * Re-number segments 0..n-1 by start time, in two statements so the unique
 * (recordingId, index) index is never transiently violated.
 */
async function repack(tx: Tx, recordingId: string): Promise<void> {
  await tx.$executeRaw`
    WITH ranked AS (
      SELECT "id", (ROW_NUMBER() OVER (ORDER BY "start" ASC, "index" ASC) - 1) AS rn
      FROM "Segment" WHERE "recordingId" = ${recordingId}
    )
    UPDATE "Segment" s SET "index" = -1 - ranked.rn
    FROM ranked WHERE s."id" = ranked."id"
  `;
  await tx.$executeRaw`
    UPDATE "Segment" SET "index" = -"index" - 1
    WHERE "recordingId" = ${recordingId} AND "index" < 0
  `;
}

interface OpScope {
  segmentIds: string[];
  annotationIds: string[];
}

interface OpOutcome {
  scope: OpScope;
  /** annotations that lost all their words in this operation */
  orphanedIds: string[];
  tempId?: string;
  createdAnnotationId?: string;
  removedSegmentIds: string[];
  removedAnnotationIds: string[];
}

// ---------------------------------------------------------------------------
// individual operations
// ---------------------------------------------------------------------------

async function rewriteSegmentWords(
  tx: Tx,
  segmentId: string,
  words: {
    id: string | null;
    index: number;
    text: string;
    start: number;
    end: number;
    confidence: number | null;
    timing: "MEASURED" | "INTERPOLATED";
    annotationId: string | null;
    correctionId: string | null;
  }[],
): Promise<void> {
  await tx.word.deleteMany({ where: { segmentId } });
  if (words.length === 0) return;
  await tx.word.createMany({
    data: words.map((w) => ({
      ...(w.id ? { id: w.id } : {}),
      segmentId,
      index: w.index,
      text: w.text,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      timing: w.timing,
      annotationId: w.annotationId,
      correctionId: w.correctionId,
    })),
  });
}

/** Shrink or orphan every annotation that lost words (§9.4). */
async function reanchorAfterEdit(
  tx: Tx,
  annotationIds: string[],
): Promise<string[]> {
  const orphaned: string[] = [];
  for (const id of annotationIds) {
    const annotation = await tx.annotation.findUnique({
      where: { id },
      include: {
        words: { select: { id: true, text: true, start: true, end: true, segmentId: true, index: true } },
        correctedWords: { select: { id: true, text: true, start: true, end: true, segmentId: true, index: true } },
      },
    });
    if (!annotation) continue;

    const linked =
      annotation.type === CORRECTION
        ? annotation.correctedWords.length > 0
          ? annotation.correctedWords
          : annotation.words
        : annotation.words.length > 0
          ? annotation.words
          : annotation.correctedWords;

    const survivors = new Map<string, WordSnapshot>(
      linked.map((w) => [w.id, w]),
    );
    const outcome = reanchorAnnotation(
      {
        id: annotation.id,
        type: annotation.type,
        surface: annotation.surface,
        start: annotation.start,
        end: annotation.end,
        status: annotation.status,
        wordIds: linked.map((w) => w.id),
      },
      survivors,
    );

    if (linked.length === 0) {
      await tx.annotation.update({
        where: { id },
        data: { status: "NEEDS_REVIEW" },
      });
      orphaned.push(id);
      continue;
    }

    if (outcome.kind === "orphaned") {
      const key = annotation.type === CORRECTION ? "correctionId" : "annotationId";
      await tx.word.updateMany({
        where: { [key]: id },
        data: { [key]: null },
      });
      await tx.annotation.update({
        where: { id },
        data: { status: "NEEDS_REVIEW" },
      });
      orphaned.push(id);
      continue;
    }

    if (outcome.kind === "shrunk" || outcome.kind === "unchanged") {
      const sorted = [...linked].sort((a, b) => a.index - b.index);
      await tx.annotation.update({
        where: { id },
        data: {
          surface: sorted.map((w) => w.text).join(" "),
          start: ms(sorted[0].start),
          end: ms(sorted[sorted.length - 1].end),
          status: annotation.status === "NEEDS_REVIEW" ? "ACTIVE" : annotation.status,
        },
      });
    }
  }
  return orphaned;
}

async function opSegmentEdit(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "segment.edit" }>,
): Promise<OpOutcome> {
  const segment = await loadSegment(tx, op.segmentId, recordingId);
  const annotationIds = await annotationIdsForSegments(tx, [segment.id]);

  const oldWords: WordLike[] = segment.words.map((w) => ({
    id: w.id,
    text: w.text,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
    timing: w.timing,
    annotationId: w.annotationId,
    correctionId: w.correctionId,
  }));

  const result = realignSegment(oldWords, op.text, segment.start, segment.end);

  if (result.words.length === 0) {
    throw new HttpError(
      400,
      "empty-segment",
      "A segment cannot be emptied. Merge it into its neighbour instead (⌫ at the segment start).",
    );
  }

  await rewriteSegmentWords(tx, segment.id, result.words);
  await tx.segment.update({
    where: { id: segment.id },
    data: { text: result.text },
  });

  const orphanedIds = await reanchorAfterEdit(tx, annotationIds);

  return {
    scope: { segmentIds: [segment.id], annotationIds },
    orphanedIds,
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

async function opSegmentSplit(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "segment.split" }>,
): Promise<OpOutcome> {
  const segment = await loadSegment(tx, op.segmentId, recordingId);
  if (op.wordIndex <= 0 || op.wordIndex >= segment.words.length) {
    throw new HttpError(
      400,
      "bad-split",
      "A split has to leave a word on both sides.",
    );
  }

  const head = segment.words.slice(0, op.wordIndex);
  const tail = segment.words.slice(op.wordIndex);

  // §9.1: an annotation may not cross a segment boundary.
  const headLinguistic = new Set(
    head.map((w) => w.annotationId).filter((v): v is string => v !== null),
  );
  const headCorrections = new Set(
    head.map((w) => w.correctionId).filter((v): v is string => v !== null),
  );
  const straddling = tail.find(
    (w) =>
      (w.annotationId && headLinguistic.has(w.annotationId)) ||
      (w.correctionId && headCorrections.has(w.correctionId)),
  );
  if (straddling) {
    throw new HttpError(
      409,
      "split-would-cut-annotation",
      "Splitting here would cut an annotation in half. Remove the annotation first, then split.",
    );
  }

  const annotationIds = await annotationIdsForSegments(tx, [segment.id]);

  const created = await tx.segment.create({
    data: {
      recordingId,
      index: -999999,
      start: ms(tail[0].start),
      end: ms(segment.end),
      text: tail.map((w) => w.text).join(" "),
      speakerTag: segment.speakerTag,
      isReviewed: false,
    },
  });

  await tx.$executeRaw`
    UPDATE "Word" SET "index" = -1 - "index" WHERE "segmentId" = ${segment.id}
  `;
  await tx.word.updateMany({
    where: { id: { in: tail.map((w) => w.id) } },
    data: { segmentId: created.id },
  });
  for (const [i, w] of tail.entries()) {
    await tx.word.update({ where: { id: w.id }, data: { index: i } });
  }
  for (const [i, w] of head.entries()) {
    await tx.word.update({ where: { id: w.id }, data: { index: i } });
  }

  await tx.segment.update({
    where: { id: segment.id },
    data: {
      end: ms(head[head.length - 1].end),
      text: head.map((w) => w.text).join(" "),
      isReviewed: false,
    },
  });

  await repack(tx, recordingId);

  return {
    scope: { segmentIds: [segment.id, created.id], annotationIds },
    orphanedIds: [],
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

async function opSegmentMerge(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "segment.merge" }>,
): Promise<OpOutcome> {
  const segment = await loadSegment(tx, op.segmentId, recordingId);
  const previous = await tx.segment.findFirst({
    where: { recordingId, index: { lt: segment.index } },
    orderBy: { index: "desc" },
    include: segmentInclude,
  });
  if (!previous) {
    throw new HttpError(
      400,
      "no-previous-segment",
      "This is the first segment — there is nothing above it to merge into.",
    );
  }

  const annotationIds = await annotationIdsForSegments(tx, [
    segment.id,
    previous.id,
  ]);

  const offset = previous.words.length;

  // Park the incoming words at negative indices before they move, so the
  // unique (segmentId, index) is never transiently violated by two words
  // sharing a position in the merged segment.
  await tx.$executeRaw`
    UPDATE "Word" SET "index" = -1 - "index" WHERE "segmentId" = ${segment.id}
  `;
  await tx.word.updateMany({
    where: { segmentId: segment.id },
    data: { segmentId: previous.id },
  });
  for (const [i, w] of segment.words.entries()) {
    await tx.word.update({
      where: { id: w.id },
      data: { index: offset + i },
    });
  }

  await tx.segment.update({
    where: { id: previous.id },
    data: {
      end: ms(segment.end),
      text: `${previous.text} ${segment.text}`.trim(),
      isReviewed: previous.isReviewed && segment.isReviewed,
    },
  });
  await tx.segment.delete({ where: { id: segment.id } });
  await repack(tx, recordingId);

  return {
    scope: { segmentIds: [previous.id, segment.id], annotationIds },
    orphanedIds: [],
    removedSegmentIds: [segment.id],
    removedAnnotationIds: [],
  };
}

async function opSegmentTiming(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "segment.timing" }>,
): Promise<OpOutcome> {
  const segment = await loadSegment(tx, op.segmentId, recordingId);
  const previous = await tx.segment.findFirst({
    where: { recordingId, index: { lt: segment.index } },
    orderBy: { index: "desc" },
  });
  const next = await tx.segment.findFirst({
    where: { recordingId, index: { gt: segment.index } },
    orderBy: { index: "asc" },
  });

  const scopeSegments = [segment.id];
  let start = op.start !== undefined ? ms(op.start) : segment.start;
  let end = op.end !== undefined ? ms(op.end) : segment.end;

  if (end <= start) {
    throw new HttpError(
      400,
      "inverted-timing",
      "A segment has to end after it starts.",
    );
  }

  if (previous && start < previous.end) {
    if (!op.pushNeighbour) {
      throw new HttpError(
        409,
        "overlaps-previous",
        "That start is inside the segment above. Use Push neighbour to move it too.",
      );
    }
    if (start <= previous.start) {
      throw new HttpError(
        409,
        "would-collapse-previous",
        "That would leave the segment above with no duration.",
      );
    }
    await tx.segment.update({ where: { id: previous.id }, data: { end: start } });
    scopeSegments.push(previous.id);
  }

  if (next && end > next.start) {
    if (!op.pushNeighbour) {
      throw new HttpError(
        409,
        "overlaps-next",
        "That end is inside the segment below. Use Push neighbour to move it too.",
      );
    }
    if (end >= next.end) {
      throw new HttpError(
        409,
        "would-collapse-next",
        "That would leave the segment below with no duration.",
      );
    }
    await tx.segment.update({ where: { id: next.id }, data: { start: end } });
    scopeSegments.push(next.id);
  }

  start = ms(start);
  end = ms(end);
  await tx.segment.update({
    where: { id: segment.id },
    data: { start, end },
  });

  return {
    scope: { segmentIds: scopeSegments, annotationIds: [] },
    orphanedIds: [],
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

async function opSegmentReview(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "segment.review" }>,
): Promise<OpOutcome> {
  const segment = await loadSegment(tx, op.segmentId, recordingId);
  await tx.segment.update({
    where: { id: segment.id },
    data: { isReviewed: op.isReviewed },
  });
  return {
    scope: { segmentIds: [segment.id], annotationIds: [] },
    orphanedIds: [],
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

interface SpanWord extends WordSnapshot {
  annotationId: string | null;
  correctionId: string | null;
}

async function loadSpan(
  tx: Tx,
  recordingId: string,
  wordIds: string[],
): Promise<SpanWord[]> {
  const words = await tx.word.findMany({
    where: { id: { in: wordIds }, segment: { recordingId } },
    select: {
      id: true,
      text: true,
      start: true,
      end: true,
      segmentId: true,
      index: true,
      annotationId: true,
      correctionId: true,
    },
  });
  if (words.length !== wordIds.length) {
    throw new HttpError(
      409,
      "words-moved",
      "Some of those words have changed since you selected them. Select them again.",
    );
  }
  return words.sort((a, b) => a.index - b.index);
}

async function opAnnCreate(
  tx: Tx,
  recordingId: string,
  userId: string,
  op: Extract<Op, { kind: "ann.create" }>,
): Promise<OpOutcome> {
  const words = await loadSpan(tx, recordingId, op.wordIds);
  const isCorrection = op.type === CORRECTION;
  const annotated = new Set(
    (
      await tx.word.findMany({
        where: isCorrection
          ? { id: { in: op.wordIds }, correctionId: { not: null } }
          : { id: { in: op.wordIds }, annotationId: { not: null } },
        select: { id: true },
      })
    ).map((w) => w.id),
  );

  const validation = validateSpan(words, annotated);
  if (!validation.ok) {
    throw new HttpError(
      409,
      `span-${validation.reason}`,
      spanMessage(validation.reason, isCorrection),
    );
  }

  const annotation = await tx.annotation.create({
    data: {
      recordingId,
      type: op.type,
      surface: words.map((w) => w.text).join(" "),
      start: ms(words[0].start),
      end: ms(words[words.length - 1].end),
      languageTag: op.languageTag ?? null,
      nativeAlternative: op.nativeAlternative ?? null,
      pronunciation: op.pronunciation ?? null,
      confidence: op.confidence ?? null,
      note: op.note ?? null,
      status: "ACTIVE",
      createdById: userId,
    },
  });

  await tx.word.updateMany({
    where: { id: { in: op.wordIds } },
    data: isCorrection
      ? { correctionId: annotation.id }
      : { annotationId: annotation.id },
  });

  return {
    scope: {
      segmentIds: [validation.segmentId!],
      annotationIds: [annotation.id],
    },
    orphanedIds: [],
    tempId: op.tempId,
    createdAnnotationId: annotation.id,
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

function spanMessage(reason: string | undefined, correction = false): string {
  switch (reason) {
    case "crosses-segment":
      return "Code-switches cannot cross segments. Merge the segments first (⌫ at the segment start).";
    case "not-contiguous":
      return "An annotation has to cover a run of neighbouring words.";
    case "already-annotated":
      return correction
        ? "One of those words already has a correction. Remove it first."
        : "One of those words already carries an annotation. Remove it first.";
    default:
      return "Select at least one word.";
  }
}

async function opAnnUpdate(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "ann.update" }>,
): Promise<OpOutcome> {
  const annotation = await tx.annotation.findUnique({
    where: { id: op.annotationId },
    include: {
      words: { select: { segmentId: true } },
      correctedWords: { select: { segmentId: true } },
    },
  });
  if (!annotation || annotation.recordingId !== recordingId) {
    throw new HttpError(404, "annotation-not-found", "That annotation is gone.");
  }
  await tx.annotation.update({
    where: { id: op.annotationId },
    data: {
      ...(op.type !== undefined ? { type: op.type } : {}),
      ...(op.languageTag !== undefined ? { languageTag: op.languageTag } : {}),
      ...(op.nativeAlternative !== undefined ? { nativeAlternative: op.nativeAlternative } : {}),
      ...(op.pronunciation !== undefined ? { pronunciation: op.pronunciation } : {}),
      ...(op.confidence !== undefined ? { confidence: op.confidence } : {}),
      ...(op.note !== undefined ? { note: op.note } : {}),
    },
  });
  return {
    scope: {
      segmentIds: [
        ...new Set([
          ...annotation.words.map((w) => w.segmentId),
          ...annotation.correctedWords.map((w) => w.segmentId),
        ]),
      ],
      annotationIds: [annotation.id],
    },
    orphanedIds: [],
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

async function opAnnDelete(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "ann.delete" }>,
): Promise<OpOutcome> {
  const annotation = await tx.annotation.findUnique({
    where: { id: op.annotationId },
    include: {
      words: { select: { segmentId: true } },
      correctedWords: { select: { segmentId: true } },
    },
  });
  if (!annotation || annotation.recordingId !== recordingId) {
    throw new HttpError(404, "annotation-not-found", "That annotation is gone.");
  }
  const segmentIds = [
    ...new Set([
      ...annotation.words.map((w) => w.segmentId),
      ...annotation.correctedWords.map((w) => w.segmentId),
    ]),
  ];

  await tx.word.updateMany({
    where: { annotationId: annotation.id },
    data: { annotationId: null },
  });
  await tx.word.updateMany({
    where: { correctionId: annotation.id },
    data: { correctionId: null },
  });
  await tx.annotation.delete({ where: { id: annotation.id } });

  return {
    scope: { segmentIds, annotationIds: [annotation.id] },
    orphanedIds: [],
    removedSegmentIds: [],
    removedAnnotationIds: [annotation.id],
  };
}

async function opAnnReattach(
  tx: Tx,
  recordingId: string,
  op: Extract<Op, { kind: "ann.reattach" }>,
): Promise<OpOutcome> {
  const annotation = await tx.annotation.findUnique({
    where: { id: op.annotationId },
    include: {
      words: { select: { id: true, segmentId: true } },
      correctedWords: { select: { id: true, segmentId: true } },
    },
  });
  if (!annotation || annotation.recordingId !== recordingId) {
    throw new HttpError(404, "annotation-not-found", "That annotation is gone.");
  }

  const isCorrection = annotation.type === CORRECTION;
  const words = await loadSpan(tx, recordingId, op.wordIds);
  const occupied = new Set(
    words
      .filter((w) =>
        isCorrection
          ? w.correctionId && w.correctionId !== annotation.id
          : w.annotationId && w.annotationId !== annotation.id,
      )
      .map((w) => w.id),
  );
  const validation = validateSpan(words, occupied);
  if (!validation.ok) {
    throw new HttpError(
      409,
      `span-${validation.reason}`,
      spanMessage(validation.reason, isCorrection),
    );
  }

  const previousSegments = [
    ...new Set([
      ...annotation.words.map((w) => w.segmentId),
      ...annotation.correctedWords.map((w) => w.segmentId),
    ]),
  ];

  if (isCorrection) {
    await tx.word.updateMany({
      where: { correctionId: annotation.id },
      data: { correctionId: null },
    });
    await tx.word.updateMany({
      where: { id: { in: op.wordIds } },
      data: { correctionId: annotation.id },
    });
  } else {
    await tx.word.updateMany({
      where: { annotationId: annotation.id },
      data: { annotationId: null },
    });
    await tx.word.updateMany({
      where: { id: { in: op.wordIds } },
      data: { annotationId: annotation.id },
    });
  }
  await tx.annotation.update({
    where: { id: annotation.id },
    data: {
      surface: words.map((w) => w.text).join(" "),
      start: ms(words[0].start),
      end: ms(words[words.length - 1].end),
      status: "ACTIVE",
    },
  });

  return {
    scope: {
      segmentIds: [...new Set([...previousSegments, validation.segmentId!])],
      annotationIds: [annotation.id],
    },
    orphanedIds: [],
    removedSegmentIds: [],
    removedAnnotationIds: [],
  };
}

// ---------------------------------------------------------------------------
// batch application
// ---------------------------------------------------------------------------

async function applyOne(
  tx: Tx,
  recordingId: string,
  userId: string,
  op: Op,
): Promise<OpOutcome> {
  switch (op.kind) {
    case "segment.edit":
      return opSegmentEdit(tx, recordingId, op);
    case "segment.split":
      return opSegmentSplit(tx, recordingId, op);
    case "segment.merge":
      return opSegmentMerge(tx, recordingId, op);
    case "segment.timing":
      return opSegmentTiming(tx, recordingId, op);
    case "segment.review":
      return opSegmentReview(tx, recordingId, op);
    case "ann.create":
      return opAnnCreate(tx, recordingId, userId, op);
    case "ann.update":
      return opAnnUpdate(tx, recordingId, op);
    case "ann.delete":
      return opAnnDelete(tx, recordingId, op);
    case "ann.reattach":
      return opAnnReattach(tx, recordingId, op);
  }
}

async function recordRevision(
  tx: Tx,
  recordingId: string,
  userId: string,
  kind: string,
  before: Snapshot,
  after: Snapshot,
  scope: OpScope,
): Promise<void> {
  // A fresh action invalidates the redo stack.
  await tx.revision.deleteMany({ where: { recordingId, userId, undone: true } });

  await tx.revision.create({
    data: {
      recordingId,
      userId,
      kind,
      payload: { before, after, scope } as unknown as Prisma.InputJsonValue,
    },
  });

  const total = await tx.revision.count({ where: { recordingId, userId } });
  if (total > MAX_REVISIONS) {
    const stale = await tx.revision.findMany({
      where: { recordingId, userId },
      orderBy: { createdAt: "asc" },
      take: total - MAX_REVISIONS,
      select: { id: true },
    });
    await tx.revision.deleteMany({
      where: { id: { in: stale.map((r) => r.id) } },
    });
  }
}

async function collectResult(
  tx: Tx,
  recordingId: string,
  userId: string,
  segmentIds: Set<string>,
  annotationIds: Set<string>,
  removedSegmentIds: Set<string>,
  removedAnnotationIds: Set<string>,
  orphanedIds: Set<string>,
  tempIds: Record<string, string>,
): Promise<OpsResultDTO> {
  const segments = await tx.segment.findMany({
    where: { id: { in: [...segmentIds] }, recordingId },
    include: segmentInclude,
    orderBy: { index: "asc" },
  });
  const annotations = await tx.annotation.findMany({
    where: { id: { in: [...annotationIds] }, recordingId },
    include: annotationInclude,
  });

  const presentSegments = new Set(segments.map((s) => s.id));
  for (const id of segmentIds) {
    if (!presentSegments.has(id)) removedSegmentIds.add(id);
  }
  const presentAnnotations = new Set(annotations.map((a) => a.id));
  for (const id of annotationIds) {
    if (!presentAnnotations.has(id)) removedAnnotationIds.add(id);
  }

  const dtoAnnotations = annotations.map(toAnnotationDTO);

  const [undoable, redoable] = await Promise.all([
    tx.revision.count({ where: { recordingId, userId, undone: false } }),
    tx.revision.count({ where: { recordingId, userId, undone: true } }),
  ]);

  return {
    segments: segments.map(toSegmentDTO),
    removedSegmentIds: [...removedSegmentIds],
    annotations: dtoAnnotations,
    removedAnnotationIds: [...removedAnnotationIds],
    orphaned: dtoAnnotations.filter((a) => orphanedIds.has(a.id)),
    tempIds,
    canUndo: undoable > 0,
    canRedo: redoable > 0,
  };
}

export async function applyOps(
  recordingId: string,
  userId: string,
  ops: Op[],
): Promise<OpsResultDTO> {
  return prisma.$transaction(
    async (tx) => {
      const touchedSegments = new Set<string>();
      const touchedAnnotations = new Set<string>();
      const removedSegmentIds = new Set<string>();
      const removedAnnotationIds = new Set<string>();
      const orphaned = new Set<string>();
      const tempIds: Record<string, string> = {};

      for (const op of ops) {
        const preScope = await preScopeFor(tx, recordingId, op);
        const before = await takeSnapshot(
          tx,
          preScope.segmentIds,
          preScope.annotationIds,
        );

        const outcome = await applyOne(tx, recordingId, userId, op);

        const scope: OpScope = {
          segmentIds: [
            ...new Set([...preScope.segmentIds, ...outcome.scope.segmentIds]),
          ],
          annotationIds: [
            ...new Set([
              ...preScope.annotationIds,
              ...outcome.scope.annotationIds,
            ]),
          ],
        };
        const after = await takeSnapshot(tx, scope.segmentIds, scope.annotationIds);

        await recordRevision(tx, recordingId, userId, op.kind, before, after, scope);

        scope.segmentIds.forEach((id) => touchedSegments.add(id));
        scope.annotationIds.forEach((id) => touchedAnnotations.add(id));
        outcome.removedSegmentIds.forEach((id) => removedSegmentIds.add(id));
        outcome.removedAnnotationIds.forEach((id) => removedAnnotationIds.add(id));
        outcome.orphanedIds.forEach((id) => orphaned.add(id));
        if (outcome.tempId && outcome.createdAnnotationId) {
          tempIds[outcome.tempId] = outcome.createdAnnotationId;
        }
      }

      return collectResult(
        tx,
        recordingId,
        userId,
        touchedSegments,
        touchedAnnotations,
        removedSegmentIds,
        removedAnnotationIds,
        orphaned,
        tempIds,
      );
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** What an operation will touch, computed before it runs. */
async function preScopeFor(tx: Tx, recordingId: string, op: Op): Promise<OpScope> {
  switch (op.kind) {
    case "segment.edit":
    case "segment.split":
    case "segment.review": {
      const annotationIds = await annotationIdsForSegments(tx, [op.segmentId]);
      return { segmentIds: [op.segmentId], annotationIds };
    }
    case "segment.merge": {
      const segment = await tx.segment.findUnique({
        where: { id: op.segmentId },
        select: { index: true },
      });
      const previous = segment
        ? await tx.segment.findFirst({
            where: { recordingId, index: { lt: segment.index } },
            orderBy: { index: "desc" },
            select: { id: true },
          })
        : null;
      const segmentIds = previous ? [previous.id, op.segmentId] : [op.segmentId];
      return {
        segmentIds,
        annotationIds: await annotationIdsForSegments(tx, segmentIds),
      };
    }
    case "segment.timing": {
      const segment = await tx.segment.findUnique({
        where: { id: op.segmentId },
        select: { index: true },
      });
      if (!segment) return { segmentIds: [op.segmentId], annotationIds: [] };
      const neighbours = await tx.segment.findMany({
        where: {
          recordingId,
          index: { in: [segment.index - 1, segment.index + 1] },
        },
        select: { id: true },
      });
      return {
        segmentIds: [op.segmentId, ...neighbours.map((s) => s.id)],
        annotationIds: [],
      };
    }
    case "ann.create": {
      const words = await tx.word.findMany({
        where: { id: { in: op.wordIds } },
        select: { segmentId: true },
      });
      const segmentIds = [...new Set(words.map((w) => w.segmentId))];
      return {
        segmentIds,
        annotationIds: await annotationIdsForSegments(tx, segmentIds),
      };
    }
    case "ann.update":
    case "ann.delete":
    case "ann.reattach": {
      const annotation = await tx.annotation.findUnique({
        where: { id: op.annotationId },
        include: {
          words: { select: { segmentId: true } },
          correctedWords: { select: { segmentId: true } },
        },
      });
      const segmentIds = new Set([
        ...(annotation?.words.map((w) => w.segmentId) ?? []),
        ...(annotation?.correctedWords.map((w) => w.segmentId) ?? []),
      ]);
      if (op.kind === "ann.reattach") {
        const words = await tx.word.findMany({
          where: { id: { in: op.wordIds } },
          select: { segmentId: true },
        });
        words.forEach((w) => segmentIds.add(w.segmentId));
      }
      const ids = [...segmentIds];
      const annotationIds = new Set(await annotationIdsForSegments(tx, ids));
      annotationIds.add(op.annotationId);
      return { segmentIds: ids, annotationIds: [...annotationIds] };
    }
  }
}

// ---------------------------------------------------------------------------
// undo / redo
// ---------------------------------------------------------------------------

interface RevisionPayload {
  before: Snapshot;
  after: Snapshot;
  scope: OpScope;
}

export async function undo(
  recordingId: string,
  userId: string,
): Promise<OpsResultDTO | null> {
  return moveHistory(recordingId, userId, "undo");
}

export async function redo(
  recordingId: string,
  userId: string,
): Promise<OpsResultDTO | null> {
  return moveHistory(recordingId, userId, "redo");
}

async function moveHistory(
  recordingId: string,
  userId: string,
  direction: "undo" | "redo",
): Promise<OpsResultDTO | null> {
  return prisma.$transaction(
    async (tx) => {
      const revision = await tx.revision.findFirst({
        where: { recordingId, userId, undone: direction === "redo" },
        orderBy: { createdAt: direction === "undo" ? "desc" : "asc" },
      });
      if (!revision) return null;

      const payload = revision.payload as unknown as RevisionPayload;
      const target = direction === "undo" ? payload.before : payload.after;

      await restoreSnapshot(tx, recordingId, target, payload.scope);
      await repack(tx, recordingId);

      await tx.revision.update({
        where: { id: revision.id },
        data: { undone: direction === "undo" },
      });

      return collectResult(
        tx,
        recordingId,
        userId,
        new Set(payload.scope.segmentIds),
        new Set(payload.scope.annotationIds),
        new Set(),
        new Set(),
        new Set(),
        {},
      );
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
