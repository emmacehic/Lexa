import { describe, expect, it } from "vitest";

import { canDeleteRecording } from "@/lib/recording-delete";

describe("canDeleteRecording", () => {
  it("lets an admin delete any status", () => {
    expect(canDeleteRecording("COMPLETE", "ADMIN")).toBe(true);
    expect(canDeleteRecording("READY", "ADMIN")).toBe(true);
  });

  it("lets a contributor delete a ready transcription", () => {
    expect(canDeleteRecording("READY", "CONTRIBUTOR")).toBe(true);
    expect(canDeleteRecording("FAILED", "CONTRIBUTOR")).toBe(true);
  });

  it("blocks a contributor from deleting a locked complete recording", () => {
    expect(canDeleteRecording("COMPLETE", "CONTRIBUTOR")).toBe(false);
  });
});
