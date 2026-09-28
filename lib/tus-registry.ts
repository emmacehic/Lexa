import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), "lexa-tus-registry");

async function ensureRoot(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
}

function pathFor(uploadId: string): string {
  return join(ROOT, `${uploadId}.json`);
}

/** Bind a Supabase resumable upload id to the recording that started it. */
export async function registerTusUpload(
  uploadId: string,
  recordingId: string,
): Promise<void> {
  await ensureRoot();
  await writeFile(pathFor(uploadId), JSON.stringify({ recordingId }));
}

export async function tusRecordingId(uploadId: string): Promise<string | null> {
  try {
    const raw = await readFile(pathFor(uploadId), "utf8");
    const parsed = JSON.parse(raw) as { recordingId?: string };
    return parsed.recordingId ?? null;
  } catch {
    return null;
  }
}
