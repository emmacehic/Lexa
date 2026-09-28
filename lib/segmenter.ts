import { endsSentence } from "./tokenize";
import { ms } from "./realign";

/**
 * Segmentation (§6.5). The thresholds are the specification's, named so a
 * reader can check them against it.
 */
export const SILENCE_GAP = 0.55; // seconds
export const MAX_SEGMENT_SECONDS = 9.0;
export const MAX_SEGMENT_CHARS = 90;
export const MIN_SEGMENT_SECONDS = 1.2;

export interface SegWord {
  text: string;
  start: number;
  end: number;
  confidence: number | null;
  timing: "MEASURED" | "INTERPOLATED";
  speakerTag?: string | null;
}

export interface BuiltSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  speakerTag: string | null;
  words: SegWord[];
}

/**
 * Thresholds are compared in whole milliseconds. Comparing raw floats would
 * make 2.05 - 1.50 come out as 0.5499999999999998 and quietly fail to cut a
 * segment on an exactly 0.55 s silence.
 */
function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

function gapMs(prev: SegWord, next: SegWord): number {
  return toMs(next.start) - toMs(prev.end);
}

function charLength(words: SegWord[]): number {
  if (words.length === 0) return 0;
  return words.reduce((acc, w) => acc + w.text.length, 0) + (words.length - 1);
}

/**
 * Index of the word that should begin the next segment, chosen as the largest
 * silence in the final third of the run. Returns 0 when there is no usable cut.
 */
export function largestGapInLastThird(words: SegWord[]): number {
  if (words.length < 2) return 0;
  const from = Math.max(1, Math.floor((words.length * 2) / 3));
  let bestIndex = 0;
  let bestGap = -Infinity;
  for (let i = from; i < words.length; i++) {
    const gap = gapMs(words[i - 1], words[i]);
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  return bestIndex;
}

export function segmentWords(words: SegWord[]): BuiltSegment[] {
  const runs: SegWord[][] = [];
  let current: SegWord[] = [];

  const close = () => {
    if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  };

  for (const word of words) {
    if (current.length > 0) {
      const prev = current[current.length - 1];
      if (endsSentence(prev.text) || gapMs(prev, word) >= toMs(SILENCE_GAP)) {
        close();
      }
    }

    if (current.length > 0) {
      const duration = toMs(word.end) - toMs(current[0].start);
      const chars = charLength(current) + 1 + word.text.length;
      if (duration > toMs(MAX_SEGMENT_SECONDS) || chars > MAX_SEGMENT_CHARS) {
        const cut = largestGapInLastThird(current);
        if (cut > 0) {
          runs.push(current.slice(0, cut));
          current = current.slice(cut);
        } else {
          close();
        }
      }
    }

    current.push(word);
  }
  close();

  const merged = mergeShortRuns(runs);
  return merged.map((run, index) => buildSegment(run, index));
}

/**
 * Merge any run shorter than 1.2 s into the neighbour separated by the smaller
 * silence. Repeats until nothing is short enough to merge, or only one run is
 * left.
 */
export function mergeShortRuns(input: SegWord[][]): SegWord[][] {
  const runs = input.map((r) => r.slice());

  let changed = true;
  while (changed && runs.length > 1) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const duration = toMs(run[run.length - 1].end) - toMs(run[0].start);
      if (duration >= toMs(MIN_SEGMENT_SECONDS)) continue;

      const prev = i > 0 ? runs[i - 1] : null;
      const next = i < runs.length - 1 ? runs[i + 1] : null;
      if (!prev && !next) break;

      const gapPrev = prev ? gapMs(prev[prev.length - 1], run[0]) : Infinity;
      const gapNext = next ? gapMs(run[run.length - 1], next[0]) : Infinity;

      // Merging must not re-create a segment that breaks the limits the cut
      // rules just enforced — see DECISIONS.md.
      const canMergePrev = prev !== null && fits(prev, run);
      const canMergeNext = next !== null && fits(run, next);

      let target: "prev" | "next" | null = null;
      if (canMergePrev && canMergeNext) target = gapPrev <= gapNext ? "prev" : "next";
      else if (canMergePrev) target = "prev";
      else if (canMergeNext) target = "next";

      if (target === "prev" && prev) {
        prev.push(...run);
        runs.splice(i, 1);
      } else if (target === "next" && next) {
        next.unshift(...run);
        runs.splice(i, 1);
      } else {
        continue;
      }
      changed = true;
      break;
    }
  }

  return runs;
}

/** Would these two runs, joined, still respect the §6.5 limits? */
function fits(left: SegWord[], right: SegWord[]): boolean {
  const duration = toMs(right[right.length - 1].end) - toMs(left[0].start);
  const chars = charLength(left) + 1 + charLength(right);
  return duration <= toMs(MAX_SEGMENT_SECONDS) && chars <= MAX_SEGMENT_CHARS;
}

export function buildSegment(words: SegWord[], index: number): BuiltSegment {
  return {
    index,
    start: ms(words[0].start),
    end: ms(words[words.length - 1].end),
    text: words.map((w) => w.text).join(" "),
    speakerTag: words[0].speakerTag ?? null,
    words: words.map((w) => ({ ...w, start: ms(w.start), end: ms(w.end) })),
  };
}
