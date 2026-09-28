import { describe, expect, it } from "vitest";

import { findTranscriptMatches, foldSearchText } from "../../lib/transcript-search";

const segments = [
  {
    id: "s1",
    words: [
      { id: "w1", text: "Vječna" },
      { id: "w2", text: "tema" },
      { id: "w3", text: "Bosne" },
    ],
  },
  {
    id: "s2",
    words: [
      { id: "w4", text: "oslobođena" },
      { id: "w5", text: "žena" },
      { id: "w6", text: "oslobođenje" },
    ],
  },
];

describe("foldSearchText", () => {
  it("lower-cases without stripping diacritics", () => {
    expect(foldSearchText("Bosne")).toBe("bosne");
    expect(foldSearchText("Đ")).toBe("đ");
    expect(foldSearchText("oslobođena")).toBe("oslobođena");
  });

  it("treats NFC and NFD as the same letters", () => {
    const composed = "ć";
    const decomposed = "c\u0301";
    expect(foldSearchText(composed)).toBe(foldSearchText(decomposed));
  });
});

describe("findTranscriptMatches", () => {
  it("returns nothing for a blank query", () => {
    expect(findTranscriptMatches(segments, "")).toEqual([]);
    expect(findTranscriptMatches(segments, "   ")).toEqual([]);
  });

  it("marks words as the query grows, case-insensitively", () => {
    expect(findTranscriptMatches(segments, "bos")).toEqual([
      { segmentId: "s1", wordId: "w3" },
    ]);
    expect(findTranscriptMatches(segments, "BOSNE")).toEqual([
      { segmentId: "s1", wordId: "w3" },
    ]);
  });

  it("finds a shared stem across words without folding đ to d", () => {
    expect(findTranscriptMatches(segments, "oslobođ")).toEqual([
      { segmentId: "s2", wordId: "w4" },
      { segmentId: "s2", wordId: "w6" },
    ]);
    expect(findTranscriptMatches(segments, "oslobod")).toEqual([]);
  });

  it("matches a phrase onto consecutive words only", () => {
    expect(findTranscriptMatches(segments, "tema Bosne")).toEqual([
      { segmentId: "s1", wordId: "w2" },
      { segmentId: "s1", wordId: "w3" },
    ]);
    expect(findTranscriptMatches(segments, "tema žena")).toEqual([]);
  });

  it("does not rewrite the stored word text", () => {
    const word = segments[1].words[0];
    findTranscriptMatches(segments, "oslobođ");
    expect(word.text).toBe("oslobođena");
  });
});
