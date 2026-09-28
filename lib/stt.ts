import { v2 } from "@google-cloud/speech";

import { env, requireEnv } from "./env";
import { serviceAccount, readGcsJson } from "./gcs";

/**
 * Google Cloud Speech-to-Text v2, model `chirp_2`, `batchRecognize` (§6.3).
 *
 * Results are written to the staging bucket rather than returned inline: a
 * four-hour recording's word-level transcript is far past the inline size
 * limit, and silently truncating a corpus is not acceptable.
 */

export interface SttWord {
  text: string;
  start: number;
  end: number;
  confidence: number | null;
}

export interface SttResult {
  words: SttWord[];
  detectedLanguage: string | null;
}

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SttError";
  }
}

let client: v2.SpeechClient | null = null;

function speechClient(): v2.SpeechClient {
  const { GCP_PROJECT_ID } = requireEnv("GCP_PROJECT_ID");
  const location = env().GCP_LOCATION;
  if (!client) {
    client = new v2.SpeechClient({
      projectId: GCP_PROJECT_ID,
      credentials: serviceAccount(),
      apiEndpoint:
        location === "global" ? "speech.googleapis.com" : `${location}-speech.googleapis.com`,
    });
  }
  return client;
}

function toSeconds(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const duration = value as { seconds?: number | string | Long; nanos?: number };
  const seconds = Number(duration.seconds ?? 0);
  const nanos = Number(duration.nanos ?? 0);
  return Math.round((seconds + nanos / 1e9) * 1000) / 1000;
}

interface Long {
  toNumber(): number;
}

interface BatchWordInfo {
  word?: string | null;
  startOffset?: unknown;
  endOffset?: unknown;
  confidence?: number | null;
}

interface BatchAlternative {
  transcript?: string | null;
  words?: BatchWordInfo[] | null;
}

interface BatchResult {
  alternatives?: BatchAlternative[] | null;
  languageCode?: string | null;
}

interface BatchTranscriptFile {
  results?: BatchResult[] | null;
}

export interface RecognizeOptions {
  gcsUri: string;
  languageCodes: string[];
  outputPrefix: string;
  onProgress?: (percent: number) => void;
}

export async function batchRecognize(options: RecognizeOptions): Promise<SttResult> {
  const { GCP_PROJECT_ID, GCS_STAGING_BUCKET } = requireEnv(
    "GCP_PROJECT_ID",
    "GCS_STAGING_BUCKET",
  );
  const location = env().GCP_LOCATION;
  const speech = speechClient();

  const recognizer = `projects/${GCP_PROJECT_ID}/locations/${location}/recognizers/_`;
  const outputUri = `gs://${GCS_STAGING_BUCKET}/${options.outputPrefix}`;

  let operation;
  try {
    [operation] = await speech.batchRecognize({
      recognizer,
      config: {
        model: "chirp_2",
        languageCodes: options.languageCodes,
        features: {
          enableWordTimeOffsets: true,
          enableWordConfidence: true,
          enableAutomaticPunctuation: true,
        },
        autoDecodingConfig: {},
      },
      files: [{ uri: options.gcsUri }],
      recognitionOutputConfig: {
        gcsOutputConfig: { uri: outputUri },
      },
    });
  } catch (error) {
    // The message Google returns is stored and shown verbatim (§6.3).
    throw new SttError(
      error instanceof Error ? error.message : "Speech-to-Text rejected the request.",
    );
  }

  if (options.onProgress) {
    operation.on("progress", (metadata: { progressPercent?: number | null }) => {
      const percent = Number(metadata?.progressPercent ?? 0);
      if (Number.isFinite(percent)) options.onProgress?.(percent);
    });
  }

  let response;
  try {
    [response] = await operation.promise();
  } catch (error) {
    throw new SttError(
      error instanceof Error ? error.message : "Speech-to-Text failed while transcribing.",
    );
  }

  const results = (response as { results?: Record<string, { uri?: string | null; error?: { message?: string | null } | null }> }).results ?? {};
  const entry = results[options.gcsUri] ?? Object.values(results)[0];

  if (!entry) {
    throw new SttError(
      "Speech-to-Text returned no result for the staged audio file.",
    );
  }
  if (entry.error?.message) {
    throw new SttError(entry.error.message);
  }
  if (!entry.uri) {
    throw new SttError(
      "Speech-to-Text finished but wrote no transcript to the staging bucket.",
    );
  }

  const file = (await readGcsJson(entry.uri)) as BatchTranscriptFile;
  return flattenTranscript(file);
}

export function flattenTranscript(file: BatchTranscriptFile): SttResult {
  const words: SttWord[] = [];
  let detectedLanguage: string | null = null;

  for (const result of file.results ?? []) {
    if (!detectedLanguage && result.languageCode) {
      detectedLanguage = result.languageCode;
    }
    const alternative = result.alternatives?.[0];
    if (!alternative) continue;

    for (const w of alternative.words ?? []) {
      const text = (w.word ?? "").trim();
      if (text.length === 0) continue;
      const start = toSeconds(w.startOffset);
      const end = toSeconds(w.endOffset);
      words.push({
        text,
        start,
        end: Math.max(start, end),
        confidence: typeof w.confidence === "number" ? w.confidence : null,
      });
    }
  }

  words.sort((a, b) => a.start - b.start);
  return { words, detectedLanguage };
}
