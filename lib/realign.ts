import { myersDiff } from "./diff";
import { normalizeToken, splitTokens } from "./tokenize";

/**
 * Re-alignment of word timings after a segment's text is edited (§8.3).
 *
 * The contract, in one line: a word the user did not touch keeps its measured
 * timing, its confidence and its annotation, whatever happened around it.
 */

export type TimingSource = "MEASURED" | "INTERPOLATED";

export interface WordLike {
  id: string;
  text: string;
  start: number;
  end: number;
  confidence: number | null;
  timing: TimingSource;
  annotationId: string | null;
  correctionId: string | null;
}

export type RealignKind = "kept" | "replaced" | "inserted";

export interface RealignedWord {
  /** id of the surviving word, or null for a word that did not exist before */
  id: string | null;
  index: number;
  text: string;
  start: number;
  end: number;
  confidence: number | null;
  timing: TimingSource;
  annotationId: string | null;
  correctionId: string | null;
  kind: RealignKind;
}

export interface RealignResult {
  words: RealignedWord[];
  /** ids of words that no longer exist — §9.4 decides what happens to their annotations */
  deletedWordIds: string[];
  text: string;
}

interface Slot {
  newIndex: number;
  oldIndex: number | null; // null = inserted
  replaced: boolean;
}

/**
 * Round to milliseconds. Timings are stored to 3 decimals (§5) and comparing
 * them across a re-alignment must not accumulate float dust.
 */
export function ms(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function realignSegment(
  oldWords: WordLike[],
  newText: string,
  segmentStart: number,
  segmentEnd: number,
): RealignResult {
  const newSurfaces = splitTokens(newText);
  const oldNorm = oldWords.map((w) => normalizeToken(w.text));
  const newNorm = newSurfaces.map((t) => normalizeToken(t));

  const ops = myersDiff(oldNorm, newNorm);

  // --- pair adjacent deletions and insertions into 1:1 replacements -------
  const slots: Slot[] = [];
  const usedOld = new Set<number>();
  let pendingDeletes: number[] = [];
  let pendingInserts: number[] = [];

  const flush = () => {
    const pairs = Math.min(pendingDeletes.length, pendingInserts.length);
    for (let i = 0; i < pairs; i++) {
      slots.push({
        newIndex: pendingInserts[i],
        oldIndex: pendingDeletes[i],
        replaced: true,
      });
      usedOld.add(pendingDeletes[i]);
    }
    for (let i = pairs; i < pendingInserts.length; i++) {
      slots.push({ newIndex: pendingInserts[i], oldIndex: null, replaced: false });
    }
    pendingDeletes = [];
    pendingInserts = [];
  };

  for (const op of ops) {
    if (op.kind === "equal") {
      flush();
      slots.push({ newIndex: op.newIndex, oldIndex: op.oldIndex, replaced: false });
      usedOld.add(op.oldIndex);
    } else if (op.kind === "delete") {
      pendingDeletes.push(op.oldIndex);
    } else {
      pendingInserts.push(op.newIndex);
    }
  }
  flush();

  slots.sort((a, b) => a.newIndex - b.newIndex);

  const deletedWordIds = oldWords
    .map((w, i) => (usedOld.has(i) ? null : w.id))
    .filter((id): id is string => id !== null);

  // --- build the new word list, anchors first -----------------------------
  const words: RealignedWord[] = slots.map((slot, i) => {
    const surface = newSurfaces[slot.newIndex];
    if (slot.oldIndex === null) {
      return {
        id: null,
        index: i,
        text: surface,
        start: 0,
        end: 0,
        confidence: null,
        timing: "INTERPOLATED" as TimingSource,
        annotationId: null,
        correctionId: null,
        kind: "inserted" as RealignKind,
      };
    }
    const src = oldWords[slot.oldIndex];
    return {
      id: src.id,
      index: i,
      text: surface,
      start: src.start,
      end: src.end,
      confidence: src.confidence,
      timing: src.timing,
      annotationId: src.annotationId,
      correctionId: src.correctionId,
      kind: slot.replaced ? ("replaced" as RealignKind) : ("kept" as RealignKind),
    };
  });

  // --- distribute timings across inserted runs (§8.3.5) -------------------
  let i = 0;
  while (i < words.length) {
    if (words[i].kind !== "inserted") {
      i++;
      continue;
    }
    let j = i;
    while (j < words.length && words[j].kind === "inserted") j++;

    const before = i > 0 ? words[i - 1] : null;
    const after = j < words.length ? words[j] : null;

    // Borrow from the segment edge at a boundary — never from a neighbour
    // segment (§8.3.5).
    const lower = before ? before.end : segmentStart;
    const upper = after ? after.start : segmentEnd;
    const span = Math.max(0, upper - lower);

    const run = words.slice(i, j);
    const weights = run.map((w) => w.text.length + 1);
    const total = weights.reduce((a, b) => a + b, 0);

    let cursor = lower;
    for (let k = 0; k < run.length; k++) {
      const share = total > 0 ? (span * weights[k]) / total : 0;
      const start = ms(cursor);
      const end = ms(Math.min(upper, cursor + share));
      run[k].start = start;
      run[k].end = Math.max(start, end);
      cursor = run[k].end;
    }

    // Annotation contiguity: a word inserted strictly inside an annotated span
    // joins that annotation, so the span stays one continuous shape (§9.3).
    if (
      before &&
      after &&
      before.annotationId &&
      before.annotationId === after.annotationId
    ) {
      for (const w of run) w.annotationId = before.annotationId;
    }
    if (
      before &&
      after &&
      before.correctionId &&
      before.correctionId === after.correctionId
    ) {
      for (const w of run) w.correctionId = before.correctionId;
    }

    i = j;
  }

  for (const w of words) {
    w.start = ms(w.start);
    w.end = ms(Math.max(w.start, w.end));
  }

  return {
    words,
    deletedWordIds,
    text: words.map((w) => w.text).join(" "),
  };
}
