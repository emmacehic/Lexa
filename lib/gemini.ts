import { GoogleGenAI } from "@google/genai";

import { env, isConfigured, requireEnv } from "./env";

/**
 * The Gemini refinement pass (§6.4).
 *
 * It may only change casing, punctuation attached to a token, and obvious
 * orthographic slips inside a token. It returns exactly one token for every
 * token it was given, or its output for that chunk is thrown away and the raw
 * Speech-to-Text tokens are kept. Timings are never touched here, by
 * construction: this function sees text only.
 */

export const CHUNK_SIZE = 250;
export const CONTEXT_SIZE = 30;
export const MODEL = "gemini-2.5-flash";

export const SYSTEM_INSTRUCTION = `You are correcting the orthography of a multilingual research transcript. Return exactly one output token for every input token, in the same order. Never merge, split, add or delete tokens. Never translate. Never replace a foreign-language or borrowed word with a native equivalent — words from other languages are the object of study and must be preserved exactly as spoken.

You may only:
- change the casing of a token,
- attach or correct punctuation that belongs to a token,
- fix an obvious orthographic slip inside a token.

Respond with a JSON array of strings and nothing else. Its length must equal the length of the "tokens" array you were given.`;

export interface RefinementReport {
  tokens: string[];
  chunksTotal: number;
  chunksDiscarded: number;
  notes: string[];
}

let ai: GoogleGenAI | null = null;

function genai(): GoogleGenAI {
  const { GEMINI_API_KEY } = requireEnv("GEMINI_API_KEY");
  if (!ai) ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return ai;
}

function parseTokenArray(raw: string | undefined | null): string[] | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((t) => typeof t === "string")) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

async function callGemini(prompt: string): Promise<string | null> {
  const client = genai();
  const response = await client.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0,
      responseMimeType: "application/json",
    },
  });
  return response.text ?? null;
}

async function callOllama(prompt: string): Promise<string | null> {
  const { OLLAMA_URL, OLLAMA_MODEL } = env();
  const response = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: SYSTEM_INSTRUCTION },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      stream: false,
      think: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text().catch(() => "")}`);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return body.choices?.[0]?.message?.content ?? null;
}

async function callLlm(prompt: string): Promise<string | null> {
  if (isConfigured("GEMINI_API_KEY")) {
    return callGemini(prompt);
  }
  return callOllama(prompt);
}

export async function refineOrthography(
  words: string[],
  options: { languageCodes?: string[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<RefinementReport> {
  const output = [...words];
  const notes: string[] = [];
  let chunksDiscarded = 0;

  const chunkStarts: number[] = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE) chunkStarts.push(i);

  const languages = options.languageCodes?.join(", ") ?? "unspecified";
  const backend = isConfigured("GEMINI_API_KEY") ? "Gemini" : "Ollama";

  for (const [n, start] of chunkStarts.entries()) {
    const end = Math.min(words.length, start + CHUNK_SIZE);
    const tokens = words.slice(start, end);
    const before = words.slice(Math.max(0, start - CONTEXT_SIZE), start);
    const after = words.slice(end, Math.min(words.length, end + CONTEXT_SIZE));

    const payload = JSON.stringify({
      languages,
      contextBefore: before,
      tokens,
      contextAfter: after,
    });

    const prompt = `Correct the orthography of the "tokens" array. "contextBefore" and "contextAfter" are context only — do not return them.\n\n${payload}`;

    let result: string[] | null = null;
    try {
      const raw = await callLlm(prompt);
      result = parseTokenArray(raw);
    } catch (error) {
      notes.push(
        `Chunk ${n + 1}: ${backend} call failed (${error instanceof Error ? error.message : "unknown error"}). Raw transcript kept.`,
      );
      chunksDiscarded++;
      options.onProgress?.(n + 1, chunkStarts.length);
      continue;
    }

    if (!result) {
      notes.push(`Chunk ${n + 1}: response was not a JSON array of strings. Raw transcript kept.`);
      chunksDiscarded++;
    } else if (result.length !== tokens.length) {
      notes.push(
        `Chunk ${n + 1}: expected ${tokens.length} tokens, got ${result.length}. Raw transcript kept.`,
      );
      chunksDiscarded++;
    } else {
      for (let i = 0; i < result.length; i++) {
        const candidate = result[i].trim();
        output[start + i] = candidate.length > 0 && !/\s/.test(candidate)
          ? candidate
          : tokens[i];
      }
    }

    options.onProgress?.(n + 1, chunkStarts.length);
  }

  return {
    tokens: output,
    chunksTotal: chunkStarts.length,
    chunksDiscarded,
    notes,
  };
}
