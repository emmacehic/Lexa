import { describe, expect, it } from "vitest";

import {
  reanchorAnnotation,
  validateSpan,
  type AnnotationLike,
  type WordSnapshot,
} from "../../lib/anchor";

/** §9.4 — annotations must never disappear without a trace. */

function word(
  id: string,
  text: string,
  index: number,
  start: number,
  end: number,
  segmentId = "s1",
): WordSnapshot {
  return { id, text, index, start, end, segmentId };
}

const annotation: AnnotationLike = {
  id: "a1",
  type: "code_switch",
  surface: "at the university",
  start: 13.22,
  end: 14.01,
  status: "ACTIVE",
  wordIds: ["w3", "w4", "w5"],
};

function survivors(list: WordSnapshot[]): Map<string, WordSnapshot> {
  return new Map(list.map((w) => [w.id, w]));
}

describe("reanchorAnnotation", () => {
  it("reports no change when every word survived unchanged", () => {
    const outcome = reanchorAnnotation(
      annotation,
      survivors([
        word("w3", "at", 3, 13.22, 13.35),
        word("w4", "the", 4, 13.35, 13.48),
        word("w5", "university", 5, 13.48, 14.01),
      ]),
    );
    expect(outcome.kind).toBe("unchanged");
  });

  it("follows a 1:1 replacement's new surface and timings", () => {
    const outcome = reanchorAnnotation(
      annotation,
      survivors([
        word("w3", "at", 3, 13.22, 13.35),
        word("w4", "the", 4, 13.35, 13.48),
        word("w5", "University.", 5, 13.48, 14.05),
      ]),
    );
    expect(outcome.kind).toBe("shrunk");
    if (outcome.kind !== "shrunk") return;
    expect(outcome.surface).toBe("at the University.");
    expect(outcome.end).toBe(14.05);
    expect(outcome.droppedWordIds).toEqual([]);
  });

  it("shrinks to the survivors when some words are deleted", () => {
    const outcome = reanchorAnnotation(
      annotation,
      survivors([
        word("w4", "the", 4, 13.35, 13.48),
        word("w5", "university", 5, 13.48, 14.01),
      ]),
    );
    expect(outcome.kind).toBe("shrunk");
    if (outcome.kind !== "shrunk") return;
    expect(outcome.wordIds).toEqual(["w4", "w5"]);
    expect(outcome.surface).toBe("the university");
    expect(outcome.start).toBe(13.35);
    expect(outcome.end).toBe(14.01);
    expect(outcome.droppedWordIds).toEqual(["w3"]);
  });

  it("flags the annotation for review — never deletes it — when nothing survives", () => {
    const outcome = reanchorAnnotation(annotation, survivors([]));
    expect(outcome.kind).toBe("orphaned");
    if (outcome.kind !== "orphaned") return;
    expect(outcome.status).toBe("NEEDS_REVIEW");
    expect(outcome.originalSurface).toBe("at the university");
    expect(outcome.droppedWordIds).toEqual(["w3", "w4", "w5"]);
  });

  it("orphans when survivors are not contiguous", () => {
    const outcome = reanchorAnnotation(
      annotation,
      survivors([
        word("w3", "at", 3, 13.22, 13.35),
        word("w5", "university", 5, 13.48, 14.01),
      ]),
    );
    expect(outcome.kind).toBe("orphaned");
  });
});

describe("validateSpan", () => {
  const words = [
    word("w1", "at", 1, 1, 2),
    word("w2", "the", 2, 2, 3),
    word("w3", "university", 3, 3, 4),
  ];

  it("accepts a contiguous run of unannotated words in one segment", () => {
    expect(validateSpan(words, new Set()).ok).toBe(true);
  });

  it("rejects an empty selection", () => {
    expect(validateSpan([], new Set())).toMatchObject({ ok: false, reason: "empty" });
  });

  it("rejects a span that crosses a segment boundary", () => {
    const crossing = [words[0], word("x", "und", 0, 4, 5, "s2")];
    expect(validateSpan(crossing, new Set())).toMatchObject({
      ok: false,
      reason: "crosses-segment",
    });
  });

  it("rejects a span with a hole in it", () => {
    const holed = [words[0], words[2]];
    expect(validateSpan(holed, new Set())).toMatchObject({
      ok: false,
      reason: "not-contiguous",
    });
  });

  it("rejects overlapping an existing annotation — one annotation per word", () => {
    expect(validateSpan(words, new Set(["w2"]))).toMatchObject({
      ok: false,
      reason: "already-annotated",
    });
  });

  it("allows re-marking words that belong to the annotation being edited", () => {
    expect(
      validateSpan(words, new Set(["w2"]), { allowAnnotationIds: new Set(["w2"]) }).ok,
    ).toBe(true);
  });
});
