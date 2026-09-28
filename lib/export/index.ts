import { exportAnnotationCsv, exportWordCsv } from "./csv";
import { exportEaf } from "./eaf";
import { exportCorpusJson, exportJson } from "./json";
import { exportSrt, exportVtt } from "./vtt";
import { exportTextGrid } from "./textgrid";
import { exportXlsx } from "./xlsx";

export type ExportFormat =
  | "json"
  | "corpus-json"
  | "csv"
  | "csv-words"
  | "vtt"
  | "srt"
  | "eaf"
  | "textgrid"
  | "xlsx";

export interface FormatSpec {
  id: ExportFormat;
  label: string;
  description: string;
  extension: string;
  contentType: string;
  generate: (recordingId: string) => AsyncGenerator<string>;
  generateBuffer?: (recordingId: string) => Promise<Buffer>;
}

export const FORMATS: Record<ExportFormat, FormatSpec> = {
  json: {
    id: "json",
    label: "JSON",
    description: "The canonical corpus format — segments, words, timings, annotations.",
    extension: "json",
    contentType: "application/json; charset=utf-8",
    generate: exportJson,
  },
  "corpus-json": {
    id: "corpus-json",
    label: "Corpus JSON (no audio)",
    description: "Annotations and timestamps only — no audio filename or recording ID.",
    extension: "corpus.json",
    contentType: "application/json; charset=utf-8",
    generate: exportCorpusJson,
  },
  csv: {
    id: "csv",
    label: "CSV — annotations",
    description: "One row per annotation, with its segment for context.",
    extension: "csv",
    contentType: "text/csv; charset=utf-8",
    generate: exportAnnotationCsv,
  },
  "csv-words": {
    id: "csv-words",
    label: "CSV — words",
    description: "One row per word, with timing source and confidence.",
    extension: "words.csv",
    contentType: "text/csv; charset=utf-8",
    generate: exportWordCsv,
  },
  vtt: {
    id: "vtt",
    label: "WebVTT",
    description: "The corrected transcript as subtitles.",
    extension: "vtt",
    contentType: "text/vtt; charset=utf-8",
    generate: exportVtt,
  },
  srt: {
    id: "srt",
    label: "SubRip",
    description: "The corrected transcript as .srt subtitles.",
    extension: "srt",
    contentType: "application/x-subrip; charset=utf-8",
    generate: exportSrt,
  },
  eaf: {
    id: "eaf",
    label: "ELAN",
    description: "Three tiers — transcript, loanword, code-switch — with a full time order.",
    extension: "eaf",
    contentType: "application/xml; charset=utf-8",
    generate: exportEaf,
  },
  textgrid: {
    id: "textgrid",
    label: "Praat TextGrid",
    description: "The same three tiers, as interval tiers over the whole recording.",
    extension: "TextGrid",
    contentType: "text/plain; charset=utf-8",
    generate: exportTextGrid,
  },
  xlsx: {
    id: "xlsx",
    label: "XLSX — Annotation Sheet",
    description: "Three-sheet workbook: Instructions, Samples, and Annotations.",
    extension: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    generate: emptyGenerator,
    generateBuffer: exportXlsx,
  },
};

async function* emptyGenerator(): AsyncGenerator<string> {
  /* XLSX is binary; served via generateBuffer, not generate */
}

export const FORMAT_IDS = Object.keys(FORMATS) as ExportFormat[];

export function isExportFormat(value: string): value is ExportFormat {
  return FORMAT_IDS.includes(value as ExportFormat);
}

export interface ExportPreview {
  lines: string[];
  truncated: boolean;
  bytes: number;
}

/** The first 40 lines and the exact byte size (§10). */
export async function previewExport(
  recordingId: string,
  format: ExportFormat,
  maxLines = 40,
): Promise<ExportPreview> {
  const encoder = new TextEncoder();
  const generator = FORMATS[format].generate(recordingId);

  let bytes = 0;
  let buffer = "";
  const lines: string[] = [];
  let truncated = false;

  for await (const chunk of generator) {
    bytes += encoder.encode(chunk).byteLength;
    if (lines.length < maxLines) {
      buffer += chunk;
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (lines.length < maxLines) lines.push(line);
        else truncated = true;
      }
    } else {
      truncated = true;
    }
  }
  if (buffer.length > 0 && lines.length < maxLines) lines.push(buffer);

  return { lines, truncated, bytes };
}

export function exportFilename(base: string, format: ExportFormat): string {
  const stem = base.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "corpus";
  return `${stem}.${FORMATS[format].extension}`;
}
