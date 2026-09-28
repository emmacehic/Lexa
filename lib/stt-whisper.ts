import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile } from "node:fs/promises";

import { env } from "./env";
import type { SttResult, SttWord } from "./stt";
import { whisperLanguageTag } from "./whisper-languages";

/** large-v3 on a 1-hour file can sit silent for far longer than Node's 5-minute fetch default. */
const WHISPER_WAIT_MS = 3 * 60 * 60 * 1000;
const WHISPER_CONTAINER = "lexa-whisper";

/**
 * Local Whisper transcription via an OpenAI-compatible Whisper server.
 *
 * Works with hwdsl2/whisper-server (faster-whisper) or any server that
 * implements POST /v1/audio/transcriptions with word-level timestamps.
 *
 * Start the server with Docker:
 *   docker run -d --name lexa-whisper --restart always \
 *     -p 9000:9000 -v whisper-data:/var/lib/whisper-server \
 *     -e WHISPER_MODEL=base hwdsl2/whisper-server
 */

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperVerboseResponse {
  text?: string;
  language?: string;
  words?: WhisperWord[];
  segments?: { start: number; end: number; text: string }[];
}

/**
 * Transcribe a local audio file using a Whisper-compatible server.
 * Returns the same SttResult shape as the GCP backend.
 */
export async function whisperRecognize(
  flacPath: string,
  options: {
    languageCodes?: string[];
    onProgress?: (percent: number) => void;
  } = {},
): Promise<SttResult> {
  const { WHISPER_SERVER_URL, WHISPER_MODEL, WHISPER_API_KEY } = env();
  const lang = whisperLanguageTag(options.languageCodes ?? []) ?? null;
  const whisperHost = new URL(WHISPER_SERVER_URL).hostname;
  const viaDocker =
    whisperHost === "localhost" || whisperHost === "127.0.0.1" || whisperHost === "::1";

  options.onProgress?.(5);

  // Whisper only answers when the whole file is done. Tick the bar so it
  // keeps moving: fast up to 85%, then a slow crawl so a long large-v3
  // job does not sit frozen at 74% overall.
  let syntheticPercent = 5;
  const ticker = setInterval(() => {
    if (syntheticPercent < 85) {
      syntheticPercent += Math.max(0.5, (85 - syntheticPercent) * 0.08);
    } else {
      syntheticPercent += 0.12;
    }
    if (syntheticPercent > 96) syntheticPercent = 96;
    options.onProgress?.(Math.round(syntheticPercent));
  }, 2000);

  let response: Response;
  try {
    response = viaDocker
      ? await postWhisperViaDocker(flacPath, {
          model: WHISPER_MODEL,
          language: lang,
          apiKey: WHISPER_API_KEY,
        })
      : await postWhisperHttp(
          `${WHISPER_SERVER_URL}/v1/audio/transcriptions`,
          flacPath,
          WHISPER_MODEL,
          lang,
          WHISPER_API_KEY,
        );
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `Lost the connection to Whisper at ${WHISPER_SERVER_URL}: ${detail}. ` +
        `The GPU job may still be running — wait for it to finish before retrying.`,
    );
  } finally {
    clearInterval(ticker);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 401) {
      throw new Error(
        `Whisper at ${WHISPER_SERVER_URL} refused the request (HTTP 401). ` +
          `Its Docker image auto-generates a Bearer token. Put that token in ` +
          `.env.local as WHISPER_API_KEY (docker exec lexa-whisper whisper_manage --getkey), ` +
          `then restart the worker. Server said: ${text || response.statusText}`,
      );
    }
    throw new Error(
      `Whisper server returned ${response.status}: ${text || response.statusText}. Is the server running at ${WHISPER_SERVER_URL}?`,
    );
  }

  options.onProgress?.(90);

  const body = (await response.json()) as WhisperVerboseResponse;
  const words: SttWord[] = [];

  if (body.words && body.words.length > 0) {
    for (const w of body.words) {
      const text = w.word.trim();
      if (text.length === 0) continue;
      words.push({
        text,
        start: w.start,
        end: w.end,
        confidence: null,
      });
    }
  } else if (body.segments) {
    for (const seg of body.segments) {
      const tokens = seg.text.trim().split(/\s+/).filter(Boolean);
      const duration = seg.end - seg.start;
      const wordDur = tokens.length > 0 ? duration / tokens.length : 0;
      for (let i = 0; i < tokens.length; i++) {
        words.push({
          text: tokens[i],
          start: seg.start + i * wordDur,
          end: seg.start + (i + 1) * wordDur,
          confidence: null,
        });
      }
    }
  } else if (body.text) {
    const tokens = body.text.split(/\s+/).filter(Boolean);
    for (const text of tokens) {
      words.push({ text, start: 0, end: 0, confidence: null });
    }
  }

  options.onProgress?.(100);

  return { words, detectedLanguage: body.language ?? lang ?? null };
}

