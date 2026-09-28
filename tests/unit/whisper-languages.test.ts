import { describe, expect, it } from "vitest";

import { whisperLanguageTag } from "../../lib/whisper-languages";
import {
  WHISPER_LANGUAGES,
  filterWhisperLanguages,
} from "../../lib/whisper-languages";

describe("Whisper language catalogue", () => {
  it("lists the 99 languages Whisper transcribes", () => {
    expect(WHISPER_LANGUAGES).toHaveLength(99);
    expect(new Set(WHISPER_LANGUAGES.map((l) => l.code)).size).toBe(99);
  });

  it("finds languages by name or code", () => {
    const hits = filterWhisperLanguages("bosn");
    expect(hits.map((l) => l.code)).toEqual(["bs"]);
  });
});

describe("whisperLanguageTag", () => {
  it("passes a single project language through", () => {
    expect(whisperLanguageTag(["bs-BA"])).toBe("bs");
  });

  it("omits the tag when several languages are listed so Whisper auto-detects", () => {
    expect(whisperLanguageTag(["bs-BA", "de-CH", "en-US"])).toBeUndefined();
  });
});
