import { prisma } from "./prisma";
import type { CustomLabelDTO, RecordingDTO, TranscriptDTO } from "./dto";
import { toAnnotationDTO } from "./ops";

function parseCustomLabels(value: unknown): CustomLabelDTO[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (v): v is { type: string; label: string } =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as { type?: unknown }).type === "string" &&
        typeof (v as { label?: unknown }).label === "string",
    )
    .map((v) => ({ type: v.type, label: v.label }));
}

function parsePeaks(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const peaks = value.filter((v): v is number => typeof v === "number");
  return peaks.length > 0 ? peaks : null;
}

const recordingInclude = {
  project: { select: { name: true, languageCodes: true, customLabels: true } },
  speaker: { select: { name: true } },
  _count: { select: { segments: true } },
} as const;

export async function recordingDTO(recordingId: string): Promise<RecordingDTO> {
  const row = await prisma.recording.findUniqueOrThrow({
    where: { id: recordingId },
    include: recordingInclude,
  });

  const [reviewedCount, annotationGroups] = await Promise.all([
    prisma.segment.count({ where: { recordingId, isReviewed: true } }),
    prisma.annotation.groupBy({
      by: ["type"],
      where: { recordingId },
      _count: { _all: true },
    }),
  ]);

  const annotationCounts: Record<string, number> = {};
  for (const group of annotationGroups) {
    annotationCounts[group.type] = group._count._all;
  }

  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    filename: row.filename,
    mimeType: row.mimeType,
    kind: row.kind,
    byteSize: Number(row.byteSize),
    durationSec: row.durationSec,
    status: row.status,
    failureReason: row.failureReason,
    detectedLanguage: row.detectedLanguage,
    waveformPeaks: parsePeaks(row.waveformPeaks),
    progress: row.progress,
    stage: row.stage,
    refinementSkipped: row.refinementSkipped,
    assignedToId: row.assignedToId,
    speakerName: row.speaker?.name ?? null,
    sourceUrl: row.sourceUrl,
    sourceContext: row.sourceContext,
    languageCodes: row.project.languageCodes,
    customLabels: parseCustomLabels(row.project.customLabels),
    segmentCount: row._count.segments,
    reviewedCount,
    annotationCounts,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function transcriptDTO(
  recordingId: string,
  userId: string,
): Promise<TranscriptDTO> {
  const [recording, segments, annotations, undoable, redoable] = await Promise.all([
    recordingDTO(recordingId),
    prisma.segment.findMany({
      where: { recordingId },
      include: { words: { orderBy: { index: "asc" } } },
      orderBy: { index: "asc" },
    }),
    prisma.annotation.findMany({
      where: { recordingId },
      include: {
        createdBy: { select: { name: true } },
        words: { select: { id: true, segmentId: true, index: true } },
        correctedWords: { select: { id: true, segmentId: true, index: true } },
      },
      orderBy: { start: "asc" },
    }),
    prisma.revision.count({ where: { recordingId, userId, undone: false } }),
    prisma.revision.count({ where: { recordingId, userId, undone: true } }),
  ]);

  return {
    recording,
    segments: segments.map((s) => ({
      id: s.id,
      index: s.index,
      start: s.start,
      end: s.end,
      text: s.text,
      speakerTag: s.speakerTag,
      isReviewed: s.isReviewed,
      words: s.words.map((w) => ({
        id: w.id,
        index: w.index,
        text: w.text,
        start: w.start,
        end: w.end,
        confidence: w.confidence,
        timing: w.timing,
        annotationId: w.annotationId,
        correctionId: w.correctionId,
      })),
    })),
    annotations: annotations.map(toAnnotationDTO),
    canUndo: undoable > 0,
    canRedo: redoable > 0,
  };
}

export interface LibraryRow {
  id: string;
  filename: string;
  projectId: string;
  projectName: string;
  kind: "AUDIO" | "VIDEO";
  durationSec: number;
  status: RecordingDTO["status"];
  failureReason: string | null;
  waveformPeaks: number[] | null;
  segmentCount: number;
  reviewedCount: number;
  annotationCounts: Record<string, number>;
  assignedToName: string | null;
  progress: number;
  stage: string | null;
  createdAt: string;
}

export async function libraryRows(projectIds: string[]): Promise<LibraryRow[]> {
  if (projectIds.length === 0) return [];

  const rows = await prisma.recording.findMany({
    where: { projectId: { in: projectIds } },
    orderBy: { createdAt: "desc" },
    include: {
      project: { select: { name: true } },
      assignedTo: { select: { name: true } },
      _count: { select: { segments: true } },
    },
  });

  const ids = rows.map((r) => r.id);
  const [reviewed, annotations] = await Promise.all([
    prisma.segment.groupBy({
      by: ["recordingId"],
      where: { recordingId: { in: ids }, isReviewed: true },
      _count: { _all: true },
    }),
    prisma.annotation.groupBy({
      by: ["recordingId", "type"],
      where: { recordingId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const reviewedBy = new Map(reviewed.map((r) => [r.recordingId, r._count._all]));
  const annotationsBy = new Map<string, Record<string, number>>();
  for (const a of annotations) {
    const bucket = annotationsBy.get(a.recordingId) ?? {};
    bucket[a.type] = a._count._all;
    annotationsBy.set(a.recordingId, bucket);
  }

  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    projectId: r.projectId,
    projectName: r.project.name,
    kind: r.kind,
    durationSec: r.durationSec,
    status: r.status,
    failureReason: r.failureReason,
    waveformPeaks: parsePeaks(r.waveformPeaks),
    segmentCount: r._count.segments,
    reviewedCount: reviewedBy.get(r.id) ?? 0,
    annotationCounts: annotationsBy.get(r.id) ?? {},
    assignedToName: r.assignedTo?.name ?? null,
    progress: r.progress,
    stage: r.stage,
    createdAt: r.createdAt.toISOString(),
  }));
}