/**
 * On Windows, posting 100MB+ through Docker Desktop's localhost proxy
 * can hang forever and Whisper never sees the file. Copy the FLAC into
 * the container and curl 127.0.0.1 from inside instead.
 */
async function postWhisperViaDocker(
  flacPath: string,
  options: { model: string; language: string | null; apiKey?: string },
): Promise<Response> {
  const remote = `/tmp/lexa-${randomBytes(6).toString("hex")}.flac`;
  console.log(`[lexa] copying audio into ${WHISPER_CONTAINER} for in-container curl`);
  const copied = await runProcess("docker", ["cp", flacPath, `${WHISPER_CONTAINER}:${remote}`], 10 * 60 * 1000);
  if (copied.code !== 0) {
    throw new Error(`docker cp into Whisper failed: ${copied.stderr || copied.stdout}`);
  }

  const curlArgs = [
    "exec",
    WHISPER_CONTAINER,
    "curl",
    "-sS",
    "--max-time",
    String(Math.floor(WHISPER_WAIT_MS / 1000)),
    "-F",
    `file=@${remote};type=audio/flac`,
    "-F",
    `model=${options.model}`,
    "-F",
    "response_format=verbose_json",
    "-F",
    "timestamp_granularities[]=word",
  ];
  if (options.apiKey) {
    curlArgs.push("-H", `Authorization: Bearer ${options.apiKey}`);
  }
  if (options.language) {
    curlArgs.push("-F", `language=${options.language}`);
  }
  curlArgs.push("http://127.0.0.1:9000/v1/audio/transcriptions");

  try {
    console.log("[lexa] curling Whisper from inside the container");
    const result = await runProcess("docker", curlArgs, WHISPER_WAIT_MS);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || "curl inside Whisper failed");
    }
    return new Response(result.stdout, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } finally {
    await runProcess("docker", ["exec", WHISPER_CONTAINER, "rm", "-f", remote], 30_000).catch(
      () => undefined,
    );
  }
}

async function postWhisperHttp(
  urlString: string,
  flacPath: string,
  model: string,
  language: string | null,
  apiKey?: string,
): Promise<Response> {
  const audioBuffer = await readFile(flacPath);
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/flac" }), "audio.flac");
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  if (language) form.append("language", language);

  return new Promise((resolve, reject) => {
    void (async () => {
      const encoded = new Response(form);
      const body = Buffer.from(await encoded.arrayBuffer());
      const url = new URL(urlString);
      const headers: Record<string, string | number | string[]> = {
        "content-type": encoded.headers.get("content-type") ?? "multipart/form-data",
        "content-length": body.length,
      };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      console.log(`[lexa] posting ${body.length} bytes to Whisper via node:http`);
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("end", () => {
            const headerInit = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (typeof value === "string") headerInit.set(key, value);
              else if (Array.isArray(value)) headerInit.set(key, value.join(", "));
            }
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 500,
                statusText: res.statusMessage ?? "",
                headers: headerInit,
              }),
            );
          });
        },
      );
      req.on("error", reject);
      req.setTimeout(WHISPER_WAIT_MS, () => {
        req.destroy(
          new Error(`no response from Whisper after ${WHISPER_WAIT_MS / 60_000} minutes`),
        );
      });
      req.on("socket", (socket) => {
        socket.setKeepAlive(true, 15_000);
        socket.setTimeout(0);
      });
      req.end(body);
    })().catch(reject);
  });
}

function runProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} ${args[0] ?? ""} timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}
