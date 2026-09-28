import ExcelJS from "exceljs";

import {
  loadAnnotations,
  loadRecording,
  segmentPages,
  type ExportAnnotation,
} from "./corpus";
import { CODE_SWITCH, CORRECTION, LOANWORD, UNCLEAR } from "../labels";

/**
 * XLSX export matching the reference Loanword_CodeSwitch_Annotation_Sheet.
 *
 * Three sheets:
 *   Instructions — the annotation rules
 *   Samples      — one row per segment (= speech sample)
 *   Annotations  — one row per annotation
 */
export async function exportXlsx(recordingId: string): Promise<Buffer> {
  const recording = await loadRecording(recordingId);
  const { all, bySegment } = await loadAnnotations(recordingId);

  const wb = new ExcelJS.Workbook();

  // -------------------------------------------------------------------------
  // Instructions sheet
  // -------------------------------------------------------------------------
  const instrSheet = wb.addWorksheet("Instructions");
  instrSheet.columns = [
    { header: "Field / step", key: "step", width: 18 },
    { header: "What to do", key: "text", width: 90 },
  ];
  instrSheet.addRow({ step: "Project", text: recording.projectName });
  instrSheet.addRow({ step: "Languages", text: recording.languages.join(", ") });
  instrSheet.addRow({ step: "File", text: recording.filename });
  instrSheet.addRow({ step: "Duration", text: `${(recording.durationSec / 60).toFixed(1)} min` });
  instrSheet.addRow({ step: "Exported", text: new Date().toISOString() });
  instrSheet.addRow({ step: "", text: "" });

  const instructions: [string, string][] = [
    ["1", "One row in Samples = one naturally occurring speech segment."],
    ["2", "Use start_time and end_time to show where the segment is in the original audio/video."],
    [
      "3",
      "Write the transcript close to what is actually said, including fillers, repetitions, false starts and self-corrections. Keep informal, dialectal and non-standard forms as spoken.",
    ],
    [
      "4",
      "sample_type: LOAN_ONLY, CS_ONLY or BOTH. Leave blank if the segment contains no annotated loanword or code-switch.",
    ],
    ["5", "In Annotations, use one row for each loanword or code-switching span."],
    ["6", "label: LOANWORD, CODE_SWITCH or UNCLEAR."],
    ["7", "source_language = language the word/switch comes from. Leave blank if you are not sure."],
    ["8", "pronunciation is only a simple note: local, foreign or mixed/unclear."],
    ["9", "Use comments only when something needs explanation. Do not guess."],
  ];
  for (const [step, text] of instructions) {
    instrSheet.addRow({ step, text });
  }
  styleHeader(instrSheet);

  // -------------------------------------------------------------------------
  // Samples sheet
  // -------------------------------------------------------------------------
  const samplesSheet = wb.addWorksheet("Samples");
  const sp = recording.speaker;
  samplesSheet.columns = [
    { header: "sample_id", key: "sample_id", width: 14 },
    { header: "language", key: "language", width: 14 },
    { header: "speaker_id", key: "speaker_id", width: 14 },
    { header: "age_group", key: "age_group", width: 12 },
    { header: "gender", key: "gender", width: 12 },
    { header: "main_language", key: "main_language", width: 16 },
    { header: "other_languages", key: "other_languages", width: 20 },
    { header: "dominant_language", key: "dominant_language", width: 18 },
    { header: "bilingual_status", key: "bilingual_status", width: 18 },
    { header: "heritage_language", key: "heritage_language", width: 18 },
    { header: "country_or_region", key: "country_or_region", width: 18 },
    { header: "current_country", key: "current_country", width: 16 },
    { header: "generation", key: "generation", width: 12 },
    { header: "language_at_home", key: "language_at_home", width: 20 },
    { header: "speaker_role", key: "speaker_role", width: 16 },
    { header: "metadata_source", key: "metadata_source", width: 16 },
    { header: "file_name", key: "file_name", width: 28 },
    { header: "source_url", key: "source_url", width: 20 },
    { header: "source_context", key: "source_context", width: 20 },
    { header: "start_time", key: "start_time", width: 12 },
    { header: "end_time", key: "end_time", width: 12 },
    { header: "transcript", key: "transcript", width: 60 },
    { header: "sample_type", key: "sample_type", width: 14 },
    { header: "annotator", key: "annotator", width: 18 },
    { header: "comments", key: "comments", width: 30 },
  ];
  styleHeader(samplesSheet);

  for await (const page of segmentPages(recordingId)) {
    for (const segment of page) {
      const anns = bySegment.get(segment.id) ?? [];
      samplesSheet.addRow({
        sample_id: `S${String(segment.index + 1).padStart(3, "0")}`,
        language: recording.languages.join(", "),
        speaker_id: recording.speakerName ?? segment.speakerTag ?? "",
        age_group: sp?.ageGroup ?? "",
        gender: sp?.gender ?? "",
        main_language: sp?.mainLanguage ?? "",
        other_languages: sp?.otherLanguages.join(", ") ?? "",
        dominant_language: sp?.dominantLanguage ?? "",
        bilingual_status: sp?.bilingualStatus ?? "",
        heritage_language: sp?.heritageLanguage ?? "",
        country_or_region: sp?.countryOrRegion ?? "",
        current_country: sp?.currentCountry ?? "",
        generation: sp?.generation ?? "",
        language_at_home: sp?.languageAtHome ?? "",
        speaker_role: sp?.speakerRole ?? "",
        metadata_source: sp?.metadataSource ?? "",
        file_name: recording.filename,
        source_url: recording.sourceUrl ?? "",
        source_context: recording.sourceContext ?? recording.projectName,
        start_time: formatTime(segment.start),
        end_time: formatTime(segment.end),
        transcript: segment.text,
        sample_type: sampleType(anns),
        annotator: annotatorNames(anns),
        comments: "",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Annotations sheet
  // -------------------------------------------------------------------------
  const annSheet = wb.addWorksheet("Annotations");
  annSheet.columns = [
    { header: "sample_id", key: "sample_id", width: 14 },
    { header: "timestamp", key: "timestamp", width: 14 },
    { header: "transcript", key: "transcript", width: 40 },
    { header: "form", key: "form", width: 30 },
    { header: "label", key: "label", width: 16 },
    { header: "source_language", key: "source_language", width: 18 },
    { header: "native_alternative", key: "native_alternative", width: 24 },
    { header: "pronunciation", key: "pronunciation", width: 18 },
    { header: "confidence", key: "confidence", width: 14 },
    { header: "comments", key: "comments", width: 30 },
  ];
  styleHeader(annSheet);

  const linguistic = all.filter((a) => a.type !== CORRECTION);
  const corrections = all.filter((a) => a.type === CORRECTION);

  const segmentIndexById = await buildSegmentIndexMap(recordingId);

  for (const a of linguistic) {
    const segIdx = a.segmentId ? segmentIndexById.get(a.segmentId) : undefined;
    annSheet.addRow({
      sample_id: segIdx !== undefined ? `S${String(segIdx + 1).padStart(3, "0")}` : "",
      timestamp: formatTime(a.start),
      transcript: a.surface,
      form: a.surface,
      label: labelName(a.type),
      source_language: a.languageTag ?? "",
      native_alternative: a.nativeAlternative ?? "",
      pronunciation: a.pronunciation ?? "",
      confidence: a.confidence ?? "",
      comments: a.note ?? "",
    });
  }

  const corrSheet = wb.addWorksheet("Corrections");
  corrSheet.columns = [
    { header: "sample_id", key: "sample_id", width: 14 },
    { header: "timestamp", key: "timestamp", width: 14 },
    { header: "as_written", key: "as_written", width: 30 },
    { header: "corrected", key: "corrected", width: 30 },
    { header: "confidence", key: "confidence", width: 14 },
    { header: "annotator", key: "annotator", width: 18 },
  ];
  styleHeader(corrSheet);

  for (const a of corrections) {
    const segIdx = a.segmentId ? segmentIndexById.get(a.segmentId) : undefined;
    corrSheet.addRow({
      sample_id: segIdx !== undefined ? `S${String(segIdx + 1).padStart(3, "0")}` : "",
      timestamp: formatTime(a.start),
      as_written: a.surface,
      corrected: a.nativeAlternative ?? "",
      confidence: a.confidence ?? "",
      annotator: a.annotatedBy,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF8B9DC3" },
  };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
}

function sampleType(annotations: ExportAnnotation[]): string {
  const linguistic = annotations.filter((a) => a.type !== CORRECTION);
  if (linguistic.length === 0) return "";
  const hasLoan = linguistic.some((a) => a.type === LOANWORD);
  const hasCS = linguistic.some((a) => a.type === CODE_SWITCH);
  const hasUnclear = linguistic.some((a) => a.type === UNCLEAR);
  if (hasLoan && hasCS) return "BOTH";
  if (hasLoan) return "LOAN_ONLY";
  if (hasCS) return "CS_ONLY";
  if (hasUnclear) return "UNCLEAR_ONLY";
  return "ANNOTATED";
}

function annotatorNames(annotations: ExportAnnotation[]): string {
  const names = new Set(annotations.map((a) => a.annotatedBy));
  return [...names].join(", ");
}

function labelName(type: string): string {
  if (type === LOANWORD) return "LOANWORD";
  if (type === CODE_SWITCH) return "CODE_SWITCH";
  if (type === UNCLEAR) return "UNCLEAR";
  if (type === CORRECTION) return "CORRECTION";
  return type.toUpperCase();
}

async function buildSegmentIndexMap(
  recordingId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  for await (const page of segmentPages(recordingId)) {
    for (const segment of page) {
      map.set(segment.id, segment.index);
    }
  }
  return map;
}
