import type { JobStatusDTO } from "@/lib/dto";
import { buildPipelineOverview } from "@/lib/transcription-pipeline";

export {
  transcriptionEtaMinutes,
} from "@/lib/transcription-pipeline";

export interface RecordingStatusSnapshot {
  status: JobStatusDTO;
  progress: number;
  stage: string | null;
  failureReason: string | null;
  filename: string;
  durationSec: number;
  refinementSkipped: boolean;
}

export function isActiveTranscriptionStatus(status: JobStatusDTO): boolean {
  return status === "UPLOADED" || status === "PROCESSING";
}

export function transcriptionStatusLine(
  status: JobStatusDTO,
  stage: string | null,
  durationSec: number,
  progress = 0,
): string {
  const overview = buildPipelineOverview(status, stage, progress, durationSec);
  if (overview) return overview.summary;
  if (status === "FAILED") return "Transcription failed";
  return stage ?? "Ready";
}

export function transcriptionStatusShort(
  status: JobStatusDTO,
  stage: string | null,
): string {
  if (status === "UPLOADED") return "Upload incomplete";
  if (status === "FAILED") return "Failed";
  if (status === "PROCESSING") return stage ?? "Processing";
  if (status === "COMPLETE") return "Complete";
  return "Ready";
}
