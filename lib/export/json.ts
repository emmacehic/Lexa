import {
  loadAnnotations,
  loadRecording,
  segmentPages,
  type ExportAnnotation,
  type ExportSegment,
} from "./corpus";

/**
 * Corpus-only JSON: annotations + timestamps, no audio filename.
 * For sharing annotation data without the original recording.
 */
export async function* exportCorpusJson(recordingId: string): AsyncGenerator<string> {
  const recording = await loadRecording(recordingId);
  const { bySegment, all } = await loadAnnotations(recordingId);
  const orphans = all.filter((a) => !a.segmentId);

  yield `{\n  "meta": ${JSON.stringify({
    duration: recording.durationSec,
    languages: recording.languages,
    exportedAt: new Date().toISOString(),
  })},\n  "segments": [\n`;

  let first = true;
  for await (const page of segmentPages(recordingId)) {
    for (const segment of page) {
      const body = renderSegment(segment, bySegment.get(segment.id) ?? []);
      yield first ? body : `,\n${body}`;
      first = false;
    }
  }

  yield `\n  ],\n  "orphanAnnotations": ${renderOrphanAnnotations(orphans)}\n}\n`;
}

/** The canonical corpus format (§10.1). */
export async function* exportJson(recordingId: string): AsyncGenerator<string> {
  const recording = await loadRecording(recordingId);
  const { bySegment, all } = await loadAnnotations(recordingId);
  const orphans = all.filter((a) => !a.segmentId);

  yield `{\n  "recording": ${JSON.stringify({
    id: recording.id,
    filename: recording.filename,
    duration: recording.durationSec,
    languages: recording.languages,
  })},\n  "segments": [\n`;

  let first = true;
  for await (const page of segmentPages(recordingId)) {
    for (const segment of page) {
      const body = renderSegment(segment, bySegment.get(segment.id) ?? []);
      yield first ? body : `,\n${body}`;
      first = false;
    }
  }

  yield `\n  ],\n  "orphanAnnotations": ${renderOrphanAnnotations(orphans)}\n}\n`;
}

function renderOrphanAnnotations(orphans: ExportAnnotation[]): string {
  return JSON.stringify(
    orphans.map((a) => ({
      id: a.id,
      type: a.type,
      surface: a.surface,
      start: a.start,
      end: a.end,
      languageTag: a.languageTag,
      nativeAlternative: a.nativeAlternative,
      pronunciation: a.pronunciation,
      confidence: a.confidence,
      wordIds: a.wordIds,
      annotatedBy: a.annotatedBy,
      note: a.note,
      status: a.status.toLowerCase(),
    })),
  );
}

function renderSegment(
  segment: ExportSegment,
  annotations: ExportAnnotation[],
): string {
  const wordIndexById = new Map(segment.words.map((w, i) => [w.id, i]));

  const payload = {
    index: segment.index,
    start: segment.start,
    end: segment.end,
    text: segment.text,
    speakerTag: segment.speakerTag,
    isReviewed: segment.isReviewed,
    words: segment.words.map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      timing: w.timing.toLowerCase(),
      confidence: w.confidence,
    })),
    annotations: annotations.map((a) => ({
      type: a.type,
      surface: a.surface,
      start: a.start,
      end: a.end,
      languageTag: a.languageTag,
      nativeAlternative: a.nativeAlternative,
      pronunciation: a.pronunciation,
      confidence: a.confidence,
      wordIndices: a.wordIds.map((id) => wordIndexById.get(id)),
      annotatedBy: a.annotatedBy,
      note: a.note,
      status: a.status.toLowerCase(),
    })),
  };

  return `    ${JSON.stringify(payload)}`;
}
