import { describe, expect, it } from "vitest";

import { realignSegment, type WordLike } from "../../lib/realign";

/**
 * §8.3 — the re-alignment that decides whether the corpus keeps its measured
 * timings. Every case here is a way a transcript could quietly lose evidence.
 */

function w(
  id: string,
  text: string,
  start: number,
  end: number,
  extra: Partial<WordLike> = {},
): WordLike {
  return {
    id,
    text,
    start,
    end,
    confidence: 0.9,
    timing: "MEASURED",
    annotationId: null,
    correctionId: null,
    ...extra,
  };
}

const base: WordLike[] = [
  w("w0", "Ich", 12.4, 12.56),
  w("w1", "war", 12.56, 12.78),
  w("w2", "gestern", 12.78, 13.22),
  w("w3", "at", 13.22, 13.35),
  w("w4", "the", 13.35, 13.48),
  w("w5", "university", 13.48, 14.01),
];

describe("realignSegment", () => {
  it("leaves an untouched segment completely alone", () => {
    const result = realignSegment(
      base,
      "Ich war gestern at the university",
      12.4,
      14.01,
    );
    expect(result.deletedWordIds).toEqual([]);
    expect(result.words.map((x) => x.id)).toEqual([
      "w0",
      "w1",
      "w2",
      "w3",
      "w4",
      "w5",
    ]);
    expect(result.words.every((x) => x.timing === "MEASURED")).toBe(true);
    expect(result.words[3].start).toBe(13.22);
  });

  it("keeps timings when only casing or punctuation changes", () => {
    const result = realignSegment(
      base,
      "Ich war gestern at the University.",
      12.4,
      14.01,
    );
    expect(result.deletedWordIds).toEqual([]);
    const last = result.words[5];
    expect(last.id).toBe("w5");
    expect(last.text).toBe("University.");
    expect(last.start).toBe(13.48);
    expect(last.end).toBe(14.01);
    expect(last.timing).toBe("MEASURED");
  });

  it("keeps the annotation on a 1:1 replacement", () => {
    const annotated = base.map((x) =>
      ["w3", "w4", "w5"].includes(x.id) ? { ...x, annotationId: "a1" } : x,
    );
    const result = realignSegment(
      annotated,
      "Ich war gestern at the universities",
      12.4,
      14.01,
    );
    const replaced = result.words[5];
    expect(replaced.id).toBe("w5");
    expect(replaced.kind).toBe("replaced");
    expect(replaced.annotationId).toBe("a1");
    expect(replaced.start).toBe(13.48);
  });

  it("interpolates inserted words across the surrounding gap, proportional to length", () => {
    const words: WordLike[] = [w("a", "eins", 0, 1), w("b", "zwei", 3, 4)];
    const result = realignSegment(words, "eins xx yyyy zwei", 0, 4);

    const inserted = result.words.filter((x) => x.kind === "inserted");
    expect(inserted).toHaveLength(2);
    expect(inserted.every((x) => x.timing === "INTERPOLATED")).toBe(true);
    expect(inserted.every((x) => x.confidence === null)).toBe(true);

    // the gap runs 1s -> 3s; weights 3 and 5 over a total of 8
    expect(inserted[0].start).toBe(1);
    expect(inserted[0].end).toBeCloseTo(1.75, 3);
    expect(inserted[1].start).toBeCloseTo(1.75, 3);
    expect(inserted[1].end).toBeCloseTo(3, 3);

    // the anchors did not move
    expect(result.words[0].start).toBe(0);
    expect(result.words[0].end).toBe(1);
    expect(result.words[3].start).toBe(3);
  });

  it("borrows from the segment edge when a word is inserted at the start", () => {
    const words: WordLike[] = [w("a", "zwei", 3, 4)];
    const result = realignSegment(words, "eins zwei", 2.5, 4);
    const inserted = result.words[0];
    expect(inserted.kind).toBe("inserted");
    expect(inserted.start).toBe(2.5);
    expect(inserted.end).toBe(3);
    expect(result.words[1].start).toBe(3);
  });

  it("borrows from the segment edge when a word is appended", () => {
    const words: WordLike[] = [w("a", "eins", 0, 1)];
    const result = realignSegment(words, "eins zwei", 0, 2.4);
    const inserted = result.words[1];
    expect(inserted.kind).toBe("inserted");
    expect(inserted.start).toBe(1);
    expect(inserted.end).toBe(2.4);
  });

  it("never produces a negative or inverted duration when there is no gap", () => {
    const words: WordLike[] = [w("a", "eins", 0, 1), w("b", "zwei", 1, 2)];
    const result = realignSegment(words, "eins neu zwei", 0, 2);
    const inserted = result.words[1];
    expect(inserted.start).toBe(1);
    expect(inserted.end).toBe(1);
    expect(inserted.end).toBeGreaterThanOrEqual(inserted.start);
  });

  it("reports deleted words and keeps the survivors' timings", () => {
    const result = realignSegment(base, "Ich war at the university", 12.4, 14.01);
    expect(result.deletedWordIds).toEqual(["w2"]);
    const survivors = result.words.map((x) => x.id);
    expect(survivors).toEqual(["w0", "w1", "w3", "w4", "w5"]);
    expect(result.words[2].start).toBe(13.22);
  });

  it("keeps a word inserted inside an annotated span attached to it", () => {
    const annotated = base.map((x) =>
      ["w3", "w4", "w5"].includes(x.id) ? { ...x, annotationId: "a1" } : x,
    );
    const result = realignSegment(
      annotated,
      "Ich war gestern at the big university",
      12.4,
      14.01,
    );
    const big = result.words.find((x) => x.text === "big");
    expect(big?.kind).toBe("inserted");
    expect(big?.annotationId).toBe("a1");
  });

  it("does not attach an inserted word outside an annotated span", () => {
    const annotated = base.map((x) =>
      ["w3", "w4", "w5"].includes(x.id) ? { ...x, annotationId: "a1" } : x,
    );
    const result = realignSegment(
      annotated,
      "Ich war gestern noch at the university",
      12.4,
      14.01,
    );
    const noch = result.words.find((x) => x.text === "noch");
    expect(noch?.annotationId).toBeNull();
  });

  it("keeps a word inserted inside a corrected span attached to that correction", () => {
    const corrected = base.map((x) =>
      ["w3", "w4", "w5"].includes(x.id) ? { ...x, correctionId: "c1" } : x,
    );
    const result = realignSegment(
      corrected,
      "Ich war gestern at the big university",
      12.4,
      14.01,
    );
    const big = result.words.find((x) => x.text === "big");
    expect(big?.kind).toBe("inserted");
    expect(big?.correctionId).toBe("c1");
  });

  it("recomputes the segment text as the words joined by single spaces", () => {
    const result = realignSegment(base, "  Ich   war gestern  ", 12.4, 14.01);
    expect(result.text).toBe("Ich war gestern");
  });

  it("never invents a foreign-language replacement — a code-switch retyped identically keeps every id", () => {
    const result = realignSegment(base, "Ich war gestern at the university", 12.4, 14.01);
    expect(result.words.filter((x) => x.kind === "inserted")).toHaveLength(0);
  });
});
