import { csvCell, loadAnnotations, loadRecording, segmentPages } from "./corpus";

/** §10.2 — one row per annotation. */
export async function* exportAnnotationCsv(
  recordingId: string,
): AsyncGenerator<string> {
  const recording = await loadRecording(recordingId);
  const { bySegment, all } = await loadAnnotations(recordingId);

  const sp = recording.speaker;

  yield [
    "recording",
    "speaker_id",
    "age_group",
    "gender",
    "main_language",
    "other_languages",
    "dominant_language",
    "bilingual_status",
    "heritage_language",
    "speaker_role",
    "metadata_source",
    "segment_index",
    "segment_start",
    "segment_end",
    "segment_text",
    "annotation_type",
    "surface",
    "ann_start",
    "ann_end",
    "language_tag",
    "native_alternative",
    "pronunciation",
    "confidence",
    "note",
    "annotated_by",
    "annotated_at",
  ].join(",") + "\n";

  for await (const page of segmentPages(recordingId)) {
    let chunk = "";
    for (const segment of page) {
      for (const a of bySegment.get(segment.id) ?? []) {
        chunk +=
          [
            csvCell(recording.filename),
            csvCell(sp?.name),
            csvCell(sp?.ageGroup),
            csvCell(sp?.gender),
            csvCell(sp?.mainLanguage),
            csvCell(sp?.otherLanguages.join(", ")),
            csvCell(sp?.dominantLanguage),
            csvCell(sp?.bilingualStatus),
            csvCell(sp?.heritageLanguage),
            csvCell(sp?.speakerRole),
            csvCell(sp?.metadataSource),
            segment.index,
            segment.start.toFixed(3),
            segment.end.toFixed(3),
            csvCell(segment.text),
            csvCell(a.type),
            csvCell(a.surface),
            a.start.toFixed(3),
            a.end.toFixed(3),
            csvCell(a.languageTag),
            csvCell(a.nativeAlternative),
            csvCell(a.pronunciation),
            csvCell(a.confidence),
            csvCell(a.note),
            csvCell(a.annotatedBy),
            csvCell(a.annotatedAt),
          ].join(",") + "\n";
      }
    }
    if (chunk) yield chunk;
  }

  const orphans = all.filter((a) => !a.segmentId);
  if (orphans.length > 0) {
    let orphanChunk = "";
    for (const a of orphans) {
      orphanChunk +=
        [
          csvCell(recording.filename),
          csvCell(sp?.name),
          csvCell(sp?.ageGroup),
          csvCell(sp?.gender),
          csvCell(sp?.mainLanguage),
          csvCell(sp?.otherLanguages.join(", ")),
          csvCell(sp?.dominantLanguage),
          csvCell(sp?.bilingualStatus),
          csvCell(sp?.heritageLanguage),
          csvCell(sp?.speakerRole),
          csvCell(sp?.metadataSource),
          "",
          "",
          "",
          "",
          csvCell(a.type),
          csvCell(a.surface),
          a.start.toFixed(3),
          a.end.toFixed(3),
          csvCell(a.languageTag),
          csvCell(a.nativeAlternative),
          csvCell(a.pronunciation),
          csvCell(a.confidence),
          csvCell(a.note),
          csvCell(a.annotatedBy),
          csvCell(a.annotatedAt),
        ].join(",") + "\n";
    }
    yield orphanChunk;
  }
}

/** §10.2 — the words-level variant. */
export async function* exportWordCsv(recordingId: string): AsyncGenerator<string> {
  const recording = await loadRecording(recordingId);
  const { all } = await loadAnnotations(recordingId);
  const byId = new Map(all.map((a) => [a.id, a]));

  yield [
    "recording",
    "segment_index",
    "word_index",
    "word",
    "start",
    "end",
    "timing",
    "confidence",
    "annotation_type",
    "language_tag",
  ].join(",") + "\n";

  for await (const page of segmentPages(recordingId)) {
    let chunk = "";
    for (const segment of page) {
      for (const w of segment.words) {
        const annotation = w.annotationId
          ? byId.get(w.annotationId)
          : w.correctionId
            ? byId.get(w.correctionId)
            : undefined;
        chunk +=
          [
            csvCell(recording.filename),
            segment.index,
            w.index,
            csvCell(w.text),
            w.start.toFixed(3),
            w.end.toFixed(3),
            w.timing.toLowerCase(),
            w.confidence === null ? "" : w.confidence.toFixed(4),
            csvCell(annotation?.type ?? ""),
            csvCell(annotation?.languageTag ?? ""),
          ].join(",") + "\n";
      }
    }
    if (chunk) yield chunk;
  }
}
