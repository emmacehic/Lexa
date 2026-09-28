import { describe, expect, it } from "vitest";

import {
  isActiveTranscriptionStatus,
  transcriptionEtaMinutes,
  transcriptionStatusLine,
} from "@/lib/transcription-status";
import { PIPELINE_STAGE } from "@/lib/transcription-pipeline";

describe("transcriptionStatusLine", () => {
  it("includes total remaining time during transcription", () => {
    const line = transcriptionStatusLine(
      "PROCESSING",
      PIPELINE_STAGE.transcribing,
      2400,
      30,
    );
    expect(line).toContain("Transcribing");
    expect(line).toContain("min left");
  });

  it("names the queued stage", () => {
    expect(transcriptionStatusLine("PROCESSING", PIPELINE_STAGE.queued, 0, 1)).toContain(
      "Queued",
    );
  });

  it("includes remaining time during segmenting", () => {
    const line = transcriptionStatusLine(
      "PROCESSING",
      PIPELINE_STAGE.segmenting,
      2664,
      90,
    );
    expect(line).toContain("Building segments");
  });
});

describe("transcriptionEtaMinutes", () => {
  it("rounds to at least one minute", () => {
    expect(transcriptionEtaMinutes(30)).toBe(1);
    expect(transcriptionEtaMinutes(2400)).toBe(3);
  });
});

describe("isActiveTranscriptionStatus", () => {
  it("tracks in-flight jobs", () => {
    expect(isActiveTranscriptionStatus("PROCESSING")).toBe(true);
    expect(isActiveTranscriptionStatus("READY")).toBe(false);
  });
});
