import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import { localMediaRoot, requiresLocalMediaPath, storeObjectFromFile } from "./storage";

export interface LocalTusSession {
  id: string;
  recordingId: string;
  storageKey: string;
  contentType: string;
  uploadLength: number;
  offset: number;
}

function stagingRoot(): string {
  if (requiresLocalMediaPath()) {
    return join(localMediaRoot(), ".tus-staging");
  }
  return join(tmpdir(), "lexa-tus");
}

function metaPath(id: string): string {
  return join(stagingRoot(), `${id}.json`);
}

function dataPath(id: string): string {
  return join(stagingRoot(), `${id}.bin`);
}

async function ensureRoot(): Promise<void> {
  await mkdir(stagingRoot(), { recursive: true });
}

export async function createLocalUpload(input: {
  recordingId: string;
  storageKey: string;
  contentType: string;
  uploadLength: number;
}): Promise<LocalTusSession> {
  await ensureRoot();
  const id = `local-${randomBytes(16).toString("hex")}`;
  const session: LocalTusSession = {
    id,
    recordingId: input.recordingId,
    storageKey: input.storageKey,
    contentType: input.contentType,
    uploadLength: input.uploadLength,
    offset: 0,
  };
  await writeFile(metaPath(id), JSON.stringify(session));
  await writeFile(dataPath(id), Buffer.alloc(0));
  return session;
}

export async function loadLocalUpload(id: string): Promise<LocalTusSession | null> {
  try {
    const raw = await readFile(metaPath(id), "utf8");
    return JSON.parse(raw) as LocalTusSession;
  } catch {
    return null;
  }
}

export async function appendLocalChunk(
  id: string,
  chunk: Buffer,
): Promise<LocalTusSession> {
  const session = await loadLocalUpload(id);
  if (!session) {
    throw new Error("That upload session is gone. Start the upload again.");
  }
  if (session.offset >= session.uploadLength) return session;
  if (session.offset + chunk.length > session.uploadLength) {
    throw new Error("That chunk would overflow the declared file size.");
  }

  await writeFile(dataPath(id), chunk, { flag: "a" });
  session.offset += chunk.length;
  await writeFile(metaPath(id), JSON.stringify(session));
  return session;
}

export async function finalizeLocalUpload(session: LocalTusSession): Promise<void> {
  await storeObjectFromFile(
    session.storageKey,
    dataPath(session.id),
    session.contentType,
    "LOCAL",
  );
  await rm(metaPath(session.id), { force: true });
}
