import { prisma } from "../prisma";
import { CODE_SWITCH, LOANWORD } from "../labels";

/**
 * Shared loading for the exporters (§10).
 *
 * Everything is paged. A four-hour recording must never be assembled into one
 * string in memory, on the server or in the browser.
 */

export const PAGE_SIZE = 200;

export interface ExportSpeaker {
  name: string;
  ageGroup: string | null;
  gender: string | null;
  mainLanguage: string | null;
  otherLanguages: string[];
  dominantLanguage: string | null;
  bilingualStatus: string | null;
  heritageLanguage: string | null;
  countryOrRegion: string | null;
  currentCountry: string | null;
  generation: string | null;
  languageAtHome: string | null;
  speakerRole: string | null;
  metadataSource: string | null;
}

export interface ExportRecording {
  id: string;
  filename: string;
  durationSec: number;
  languages: string[];
  projectName: string;
  sourceUrl: string | null;
  sourceContext: string | null;
  speakerName: string | null;
  speaker: ExportSpeaker | null;
}

export interface ExportWord {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  timing: "MEASURED" | "INTERPOLATED";
  confidence: number | null;
  annotationId: string | null;
  correctionId: string | null;
}

export interface ExportSegment {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  speakerTag: string | null;
  isReviewed: boolean;
  words: ExportWord[];
}

export interface ExportAnnotation {
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
  status: "ACTIVE" | "NEEDS_REVIEW";
  annotatedBy: string;
  annotatedAt: string;
  segmentId: string | null;
  wordIds: string[];
}

export async function loadRecording(recordingId: string): Promise<ExportRecording> {
  const row = await prisma.recording.findUniqueOrThrow({
    where: { id: recordingId },
    include: {
      project: { select: { name: true, languageCodes: true } },
      speaker: true,
    },
  });
  return {
    id: row.id,
    filename: row.filename,
    durationSec: row.durationSec,
    languages: row.project.languageCodes,
    projectName: row.project.name,
    sourceUrl: row.sourceUrl,
    sourceContext: row.sourceContext,
    speakerName: row.speaker?.name ?? null,
    speaker: row.speaker
      ? {
          name: row.speaker.name,
          ageGroup: row.speaker.ageGroup,
          gender: row.speaker.gender,
          mainLanguage: row.speaker.mainLanguage,
          otherLanguages: row.speaker.otherLanguages,
          dominantLanguage: row.speaker.dominantLanguage,
          bilingualStatus: row.speaker.bilingualStatus,
          heritageLanguage: row.speaker.heritageLanguage,
          countryOrRegion: row.speaker.countryOrRegion,
          currentCountry: row.speaker.currentCountry,
          generation: row.speaker.generation,
          languageAtHome: row.speaker.languageAtHome,
          speakerRole: row.speaker.speakerRole,
          metadataSource: row.speaker.metadataSource,
        }
      : null,
  };
}

/** Annotations, keyed by the segment they live in. */
export async function loadAnnotations(
  recordingId: string,
): Promise<{ all: ExportAnnotation[]; bySegment: Map<string, ExportAnnotation[]> }> {
  const rows = await prisma.annotation.findMany({
    where: { recordingId },
    include: {
      createdBy: { select: { email: true, name: true } },
      words: { select: { id: true, segmentId: true, index: true } },
      correctedWords: { select: { id: true, segmentId: true, index: true } },
    },
    orderBy: { start: "asc" },
  });

  const all: ExportAnnotation[] = rows.map((a) => {
    const words = [...a.words, ...a.correctedWords].sort((x, y) => {
      if (x.segmentId !== y.segmentId) return x.segmentId.localeCompare(y.segmentId);
      return x.index - y.index;
    });
    return {
      id: a.id,
      type: a.type,
      surface: a.surface,
      start: a.start,
      end: a.end,
      languageTag: a.languageTag,
      nativeAlternative: a.nativeAlternative,
      pronunciation: a.pronunciation,
      confidence: a.confidence,
      note: a.note,
      status: a.status,
      annotatedBy: a.createdBy.email.split("@")[0],
      annotatedAt: a.createdAt.toISOString(),
      segmentId: words[0]?.segmentId ?? null,
      wordIds: words.map((w) => w.id),
    };
  });

  const bySegment = new Map<string, ExportAnnotation[]>();
  for (const annotation of all) {
    if (!annotation.segmentId) continue;
    const list = bySegment.get(annotation.segmentId) ?? [];
    list.push(annotation);
    bySegment.set(annotation.segmentId, list);
  }
  for (const list of bySegment.values()) {
    list.sort((a, b) => a.start - b.start);
  }

  return { all, bySegment };
}

/** Segments with their words, one page at a time. */
export async function* segmentPages(
  recordingId: string,
): AsyncGenerator<ExportSegment[]> {
  let cursor = -1;
  for (;;) {
    const page = await prisma.segment.findMany({
      where: { recordingId, index: { gt: cursor } },
      include: { words: { orderBy: { index: "asc" } } },
      orderBy: { index: "asc" },
      take: PAGE_SIZE,
    });
    if (page.length === 0) return;
    cursor = page[page.length - 1].index;
    yield page.map((s) => ({
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
        timing: w.timing,
        confidence: w.confidence,
        annotationId: w.annotationId,
        correctionId: w.correctionId,
      })),
    }));
  }
}

/** Timings only — used where a format needs counts or a time table up front. */
export async function* segmentSpanPages(
  recordingId: string,
): AsyncGenerator<{ id: string; index: number; start: number; end: number; text: string }[]> {
  let cursor = -1;
  for (;;) {
    const page = await prisma.segment.findMany({
      where: { recordingId, index: { gt: cursor } },
      select: { id: true, index: true, start: true, end: true, text: true },
      orderBy: { index: "asc" },
      take: PAGE_SIZE,
    });
    if (page.length === 0) return;
    cursor = page[page.length - 1].index;
    yield page;
  }
}

export function tierNameFor(type: string): string {
  if (type === LOANWORD) return "loanword";
  if (type === CODE_SWITCH) return "code-switch";
  return type;
}

/** Turn an async string generator into a streamed HTTP body. */
export function streamOf(source: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await source.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await source.return?.(undefined as never);
    },
  });
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
