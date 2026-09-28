import type { JobStatusDTO } from "@/lib/dto";
import { formatDuration } from "@/lib/time";

/** Must match worker/index.ts STAGES values. */
export const PIPELINE_STAGE = {
  queued: "Queued",
  extracting: "Extracting audio",
  sending: "Uploading for transcription",
  transcribing: "Transcribing",
  segmenting: "Building segments",
} as const;

/** Rough Whisper pass — about 4.5% of recording length in minutes. */
export function transcriptionEtaMinutes(durationSec: number): number {
  return Math.max(1, Math.round((durationSec / 60) * 0.075));
}

export type PipelineStepState = "done" | "active" | "pending" | "skipped";

export interface PipelineStepDefinition {
  id: string;
  label: string;
  stage: string;
  etaMinutes: (durationSec: number) => number;
  /** Skipped on local Whisper (no GCS upload step). */
  optional?: boolean;
}

export const PIPELINE_STEPS: PipelineStepDefinition[] = [
  {
    id: "queued",
    label: "Queued",
    stage: PIPELINE_STAGE.queued,
    etaMinutes: () => 1,
  },
  {
    id: "extracting",
    label: "Extracting audio",
    stage: PIPELINE_STAGE.extracting,
    etaMinutes: (durationSec) =>
      Math.max(1, Math.round((durationSec / 60) * 0.04)),
  },
  {
    id: "sending",
    label: "Uploading for transcription",
    stage: PIPELINE_STAGE.sending,
    etaMinutes: (durationSec) =>
      Math.max(1, Math.round((durationSec / 60) * 0.02)),
    optional: true,
  },
  {
    id: "transcribing",
    label: "Transcribing",
    stage: PIPELINE_STAGE.transcribing,
    etaMinutes: transcriptionEtaMinutes,
  },
  {
    id: "segmenting",
    label: "Building segments",
    stage: PIPELINE_STAGE.segmenting,
    etaMinutes: () => 1,
  },
];

export interface PipelineStepView {
  id: string;
  label: string;
  state: PipelineStepState;
  etaMinutes: number | null;
  /** 0–100 within this step (from the worker's overall progress). */
  stepProgress: number;
}

export interface PipelineOverview {
  steps: PipelineStepView[];
  activeStep: PipelineStepView | null;
  totalRemainingMinutes: number;
  summary: string;
}

function stageIndex(stage: string | null): number {
  if (!stage) return -1;
  return PIPELINE_STEPS.findIndex((step) => step.stage === stage);
}

function formatEtaMinutes(minutes: number): string {
  if (minutes <= 1) return "~1 min";
  return `~${minutes} min`;
}

/** Overall progress bands written by worker/index.ts */
const PROGRESS_BANDS = {
  queued: { start: 0, end: 2 },
  extracting: { start: 2, end: 10 },
  sending: { start: 10, end: 15 },
  transcribingLocal: { start: 10, end: 85 },
  transcribingGcp: { start: 15, end: 85 },
  segmenting: { start: 85, end: 100 },
} as const;

export function stepProgressPercent(
  state: PipelineStepState,
  overallProgress: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  if (state === "done") return 100;
  if (state === "skipped") return 100;
  if (state === "pending") return 0;
  if (rangeEnd <= rangeStart) return overallProgress >= rangeEnd ? 100 : 4;
  if (overallProgress <= rangeStart) return 4;
  if (overallProgress >= rangeEnd) return 100;
  return Math.max(
    4,
    Math.min(100, Math.round(((overallProgress - rangeStart) / (rangeEnd - rangeStart)) * 100)),
  );
}

function progressBandForStep(
  stepId: string,
  skippedSending: boolean,
): { start: number; end: number } {
  switch (stepId) {
    case "queued":
      return PROGRESS_BANDS.queued;
    case "extracting":
      return PROGRESS_BANDS.extracting;
    case "sending":
      return PROGRESS_BANDS.sending;
    case "transcribing":
      return skippedSending
        ? PROGRESS_BANDS.transcribingLocal
        : PROGRESS_BANDS.transcribingGcp;
    case "segmenting":
      return PROGRESS_BANDS.segmenting;
    default:
      return { start: 0, end: 100 };
  }
}

export function buildPipelineOverview(
  status: JobStatusDTO,
  stage: string | null,
  progress: number,
  durationSec: number,
): PipelineOverview | null {
  if (status === "UPLOADED") {
    return {
      steps: [
        {
          id: "upload",
          label: "Waiting for upload to finish",
          state: "active",
          etaMinutes: null,
          stepProgress: 4,
        },
      ],
      activeStep: null,
      totalRemainingMinutes: 0,
      summary: "Waiting for the upload to finish",
    };
  }

  if (status !== "PROCESSING") return null;

  let currentIdx = stageIndex(stage);
  if (currentIdx < 0) {
    currentIdx = progress <= 2 ? 0 : 1;
  }

  const sendingIdx = PIPELINE_STEPS.findIndex((s) => s.id === "sending");
  const skippedSending =
    currentIdx > sendingIdx &&
    stage !== PIPELINE_STAGE.sending &&
    stage !== PIPELINE_STAGE.queued;

  const steps: PipelineStepView[] = PIPELINE_STEPS.map((definition, index) => {
    if (definition.optional && skippedSending) {
      return {
        id: definition.id,
        label: definition.label,
        state: "skipped",
        etaMinutes: null,
        stepProgress: 100,
      };
    }

    let state: PipelineStepState;
    if (index < currentIdx) state = "done";
    else if (index === currentIdx) state = "active";
    else state = "pending";

    const etaMinutes =
      state === "done"
        ? null
        : definition.etaMinutes(durationSec);

    const band = progressBandForStep(definition.id, skippedSending);

    return {
      id: definition.id,
      label: definition.label,
      state,
      etaMinutes,
      stepProgress: stepProgressPercent(state, progress, band.start, band.end),
    };
  });

  const activeStep = steps.find((s) => s.state === "active") ?? null;
  const totalRemainingMinutes = steps.reduce(
    (sum, step) => sum + (step.etaMinutes ?? 0),
    0,
  );

  let summary = activeStep?.label ?? "Starting the pipeline";
  if (durationSec <= 0) {
    summary = `${summary} — time estimates appear once the recording length is known`;
  } else if (totalRemainingMinutes > 0) {
    summary = `${summary} — about ${formatEtaMinutes(totalRemainingMinutes)} left (${formatDuration(durationSec)} recording)`;
  } else if (activeStep?.etaMinutes) {
    summary = `${summary} — ${formatEtaMinutes(activeStep.etaMinutes)}`;
  }

  return {
    steps,
    activeStep,
    totalRemainingMinutes,
    summary,
  };
}
