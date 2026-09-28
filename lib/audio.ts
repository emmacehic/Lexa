import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";

/**
 * Audio normalization and waveform peaks (§6.2).
 *
 * Recognition always runs on mono 16 kHz FLAC. The original file is what the
 * workspace plays back — video keeps its picture.
 */

export const FFMPEG_BINARY = (ffmpegPath as unknown as string | null) ?? "ffmpeg";
ffmpeg.setFfmpegPath(FFMPEG_BINARY);

export const PEAK_BUCKETS = 400;
const SAMPLE_RATE = 16_000;
const WINDOW = 1024;

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

/** `-ac 1 -ar 16000 -c:a flac` — exactly the pipeline the spec pins. */
export function normalizeToFlac(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stderr = "";
    ffmpeg(input)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(SAMPLE_RATE)
      .audioCodec("flac")
      .format("flac")
      .on("stderr", (line: string) => {
        stderr = `${stderr}${line}\n`.slice(-4000);
      })
      .on("error", (error: Error) => {
        reject(
          new FfmpegError(
            `ffmpeg could not decode this file: ${error.message.trim()}\n${stderr.trim()}`,
          ),
        );
      })
      .on("end", () => resolve())
      .save(output);
  });
}

export interface WaveformResult {
  /** 400 buckets, 0-100 (§5) */
  peaks: number[];
  /** exact duration, derived from the decoded sample count */
  durationSec: number;
}

/**
 * Decode the normalized audio to raw PCM and reduce it to 400 buckets.
 * Duration comes from the sample count, so it is exact and needs no ffprobe.
 */
export function waveformPeaks(input: string): Promise<WaveformResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BINARY, [
      "-v",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "s16le",
      "-",
    ]);

    const windows: number[] = [];
    let carry: Buffer = Buffer.alloc(0);
    let windowMax = 0;
    let windowCount = 0;
    let totalSamples = 0;
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const sample = Math.abs(buf.readInt16LE(i));
        if (sample > windowMax) windowMax = sample;
        windowCount++;
        totalSamples++;
        if (windowCount === WINDOW) {
          windows.push(windowMax);
          windowMax = 0;
          windowCount = 0;
        }
      }
      carry = (usable < buf.length ? buf.subarray(usable) : Buffer.alloc(0)) as Buffer;
    });

    child.on("error", (error) => {
      reject(new FfmpegError(`ffmpeg failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new FfmpegError(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      if (windowCount > 0) windows.push(windowMax);

      resolve({
        peaks: reducePeaks(windows, PEAK_BUCKETS),
        durationSec: Math.round((totalSamples / SAMPLE_RATE) * 1000) / 1000,
      });
    });
  });
}

/** Reduce an arbitrary number of windows to `buckets` values in 0-100. */
export function reducePeaks(windows: number[], buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (windows.length === 0) return out;

  let globalMax = 0;
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor((i * windows.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((i + 1) * windows.length) / buckets));
    let max = 0;
    for (let j = from; j < to && j < windows.length; j++) {
      if (windows[j] > max) max = windows[j];
    }
    out[i] = max;
    if (max > globalMax) globalMax = max;
  }

  if (globalMax === 0) return out;
  return out.map((v) => Math.round((v / globalMax) * 100));
}
