import { describe, expect, it } from "vitest";

import {
  largestGapInLastThird,
  MAX_SEGMENT_CHARS,
  MAX_SEGMENT_SECONDS,
  mergeShortRuns,
  segmentWords,
  type SegWord,
} from "../../lib/segmenter";

/** §6.5 — the rules that decide where a transcript breaks. */

function words(
  spec: [text: string, start: number, end: number][],
): SegWord[] {
  return spec.map(([text, start, end]) => ({
    text,
    start,
    end,
    confidence: 0.9,
    timing: "MEASURED" as const,
  }));
}

describe("segmentWords", () => {
  it("cuts after sentence-final punctuation", () => {
    const segments = segmentWords(
      words([
        ["Das", 0, 0.4],
        ["war", 0.4, 0.8],
        ["gut.", 0.8, 1.4],
        ["Und", 1.45, 1.8],
        ["dann", 1.8, 2.2],
        ["weiter", 2.2, 2.9],
      ]),
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("Das war gut.");
    expect(segments[1].text).toBe("Und dann weiter");
    expect(segments[0].end).toBe(1.4);
    expect(segments[1].start).toBe(1.45);
  });

  it("cuts on a silence of 0.55 s or more, but not on 0.54 s", () => {
    const wide = segmentWords(
      words([
        ["eins", 0, 1.5],
        ["zwei", 2.05, 3.5],
        ["drei", 3.5, 4.5],
      ]),
    );
    expect(wide).toHaveLength(2);

    const narrow = segmentWords(
      words([
        ["eins", 0, 1.5],
        ["zwei", 2.04, 3.5],
        ["drei", 3.5, 4.5],
      ]),
    );
    expect(narrow).toHaveLength(1);
  });

  it("re-packs indices contiguously from zero", () => {
    const segments = segmentWords(
      words([
        ["a.", 0, 1.3],
        ["b.", 1.35, 2.7],
        ["c.", 2.75, 4.1],
      ]),
    );
    expect(segments.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("splits a run that would exceed the duration limit at the largest gap in its last third", () => {
    const spec: [string, number, number][] = [];
    for (let i = 0; i < 30; i++) {
      // ~0.4 s per word, no sentence punctuation, no long silences
      spec.push([`w${i}`, i * 0.4, i * 0.4 + 0.35]);
    }
    const segments = segmentWords(words(spec));
    expect(segments.length).toBeGreaterThan(1);
    for (const s of segments) {
      expect(s.end - s.start).toBeLessThanOrEqual(MAX_SEGMENT_SECONDS + 0.5);
    }
  });

  it("keeps segments within the character limit", () => {
    const spec: [string, number, number][] = [];
    for (let i = 0; i < 40; i++) {
      spec.push([`token${i}`, i * 0.15, i * 0.15 + 0.12]);
    }
    const segments = segmentWords(words(spec));
    for (const s of segments) {
      expect(s.text.length).toBeLessThanOrEqual(MAX_SEGMENT_CHARS);
    }
  });

  it("merges a too-short run into the neighbour with the smaller gap", () => {
    // "ja." is 0.3 s long; the gap before it is 0.6 s, after it 1.4 s
    const segments = segmentWords(
      words([
        ["Also", 0, 0.5],
        ["gut.", 0.5, 1.4],
        ["Ja.", 2.0, 2.3],
        ["Weiter", 3.7, 4.4],
        ["geht", 4.4, 4.9],
        ["es.", 4.9, 5.6],
      ]),
    );
    expect(segments).toHaveLength(2);
    expect(segments[0].text).toBe("Also gut. Ja.");
    expect(segments[1].text).toBe("Weiter geht es.");
  });

  it("derives start, end and text from the words", () => {
    const segments = segmentWords(
      words([
        ["Hallo", 1.234, 1.678],
        ["Welt", 1.678, 2.456],
      ]),
    );
    expect(segments[0].start).toBe(1.234);
    expect(segments[0].end).toBe(2.456);
    expect(segments[0].text).toBe("Hallo Welt");
  });

  it("returns nothing for an empty transcript", () => {
    expect(segmentWords([])).toEqual([]);
  });
});

describe("largestGapInLastThird", () => {
  it("picks the widest silence in the final third", () => {
    const run = words([
      ["a", 0, 0.5],
      ["b", 1.4, 1.9], // big gap, but in the first third
      ["c", 1.9, 2.4],
      ["d", 2.4, 2.9],
      ["e", 3.3, 3.8], // gap in the last third
      ["f", 3.8, 4.3],
    ]);
    expect(largestGapInLastThird(run)).toBe(4);
  });

  it("returns 0 when there is nothing to cut", () => {
    expect(largestGapInLastThird(words([["a", 0, 1]]))).toBe(0);
  });
});

describe("mergeShortRuns", () => {
  it("leaves a single run alone even when it is short", () => {
    const runs = mergeShortRuns([words([["a", 0, 0.2]])]);
    expect(runs).toHaveLength(1);
  });
});
