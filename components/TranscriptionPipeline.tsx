import type { JobStatusDTO } from "@/lib/dto";
import {
  buildPipelineOverview,
  type PipelineStepState,
} from "@/lib/transcription-pipeline";
import { formatDuration } from "@/lib/time";

function stepIcon(state: PipelineStepState): string {
  switch (state) {
    case "done":
      return "✓";
    case "active":
      return "●";
    case "skipped":
      return "—";
    default:
      return "○";
  }
}

function stepColor(state: PipelineStepState): string {
  switch (state) {
    case "done":
      return "var(--accent)";
    case "active":
      return "var(--accent)";
    case "skipped":
      return "var(--text-secondary)";
    default:
      return "var(--text-secondary)";
  }
}

export function TranscriptionPipeline({
  status,
  stage,
  progress,
  durationSec,
  compact = false,
}: {
  status: JobStatusDTO;
  stage: string | null;
  progress: number;
  durationSec: number;
  compact?: boolean;
}) {
  const overview = buildPipelineOverview(status, stage, progress, durationSec);
  if (!overview) return null;

  if (compact) {
    const active = overview.activeStep;
    return (
      <div className="flex flex-col gap-1">
        {active ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
                {active.label}
                {overview.totalRemainingMinutes > 0
                  ? ` · ~${overview.totalRemainingMinutes} min left`
                  : null}
              </p>
              <span className="timecode text-[11px]">{active.stepProgress}%</span>
            </div>
            <StepProgressBar
              value={active.stepProgress}
              active
              done={false}
              label={active.label}
            />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="text-left">
      <div className="mb-4 flex items-center justify-between gap-3 text-[12px]">
        <span className="text-soft">Overall</span>
        <span className="font-medium tabular-nums">{progress}%</span>
      </div>

      {overview.totalRemainingMinutes > 0 && durationSec > 0 ? (
        <p className="text-soft mb-4 text-[12px]">
          About <span className="font-medium text-[var(--text-primary)]">~{overview.totalRemainingMinutes} min</span> remaining
          {` for this ${formatDuration(durationSec)} recording`}
        </p>
      ) : durationSec <= 0 ? (
        <p className="text-soft mb-4 text-[12px]">
          Processing time depends on the recording length, not file size. Estimates appear once
          audio is extracted.
        </p>
      ) : null}

      <ol className="flex flex-col gap-3" aria-label="Transcription pipeline">
        {overview.steps.map((step) => (
          <li
            key={step.id}
            className="flex items-start gap-2.5 text-[13px]"
            aria-current={step.state === "active" ? "step" : undefined}
          >
            <span
              className="mt-1 w-4 shrink-0 text-center text-[11px] font-bold"
              style={{ color: stepColor(step.state) }}
              aria-hidden
            >
              {stepIcon(step.state)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div
                  className="font-medium"
                  style={{
                    color:
                      step.state === "active"
                        ? "var(--accent)"
                        : step.state === "done"
                          ? "var(--text-primary)"
                          : "var(--text-secondary)",
                  }}
                >
                  {step.label}
                </div>
                {step.state !== "pending" && step.state !== "skipped" ? (
                  <span className="timecode shrink-0 text-[11px]">{step.stepProgress}%</span>
                ) : null}
              </div>

              {step.state !== "skipped" ? (
                <StepProgressBar
                  value={step.stepProgress}
                  active={step.state === "active"}
                  done={step.state === "done"}
                  label={step.label}
                />
              ) : null}

              {step.state === "pending" && step.etaMinutes ? (
                <div className="text-soft mt-1 text-[11px]">
                  {formatStepEta(step.etaMinutes)} estimated
                </div>
              ) : null}
              {step.state === "active" && step.etaMinutes ? (
                <div className="text-soft mt-1 text-[11px]">
                  {formatStepEta(step.etaMinutes)} estimated for this step
                </div>
              ) : null}
              {step.state === "skipped" ? (
                <div className="text-soft text-[11px]">Skipped (local mode)</div>
              ) : null}
              {step.state === "done" ? (
                <div className="text-soft mt-1 text-[11px]">Done</div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatStepEta(minutes: number): string {
  if (minutes <= 1) return "~1 min";
  return `~${minutes} min`;
}

function StepProgressBar({
  value,
  active,
  done,
  label,
}: {
  value: number;
  active: boolean;
  done: boolean;
  label: string;
}) {
  const width = done ? 100 : Math.max(4, value);
  return (
    <div
      className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full"
      style={{ background: "color-mix(in oklch, var(--text) 10%, transparent)" }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={width}
      aria-label={`${label} progress`}
    >
      <div
        style={{
          width: `${width}%`,
          height: "100%",
          background: active || done ? "var(--accent)" : "var(--text-secondary)",
          opacity: done && !active ? 0.55 : 1,
          transition: "width 280ms var(--ease)",
        }}
      />
    </div>
  );
}
