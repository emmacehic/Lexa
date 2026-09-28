import { describe, expect, it } from "vitest";

import {
  buildPipelineOverview,
  PIPELINE_STAGE,
  stepProgressPercent,
} from "@/lib/transcription-pipeline";

describe("buildPipelineOverview", () => {
  it("marks earlier steps done while extracting", () => {
    const overview = buildPipelineOverview(
      "PROCESSING",
      PIPELINE_STAGE.extracting,
      2,
      600,
    );
    expect(overview?.steps.find((s) => s.id === "queued")?.state).toBe("done");
    expect(overview?.steps.find((s) => s.id === "extracting")?.state).toBe("active");
    expect(overview?.steps.find((s) => s.id === "transcribing")?.state).toBe(
      "pending",
    );
    expect(overview?.totalRemainingMinutes).toBeGreaterThan(0);
  });

  it("skips cloud upload on local whisper path", () => {
    const overview = buildPipelineOverview(
      "PROCESSING",
      PIPELINE_STAGE.transcribing,
      30,
      600,
    );
    expect(overview?.steps.find((s) => s.id === "sending")?.state).toBe("skipped");
    expect(overview?.steps.find((s) => s.id === "extracting")?.state).toBe("done");
  });

  it("includes total remaining time in the summary", () => {
    const overview = buildPipelineOverview(
      "PROCESSING",
      PIPELINE_STAGE.transcribing,
      40,
      2664,
    );
    expect(overview?.summary).toContain("Transcribing");
    expect(overview?.summary).toContain("min left");
  });
});

describe("stepProgressPercent", () => {
  it("maps overall progress into the active step band", () => {
    expect(stepProgressPercent("active", 50, 10, 85)).toBe(53);
    expect(stepProgressPercent("active", 2, 2, 10)).toBe(4);
    expect(stepProgressPercent("active", 15, 10, 85)).toBe(7);
  });

  it("returns full bars for completed steps", () => {
    expect(stepProgressPercent("done", 30, 2, 10)).toBe(100);
    expect(stepProgressPercent("skipped", 20, 10, 15)).toBe(100);
  });
});

describe("buildPipelineOverview step bars", () => {
  it("attaches per-step progress from worker percentage", () => {
    const overview = buildPipelineOverview(
      "PROCESSING",
      PIPELINE_STAGE.extracting,
      2,
      600,
    );
    const extracting = overview?.steps.find((s) => s.id === "extracting");
    expect(extracting?.state).toBe("active");
    expect(extracting?.stepProgress).toBe(4);
    expect(overview?.steps.find((s) => s.id === "queued")?.stepProgress).toBe(100);
  });
});
