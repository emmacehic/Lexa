import { createReadStream, createWriteStream } from "node:fs";
import { access, copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { StorageLocation } from "@prisma/client";

import { env, requireEnv } from "./env";
import { HYBRID_SUPABASE_MAX_BYTES, LOCAL_DIRECT_UPLOAD_MAX_BYTES } from "./mime";

/**
 * Recording media storage. Supabase Storage (default), a folder on this
 * machine when STORAGE_BACKEND=local, or hybrid (small → Supabase, large →
 * disk). Per-recording `storageLocation` picks the backend for each file.
 */

export type StorageBackend = "supabase" | "local" | "hybrid";

let client: SupabaseClient | null = null;

export function storageBackend(): StorageBackend {
  const value = env().STORAGE_BACKEND;
  if (value === "local") return "local";
  if (value === "hybrid") return "hybrid";
  return "supabase";
}

export function usesLocalStorage(): boolean {
  return storageBackend() === "local";
}

export function usesHybridStorage(): boolean {
  return storageBackend() === "hybrid";
}

export function requiresLocalMediaPath(): boolean {
  return storageBackend() === "local" || storageBackend() === "hybrid";
}

export function isLocalLocation(location: StorageLocation): boolean {
  return location === "LOCAL";
}

export function hybridSupabaseMaxBytes(): number {
  return env().HYBRID_SUPABASE_MAX_BYTES ?? HYBRID_SUPABASE_MAX_BYTES;
}

/** Where a new upload of this size should land. */
export function plannedStorageLocation(byteSize: number): StorageLocation {
  const backend = storageBackend();
  if (backend === "supabase") return "SUPABASE";
  if (backend === "local") return "LOCAL";
  return byteSize <= hybridSupabaseMaxBytes() ? "SUPABASE" : "LOCAL";
}

export type LocalUploadMode = "direct" | "tus";

/** Whether Supabase failures can fall back to disk on this machine. */
export function canFallbackToLocal(): boolean {
  if (storageBackend() === "local") return false;
  if (storageBackend() === "hybrid") return true;
  const path = env().LOCAL_MEDIA_PATH;
  return Boolean(path?.trim());
}

/** How a file should reach local disk (direct POST vs tus). */
export function localUploadModeForSize(byteSize: number): LocalUploadMode {
  if (
    Number.isFinite(byteSize) &&
    byteSize > 0 &&
    byteSize <= LOCAL_DIRECT_UPLOAD_MAX_BYTES
  ) {
    return "direct";
  }
  return "tus";
}

export function localMediaRoot(): string {
  const { LOCAL_MEDIA_PATH } = requireEnv("LOCAL_MEDIA_PATH");
  return resolve(LOCAL_MEDIA_PATH);
}

function assertSafeStorageKey(storageKey: string): void {
  if (
    !storageKey ||
    storageKey.includes("..") ||
    storageKey.startsWith("/") ||
    /^[a-zA-Z]:/.test(storageKey)
  ) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
}

/** Absolute path to a stored object on disk (local location only). */
export function localObjectPath(storageKey: string): string {
  assertSafeStorageKey(storageKey);
  return join(localMediaRoot(), ...storageKey.split("/"));
}

export function storage(): { supabase: SupabaseClient; bucket: string } {
  const cfg = requireEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_BUCKET");
  if (!client) {
    client = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return { supabase: client, bucket: cfg.SUPABASE_BUCKET };
}

export const SIGNED_URL_SECONDS = 60 * 60; // 60 minutes (§4)

export function storageKeyFor(
  projectId: string,
  recordingId: string,
  filename: string,
): string {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "bin";
  const safeExt = ext.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  return `${projectId}/${recordingId}/source.${safeExt}`;
}

export function playbackUrlForRecording(recordingId: string): string {
  return `/api/recordings/${recordingId}/stream`;
}

export async function signedPlaybackUrl(storageKey: string): Promise<string> {
  const { supabase, bucket } = storage();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storageKey, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Supabase Storage could not sign a URL for ${storageKey}: ${error?.message ?? "no URL returned"}`,
    );
  }
  return data.signedUrl;
}

/** Short-lived PUT URL so the browser uploads bytes straight to Storage. */
export async function signedUploadTarget(storageKey: string): Promise<{
  signedUrl: string;
  token: string;
  path: string;
}> {
  const { supabase, bucket } = storage();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storageKey);
  if (error || !data?.signedUrl || !data.token) {
    throw new Error(
      `Supabase Storage could not sign an upload URL for ${storageKey}: ${error?.message ?? "no URL returned"}`,
    );
  }
  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
  };
}

export async function putObject(
  storageKey: string,
  bytes: Buffer,
  contentType: string,
  location: StorageLocation,
): Promise<void> {
  if (isLocalLocation(location)) {
    const dest = localObjectPath(storageKey);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
    return;
  }

  const { supabase, bucket } = storage();
  const { error } = await supabase.storage.from(bucket).upload(storageKey, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new Error(`Supabase Storage could not store the file: ${error.message}`);
  }
}

/** Stream request bytes to disk without buffering the whole file in RAM. */
export async function putObjectFromStream(
  storageKey: string,
  body: ReadableStream<Uint8Array>,
  location: StorageLocation,
): Promise<number> {
  if (!isLocalLocation(location)) {
    const bytes = Buffer.from(await new Response(body).arrayBuffer());
    await putObject(storageKey, bytes, "application/octet-stream", location);
    return bytes.length;
  }

  const dest = localObjectPath(storageKey);
  await mkdir(dirname(dest), { recursive: true });
  const source = Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]);
  let bytes = 0;
  source.on("data", (chunk: Buffer | string) => {
    bytes += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
  });
  await pipeline(source, createWriteStream(dest));
  return bytes;
}

/** Move or copy a finished upload into place (rename fails across Windows drives). */
async function placeLocalFile(sourcePath: string, dest: string): Promise<void> {
  try {
    await rename(sourcePath, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") throw error;
    await copyFile(sourcePath, dest);
    await rm(sourcePath, { force: true });
  }
}

/** Move an assembled upload into permanent storage without loading it into RAM. */
export async function storeObjectFromFile(
  storageKey: string,
  sourcePath: string,
  contentType: string,
  location: StorageLocation,
): Promise<void> {
  if (isLocalLocation(location)) {
    const dest = localObjectPath(storageKey);
    await mkdir(dirname(dest), { recursive: true });
    await placeLocalFile(sourcePath, dest);
    return;
  }

  const bytes = await readFile(sourcePath);
  await putObject(storageKey, bytes, contentType, location);
}

export async function downloadRange(
  storageKey: string,
  bytes: number,
  location: StorageLocation,
): Promise<Buffer> {
  if (isLocalLocation(location)) {
    const path = localObjectPath(storageKey);
    const handle = await open(path, "r");
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await handle.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  const url = await signedPlaybackUrl(storageKey);
  const response = await fetch(url, { headers: { Range: `bytes=0-${bytes - 1}` } });
  if (!response.ok && response.status !== 206) {
    throw new Error(
      `Could not read the uploaded file back from storage (HTTP ${response.status}).`,
    );
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer;
}

export async function downloadToBuffer(
  storageKey: string,
  location: StorageLocation,
): Promise<Buffer> {
  if (isLocalLocation(location)) {
    return readFile(localObjectPath(storageKey));
  }

  const { supabase, bucket } = storage();
  const { data, error } = await supabase.storage.from(bucket).download(storageKey);
  if (error || !data) {
    throw new Error(
      `Supabase Storage could not read ${storageKey}: ${error?.message ?? "no data"}`,
    );
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function removeObject(
  storageKey: string,
  location: StorageLocation,
): Promise<void> {
  if (isLocalLocation(location)) {
    await rm(localObjectPath(storageKey), { force: true });
    return;
  }

  const { supabase, bucket } = storage();
  const { error } = await supabase.storage.from(bucket).remove([storageKey]);
  if (error) {
    throw new Error(
      `Supabase Storage could not delete ${storageKey}: ${error.message}`,
    );
  }
}

export async function objectExists(
  storageKey: string,
  location: StorageLocation,
): Promise<boolean> {
  if (isLocalLocation(location)) {
    try {
      await access(localObjectPath(storageKey));
      return true;
    } catch {
      return false;
    }
  }

  const { supabase, bucket } = storage();
  const slash = storageKey.lastIndexOf("/");
  const dir = slash >= 0 ? storageKey.slice(0, slash) : "";
  const name = slash >= 0 ? storageKey.slice(slash + 1) : storageKey;
  const { data, error } = await supabase.storage.from(bucket).list(dir, {
    search: name,
    limit: 1,
  });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === name);
}

export interface LocalStreamInfo {
  path: string;
  size: number;
  mimeType: string;
}

export async function openLocalStream(
  storageKey: string,
  mimeType: string,
): Promise<LocalStreamInfo> {
  const path = localObjectPath(storageKey);
  const info = await stat(path);
  return { path, size: info.size, mimeType };
}

export function createLocalReadStream(
  path: string,
  start: number,
  end: number,
): ReturnType<typeof createReadStream> {
  return createReadStream(path, { start, end });
}
