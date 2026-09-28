import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FLAG_ICON_CODES } from "../../lib/flag-icon-codes";
import { flagForLanguage } from "../../lib/language-flags";
import { WHISPER_LANGUAGES } from "../../lib/whisper-languages";

describe("flagForLanguage", () => {
  it("maps every Whisper language to a bundled flag asset", () => {
    for (const lang of WHISPER_LANGUAGES) {
      const flag = flagForLanguage(lang.code);
      expect(flag.length).toBeGreaterThan(0);
      expect(flag).not.toBe("un");
      expect(FLAG_ICON_CODES.has(flag)).toBe(true);
      expect(
        existsSync(join(process.cwd(), "public/flags/4x3", `${flag}.svg`)),
      ).toBe(true);
    }
  });

  it("uses the region from BCP-47 tags", () => {
    expect(flagForLanguage("bs-BA")).toBe("ba");
    expect(flagForLanguage("de-CH")).toBe("ch");
    expect(flagForLanguage("en-US")).toBe("us");
  });

  it("uses sensible defaults instead of the first country match", () => {
    expect(flagForLanguage("en")).toBe("gb");
    expect(flagForLanguage("es")).toBe("es");
    expect(flagForLanguage("pt")).toBe("pt");
    expect(flagForLanguage("ar")).toBe("arab");
    expect(flagForLanguage("cy")).toBe("gb-wls");
    expect(flagForLanguage("ca")).toBe("es-ct");
  });

  it("handles uppercase speaker-id language codes", () => {
    expect(flagForLanguage("BS")).toBe("ba");
    expect(flagForLanguage("DE")).toBe("de");
  });
});
