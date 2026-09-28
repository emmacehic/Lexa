import { Queue, type JobsOptions } from "bullmq";
import IORedis, { type Redis } from "ioredis";

import { requireEnv } from "./env";

export const TRANSCRIBE_QUEUE = "lexa-transcribe";

export interface TranscribeJob {
  recordingId: string;
}

let connection: Redis | null = null;
let queue: Queue<TranscribeJob> | null = null;

export function redis(): Redis {
  if (!connection) {
    const { REDIS_URL } = requireEnv("REDIS_URL");
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return connection;
}

export function transcribeQueue(): Queue<TranscribeJob> {
  if (!queue) {
    queue = new Queue<TranscribeJob>(TRANSCRIBE_QUEUE, { connection: redis() });
  }
  return queue;
}

const JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 15_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 500 },
};

export async function enqueueTranscription(recordingId: string): Promise<void> {
  const queue = transcribeQueue();
  const jobId = `transcribe-${recordingId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "active" || state === "waiting" || state === "delayed") {
      return;
    }
    await existing.remove();
  }
  await queue.add("transcribe", { recordingId }, { ...JOB_OPTIONS, jobId });
}
