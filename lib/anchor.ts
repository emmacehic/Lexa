import { ms } from "./realign";

/**
 * Annotation anchoring and survival (§9.4).
 *
 * Annotations are anchored to Word ids. An edit elsewhere in the segment
 * cannot move them; an edit that removes some of their words shrinks them to
 * the survivors; an edit that removes all of their words never deletes them —
 * it flags them for review. Silent loss is not an option in a corpus.
 */

export type AnnStatus = "ACTIVE" | "NEEDS_REVIEW";

export interface AnnotationLike {
  id: string;
  type: string;
  surface: string;
  start: number;
  end: number;
  status: AnnStatus;
  /** ids of the words the annotation currently covers, in transcript order */
  wordIds: string[];
}

export interface WordSnapshot {
  id: string;
  text: string;
  start: number;
  end: number;
  segmentId: string;
  index: number;
}

export type ReanchorOutcome =
  | { kind: "unchanged"; annotationId: string }
  | {
      kind: "shrunk";
      annotationId: string;
      surface: string;
      start: number;
      end: number;
      wordIds: string[];
      droppedWordIds: string[];
    }
  | {
      kind: "orphaned";
      annotationId: string;
      status: "NEEDS_REVIEW";
      /** kept so the review tray can show what was lost */
      originalSurface: string;
      droppedWordIds: string[];
    };

/**
 * @param annotation the annotation as it stands
 * @param survivors  every word that still exists after the edit, by id
 */
export function reanchorAnnotation(
  annotation: AnnotationLike,
  survivors: Map<string, WordSnapshot>,
): ReanchorOutcome {
  const kept: WordSnapshot[] = [];
  const dropped: string[] = [];

  for (const id of annotation.wordIds) {
    const w = survivors.get(id);
    if (w) kept.push(w);
    else dropped.push(id);
  }

  if (dropped.length === 0) {
    // The words are all still there, but their surface or timing may have
    // changed under a 1:1 replacement — keep the annotation in sync.
    const surface = kept.map((w) => w.text).join(" ");
    const start = kept.length > 0 ? ms(kept[0].start) : annotation.start;
    const end = kept.length > 0 ? ms(kept[kept.length - 1].end) : annotation.end;
    if (
      surface === annotation.surface &&
      start === ms(annotation.start) &&
      end === ms(annotation.end)
    ) {
      return { kind: "unchanged", annotationId: annotation.id };
    }
    return {
      kind: "shrunk",
      annotationId: annotation.id,
      surface,
      start,
      end,
      wordIds: kept.map((w) => w.id),
      droppedWordIds: [],
    };
  }

  if (kept.length === 0) {
    return {
      kind: "orphaned",
      annotationId: annotation.id,
      status: "NEEDS_REVIEW",
      originalSurface: annotation.surface,
      droppedWordIds: dropped,
    };
  }

  kept.sort((a, b) => (a.segmentId === b.segmentId ? a.index - b.index : 0));

  for (let i = 1; i < kept.length; i++) {
    if (
      kept[i].segmentId === kept[i - 1].segmentId &&
      kept[i].index !== kept[i - 1].index + 1
    ) {
      return {
        kind: "orphaned",
        annotationId: annotation.id,
        status: "NEEDS_REVIEW",
        originalSurface: annotation.surface,
        droppedWordIds: [...dropped, ...kept.map((w) => w.id)],
      };
    }
  }

  return {
    kind: "shrunk",
    annotationId: annotation.id,
    surface: kept.map((w) => w.text).join(" "),
    start: ms(kept[0].start),
    end: ms(kept[kept.length - 1].end),
    wordIds: kept.map((w) => w.id),
    droppedWordIds: dropped,
  };
}

export function reanchorAll(
  annotations: AnnotationLike[],
  survivors: Map<string, WordSnapshot>,
): ReanchorOutcome[] {
  return annotations.map((a) => reanchorAnnotation(a, survivors));
}

/**
 * A span is valid if it is non-empty, contiguous, inside one segment and every
 * word is currently unannotated (§9.1, §1.5 — one annotation per word).
 */
export interface SpanValidation {
  ok: boolean;
  reason?: "empty" | "crosses-segment" | "not-contiguous" | "already-annotated";
  segmentId?: string;
}

export function validateSpan(
  words: WordSnapshot[],
  annotatedWordIds: Set<string>,
  options: { allowAnnotationIds?: Set<string> } = {},
): SpanValidation {
  if (words.length === 0) return { ok: false, reason: "empty" };

  const segmentId = words[0].segmentId;
  if (words.some((w) => w.segmentId !== segmentId)) {
    return { ok: false, reason: "crosses-segment" };
  }

  const sorted = [...words].sort((a, b) => a.index - b.index);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].index !== sorted[i - 1].index + 1) {
      return { ok: false, reason: "not-contiguous", segmentId };
    }
  }

  const allow = options.allowAnnotationIds ?? new Set<string>();
  if (
    sorted.some((w) => annotatedWordIds.has(w.id) && !allow.has(w.id))
  ) {
    return { ok: false, reason: "already-annotated", segmentId };
  }

  return { ok: true, segmentId };
}
