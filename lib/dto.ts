/** Wire types shared by the API routes and the workspace client. */

export type TimingSourceDTO = "MEASURED" | "INTERPOLATED";
export type AnnStatusDTO = "ACTIVE" | "NEEDS_REVIEW";
export type JobStatusDTO =
  | "UPLOADED"
  | "PROCESSING"
  | "READY"
  | "FAILED"
  | "COMPLETE";

export interface WordDTO {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  confidence: number | null;
  timing: TimingSourceDTO;
  annotationId: string | null;
  correctionId: string | null;
}

export interface SegmentDTO {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  speakerTag: string | null;
  isReviewed: boolean;
  words: WordDTO[];
}

export interface AnnotationDTO {
  id: string;
  type: string;
  surface: string;
  start: number;
  end: number;
  languageTag: string | null;
  nativeAlternative: string | null;
  pronunciation: string | null;
  confidence: string | null;
  note: string | null;
  status: AnnStatusDTO;
  createdById: string;
  createdByName: string;
  updatedAt: string;
  /** the segment the annotation lives in, null once it has lost its words */
  segmentId: string | null;
  wordIds: string[];
}

export interface CustomLabelDTO {
  type: string;
  label: string;
}

export interface RecordingDTO {
  id: string;
  projectId: string;
  projectName: string;
  filename: string;
  mimeType: string;
  kind: "AUDIO" | "VIDEO";
  byteSize: number;
  durationSec: number;
  status: JobStatusDTO;
  failureReason: string | null;
  detectedLanguage: string | null;
  waveformPeaks: number[] | null;
  progress: number;
  stage: string | null;
  refinementSkipped: boolean;
  assignedToId: string | null;
  speakerName: string | null;
  sourceUrl: string | null;
  sourceContext: string | null;
  languageCodes: string[];
  customLabels: CustomLabelDTO[];
  segmentCount: number;
  reviewedCount: number;
  annotationCounts: Record<string, number>;
  createdAt: string;
}

export interface TranscriptDTO {
  recording: RecordingDTO;
  segments: SegmentDTO[];
  annotations: AnnotationDTO[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface OpsResultDTO {
  segments: SegmentDTO[];
  removedSegmentIds: string[];
  annotations: AnnotationDTO[];
  removedAnnotationIds: string[];
  /** annotations that lost every word in this batch (§9.4) */
  orphaned: AnnotationDTO[];
  /** client temp id → server id, for optimistically created annotations */
  tempIds: Record<string, string>;
  canUndo: boolean;
  canRedo: boolean;
}
