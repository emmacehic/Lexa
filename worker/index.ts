import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Worker, type Job } from "bullmq";

import { prisma } from "../lib/prisma";
import { redis, TRANSCRIBE_QUEUE, type TranscribeJob } from "../lib/queue";
import { downloadRange, downloadToBuffer, isLocalLocation, localObjectPath } from "../lib/storage";
import { normalizeToFlac, waveformPeaks } from "../lib/audio";
import { deleteStagingPrefix, uploadStagingFile } from "../lib/gcs";
import { batchRecognize } from "../lib/stt";
import { whisperRecognize } from "../lib/stt-whisper";
import { segmentWords, type SegWord } from "../lib/segmenter";
import { sniffContainer, SNIFF_BYTES, unrecognizedMediaMessage } from "../lib/mime";
import { isConfigured } from "../lib/env";

/**
 * The transcription pipeline (§6). One BullMQ worker, one job per recording.
 * Every stage writes its name and a percentage to the recording row, which is
 * what /r/[id]/processing displays — the status line is real, not decorative.
 */

export const STAGES = {
  extracting: "Extracting audio",
  sending: "Uploading for transcription",
  transcribing: "Transcribing",
  segmenting: "Building segments",
} as const;

async function setStage(
  recordingId: string,
  stage: string,
  progress: number,
): Promise<void> {
  await prisma.recording.update({
    where: { id: recordingId },
    data: { stage, progress: Math.max(0, Math.min(100, Math.round(progress))) },
  });
}

export async function runTranscription(recordingId: string): Promise<void> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    include: { project: { select: { languageCodes: true } } },
  });
  if (!recording) throw new Error(`Recording ${recordingId} no longer exists.`);

  const workdir = await mkdtemp(join(tmpdir(), `lexa-${recordingId}-`));
  const stagingPrefix = `lexa/${recordingId}`;

  try {
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: "PROCESSING",
        failureReason: null,
        stage: STAGES.extracting,
        progress: 2,
      },
    });

    // ---- 1. fetch and normalize ----------------------------------------
    const head = await downloadRange(recording.storageKey, SNIFF_BYTES, recording.storageLocation);
    const sniffed = sniffContainer(head);
    if (!sniffed) {
      throw new Error(unrecognizedMediaMessage(head));
    }

    const sourcePath = isLocalLocation(recording.storageLocation)
      ? localObjectPath(recording.storageKey)
      : join(workdir, `source.${sniffed.container}`);

    if (!isLocalLocation(recording.storageLocation)) {
      const source = await downloadToBuffer(recording.storageKey, recording.storageLocation);
      await writeFile(sourcePath, source);
    }

    const flacPath = join(workdir, "normalized.flac");
    await normalizeToFlac(sourcePath, flacPath);
    await setStage(recordingId, STAGES.extracting, 6);

    const { peaks, durationSec } = await waveformPeaks(flacPath);
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        waveformPeaks: peaks,
        durationSec,
        kind: sniffed.kind,
        mimeType: sniffed.mimeType,
        stage: STAGES.extracting,
        progress: 9,
      },
    });

    // ---- 2+3. recognize (GCP or local Whisper) ---------------------------
    const projectLangs = recording.project.languageCodes;
    const useGcp = isConfigured("GCP_PROJECT_ID", "GCP_SERVICE_ACCOUNT_JSON", "GCS_STAGING_BUCKET");
    const languageCodes = useGcp
      ? (projectLangs.length > 0 ? projectLangs.slice(0, 4) : ["en-US"])
      : projectLangs;

    let stt;
    if (useGcp) {
      await setStage(recordingId, STAGES.sending, 10);
      const gcsUri = await uploadStagingFile(flacPath, `${stagingPrefix}/audio.flac`);
      await setStage(recordingId, STAGES.transcribing, 15);
      stt = await batchRecognize({
        gcsUri,
        languageCodes,
        outputPrefix: `${stagingPrefix}/transcript/`,
        onProgress: (percent) => {
          void setStage(
            recordingId,
            STAGES.transcribing,
            15 + (Math.max(0, Math.min(100, percent)) / 100) * 70,
          ).catch(() => undefined);
        },
      });
    } else {
      await setStage(recordingId, STAGES.transcribing, 10);
      stt = await whisperRecognize(flacPath, {
        languageCodes,
        onProgress: (percent) => {
          void setStage(
            recordingId,
            STAGES.transcribing,
            10 + (Math.max(0, Math.min(100, percent)) / 100) * 75,
          ).catch(() => undefined);
        },
      });
    }

    if (stt.words.length === 0) {
      throw new Error(
        "Speech-to-Text returned no words for this recording. It may be silent, or the language codes on the project may not match what is spoken.",
      );
    }

    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        detectedLanguage: stt.detectedLanguage,
        stage: STAGES.segmenting,
        progress: 85,
      },
    });

    // ---- 4. orthography pass -------------------------------------------
    // Skipped: Whisper output is used directly (operator preference).
    const refinedTexts = stt.words.map((w) => w.text);
    const refinementSkipped = true;

    // ---- 5. segment and persist ----------------------------------------
    await setStage(recordingId, STAGES.segmenting, 90);

    const words: SegWord[] = stt.words.map((w, i) => ({
      text: refinedTexts[i] ?? w.text,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
      timing:
        w.start === 0 && w.end === 0 ? "INTERPOLATED" : "MEASURED",
    }));

    const segments = segmentWords(words);

    await prisma.$transaction(async (tx) => {
      await tx.annotation.deleteMany({ where: { recordingId } });
      await tx.segment.deleteMany({ where: { recordingId } });
      for (const segment of segments) {
        await tx.segment.create({
          data: {
            recordingId,
            index: segment.index,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            speakerTag: segment.speakerTag,
            words: {
              create: segment.words.map((w, index) => ({
                index,
                text: w.text,
                start: w.start,
                end: w.end,
                confidence: w.confidence,
                timing: w.timing,
              })),
            },
          },
        });
      }
      await tx.recording.update({
        where: { id: recordingId },
        data: {
          status: "READY",
          stage: null,
          progress: 100,
          failureReason: null,
          refinementSkipped,
        },
      });
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The transcription job failed.";
    await prisma.recording.update({
      where: { id: recordingId },
      data: {
        status: "FAILED",
        failureReason: message,
        stage: null,
        progress: 0,
      },
    });
    throw error;
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
    if (isConfigured("GCP_PROJECT_ID", "GCP_SERVICE_ACCOUNT_JSON", "GCS_STAGING_BUCKET")) {
      await deleteStagingPrefix(stagingPrefix).catch(() => undefined);
    }
  }
}

function main(): void {
  const worker = new Worker<TranscribeJob>(
    TRANSCRIBE_QUEUE,
    async (job: Job<TranscribeJob>) => {
      console.log(`[lexa] transcribing ${job.data.recordingId}`);
      await runTranscription(job.data.recordingId);
      console.log(`[lexa] finished ${job.data.recordingId}`);
    },
    { connection: redis(), concurrency: 1, lockDuration: 3 * 60 * 60 * 1000 },
  );

  worker.on("failed", (job, error) => {
    console.error(`[lexa] job ${job?.id} failed:`, error.message);
  });

  const shutdown = async () => {
    console.log("[lexa] worker shutting down");
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[lexa] worker listening on ${TRANSCRIBE_QUEUE}`);
}

if (process.env.LEXA_WORKER_IMPORT_ONLY !== "1") {
  main();
}
