import { describe, expect, it } from "vitest";

import { jumpableAnnotations } from "../../lib/annotation-jump";
import type { AnnotationDTO } from "../../lib/dto";

function ann(
  partial: Pick<AnnotationDTO, "id" | "type" | "surface" | "start"> &
    Partial<AnnotationDTO>,
): AnnotationDTO {
  return {
    end: partial.start + 0.4,
    languageTag: null,
    nativeAlternative: null,
    pronunciation: null,
    confidence: null,
    note: null,
    status: "ACTIVE",
    createdById: "u1",
    createdByName: "ann",
    updatedAt: "2026-09-18T00:00:00.000Z",
    segmentId: "s1",
    wordIds: ["w1"],
    ...partial,
  };
}

describe("jumpableAnnotations", () => {
  it("keeps one type, in time order, and skips orphans", () => {
    const rows = jumpableAnnotations(
      [
        ann({ id: "later", type: "loanword", surface: "okay", start: 12 }),
        ann({
          id: "orphan",
          type: "loanword",
          surface: "lost",
          start: 1,
          segmentId: null,
          wordIds: [],
        }),
        ann({ id: "switch", type: "code_switch", surface: "anyway", start: 3 }),
        ann({ id: "earlier", type: "loanword", surface: "cool", start: 4 }),
        ann({
          id: "review",
          type: "loanword",
          surface: "pending",
          start: 2,
          status: "NEEDS_REVIEW",
        }),
      ],
      "loanword",
    );

    expect(rows.map((row) => row.id)).toEqual(["earlier", "later"]);
  });

  it("does not rewrite the stored surface", () => {
    const row = ann({ id: "a", type: "code_switch", surface: "at the university", start: 8 });
    jumpableAnnotations([row], "code_switch");
    expect(row.surface).toBe("at the university");
  });
});
