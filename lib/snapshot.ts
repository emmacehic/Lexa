import type { Prisma } from "@prisma/client";

/**
 * Snapshots for the revision log (§5).
 *
 * Every operation records the exact state of the segments and annotations it
 * touched, before and after. Undo restores `before`, redo restores `after`.
 * A snapshot is deliberately a full copy rather than a minimal patch: it is
 * the audit trail as well as the undo stack, and a corpus needs to be able to
 * say what a segment looked like at a point in time.
 */

export interface WordSnap {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  confidence: number | null;
  timing: "MEASURED" | "INTERPOLATED";
  annotationId: string | null;
  correctionId: string | null;
}

export interface SegmentSnap {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  speakerTag: string | null;
  isReviewed: boolean;
  words: WordSnap[];
}

export interface AnnotationSnap {
  id: string;
  type: string;
  surface: string;
  start: number;
  end: number;
  languageTag: string | null;
  nativeAlternative: string | null;
  pronunciation: string | null;
  confidence: string | null;
  note: string | null;
  status: "ACTIVE" | "NEEDS_REVIEW";
  createdById: string;
}

export interface Snapshot {
  segments: SegmentSnap[];
  annotations: AnnotationSnap[];
}

export type Tx = Prisma.TransactionClient;

export async function snapshotSegments(
  tx: Tx,
  segmentIds: string[],
): Promise<SegmentSnap[]> {
  if (segmentIds.length === 0) return [];
  const rows = await tx.segment.findMany({
    where: { id: { in: segmentIds } },
    include: { words: { orderBy: { index: "asc" } } },
    orderBy: { index: "asc" },
  });
  return rows.map((s) => ({
    id: s.id,
    index: s.index,
    start: s.start,
    end: s.end,
    text: s.text,
    speakerTag: s.speakerTag,
    isReviewed: s.isReviewed,
    words: s.words.map((w) => ({
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
  }));
}

export async function snapshotAnnotations(
  tx: Tx,
  annotationIds: string[],
): Promise<AnnotationSnap[]> {
  if (annotationIds.length === 0) return [];
  const rows = await tx.annotation.findMany({
    where: { id: { in: annotationIds } },
  });
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    surface: a.surface,
    start: a.start,
    end: a.end,
    languageTag: a.languageTag,
    nativeAlternative: a.nativeAlternative,
    pronunciation: a.pronunciation,
    confidence: a.confidence,
    note: a.note,
    status: a.status,
    createdById: a.createdById,
  }));
}

export async function takeSnapshot(
  tx: Tx,
  segmentIds: string[],
  annotationIds: string[],
): Promise<Snapshot> {
  return {
    segments: await snapshotSegments(tx, segmentIds),
    annotations: await snapshotAnnotations(tx, annotationIds),
  };
}

/**
 * Restore a snapshot. Segments listed in `segmentIds` that are absent from the
 * snapshot are removed — that is how an undone split loses its second half.
 */
export async function restoreSnapshot(
  tx: Tx,
  recordingId: string,
  snapshot: Snapshot,
  scope: { segmentIds: string[]; annotationIds: string[] },
): Promise<void> {
  const keepSegments = new Set(snapshot.segments.map((s) => s.id));
  const keepAnnotations = new Set(snapshot.annotations.map((a) => a.id));

  // 1. Detach words from annotations that are about to change, so deletes and
  //    unique-index moves cannot trip over a foreign key.
  await tx.word.updateMany({
    where: { segmentId: { in: scope.segmentIds } },
    data: { annotationId: null, correctionId: null },
  });

  // 2. Remove segments that should not exist any more.
  const doomedSegments = scope.segmentIds.filter((id) => !keepSegments.has(id));
  if (doomedSegments.length > 0) {
    await tx.segment.deleteMany({ where: { id: { in: doomedSegments } } });
  }

  // 3. Park surviving segments out of the way of the unique (recordingId,index).
  const survivors = scope.segmentIds.filter((id) => keepSegments.has(id));
  for (const [i, id] of survivors.entries()) {
    await tx.segment.update({
      where: { id },
      data: { index: -1000 - i },
    });
  }

  // 4. Restore annotations before words point at them again.
  const doomedAnnotations = scope.annotationIds.filter(
    (id) => !keepAnnotations.has(id),
  );
  if (doomedAnnotations.length > 0) {
    await tx.annotation.deleteMany({ where: { id: { in: doomedAnnotations } } });
  }
  for (const a of snapshot.annotations) {
    await tx.annotation.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        recordingId,
        type: a.type,
        surface: a.surface,
        start: a.start,
        end: a.end,
        languageTag: a.languageTag,
        nativeAlternative: a.nativeAlternative,
        pronunciation: a.pronunciation,
        confidence: a.confidence,
        note: a.note,
        status: a.status,
        createdById: a.createdById,
      },
      update: {
        type: a.type,
        surface: a.surface,
        start: a.start,
        end: a.end,
        languageTag: a.languageTag,
        nativeAlternative: a.nativeAlternative,
        pronunciation: a.pronunciation,
        confidence: a.confidence,
        note: a.note,
        status: a.status,
      },
    });
  }

  // 5. Restore segments and their words verbatim.
  for (const s of snapshot.segments) {
    await tx.word.deleteMany({ where: { segmentId: s.id } });
    await tx.segment.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        recordingId,
        index: s.index,
        start: s.start,
        end: s.end,
        text: s.text,
        speakerTag: s.speakerTag,
        isReviewed: s.isReviewed,
      },
      update: {
        index: s.index,
        start: s.start,
        end: s.end,
        text: s.text,
        speakerTag: s.speakerTag,
        isReviewed: s.isReviewed,
      },
    });
    if (s.words.length > 0) {
      await tx.word.createMany({
        data: s.words.map((w) => ({
          id: w.id,
          segmentId: s.id,
          index: w.index,
          text: w.text,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
          timing: w.timing,
          annotationId: w.annotationId,
          correctionId: w.correctionId ?? null,
        })),
      });
    }
  }
}

/** Contiguous 0-based indices, always (§5). */
export async function repackSegmentIndices(
  tx: Tx,
  recordingId: string,
): Promise<void> {
  const segments = await tx.segment.findMany({
    where: { recordingId },
    orderBy: [{ start: "asc" }, { index: "asc" }],
    select: { id: true, index: true },
  });

  // Park everything negative first so the unique index never collides.
  for (const [i, s] of segments.entries()) {
    await tx.segment.update({ where: { id: s.id }, data: { index: -1 - i } });
  }
  for (const [i, s] of segments.entries()) {
    await tx.segment.update({ where: { id: s.id }, data: { index: i } });
  }
}
