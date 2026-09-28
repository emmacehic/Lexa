/**
 * One-shot upload + transcription check against the running app.
 * Creates a throwaway project, then deletes the recording and project
 * so nothing stays in the library.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/smoke-upload-transcribe.ts
 */
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { FFMPEG_BINARY } from "../lib/audio";
import { env } from "../lib/env";
import { prisma } from "../lib/prisma";
import { localMediaRoot, localObjectPath } from "../lib/storage";

const execFileAsync = promisify(execFile);

const port = Number(process.env.PORT ?? "3000");
const base = (process.env.AUTH_URL?.replace(/\/$/, "") || `http://127.0.0.1:${port}`);
const PROJECT = `__smoke_transcribe_${Date.now()}__`;
const CLIP_SECONDS = 12;

function cookiePairs(headers: Headers): string[] {
  return (headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]!);
}

function pickSessionCookie(pairs: string[]): string | undefined {
  return pairs.find(
    (value) =>
      value.startsWith("authjs.session-token=") ||
      value.startsWith("__Secure-authjs.session-token="),
  );
}

async function login(): Promise<string> {
  const csrfRes = await fetch(`${base}/api/auth/csrf`);
  const csrf = (await csrfRes.json()) as { csrfToken: string };
  const jar = cookiePairs(csrfRes.headers);
  const body = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@lexa.local",
    password: process.env.SEED_ADMIN_PASSWORD ?? "",
    callbackUrl: `${base}/library`,
    json: "true",
  });
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: jar.join("; "),
    },
    body,
    redirect: "manual",
  });
  jar.push(...cookiePairs(res.headers));
  let session = pickSessionCookie(jar);
  if (!session && (res.status === 302 || res.status === 303)) {
    const location = res.headers.get("location");
    if (location) {
      const follow = await fetch(
        location.startsWith("http") ? location : `${base}${location}`,
        { headers: { cookie: jar.join("; ") }, redirect: "manual" },
      );
      jar.push(...cookiePairs(follow.headers));
      session = pickSessionCookie(jar);
    }
  }
  if (!session) {
    const names = jar.map((c) => c.split("=")[0]).join(", ") || "none";
    throw new Error(
      `Login failed (HTTP ${res.status}, cookies: ${names}).`,
    );
  }
  return jar.join("; ");
}

async function findSourceAudio(): Promise<string | null> {
  const rows = await prisma.recording.findMany({
    where: { status: { in: ["READY", "COMPLETE"] }, durationSec: { gte: CLIP_SECONDS } },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { storageKey: true, storageLocation: true, filename: true },
  });
  for (const row of rows) {
    if (row.storageLocation !== "LOCAL") continue;
    try {
      const path = localObjectPath(row.storageKey);
      await access(path);
      return path;
    } catch {
      /* try the next recording */
    }
  }
  if (env().LOCAL_MEDIA_PATH) {
    console.log(`local media root exists: ${localMediaRoot()}`);
  }
  return null;
}

async function makeClip(source: string | null, outFile: string): Promise<void> {
  if (source) {
    await execFileAsync(FFMPEG_BINARY, [
      "-y",
      "-ss",
      "8",
      "-i",
      source,
      "-t",
      String(CLIP_SECONDS),
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-q:a",
      "5",
      outFile,
    ]);
    return;
  }
  await execFileAsync(FFMPEG_BINARY, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${CLIP_SECONDS}`,
    "-ac",
    "1",
    "-ar",
    "16000",
    outFile,
  ]);
}

async function cleanup(recordingId: string | null, cookie: string | null): Promise<void> {
  if (recordingId && cookie) {
    const del = await fetch(`${base}/api/recordings/${recordingId}`, {
      method: "DELETE",
      headers: { cookie },
    });
    if (!del.ok) {
      console.warn(`DELETE recording HTTP ${del.status}; falling back to Prisma.`);
      await prisma.recording.delete({ where: { id: recordingId } }).catch(() => undefined);
    }
  }
  const project = await prisma.project.findFirst({
    where: { name: PROJECT },
    select: { id: true, _count: { select: { recordings: true } } },
  });
  if (project && project._count.recordings === 0) {
    await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const cookie = await login();
  const headers = { cookie, "content-type": "application/json" };
  const dir = await mkdtemp(join(tmpdir(), "lexa-smoke-"));
  const clip = join(dir, "smoke.mp3");
  let recordingId: string | null = null;

  try {
    const source = await findSourceAudio();
    console.log(source ? `clipping ${CLIP_SECONDS}s from existing audio` : "no stored speech; using a generated tone");
    await makeClip(source, clip);
    const bytes = await readFile(clip);
    if (bytes.length < 1000) {
      throw new Error(`Clip is too small (${bytes.length} bytes).`);
    }

    const createRes = await fetch(`${base}/api/recordings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectName: PROJECT,
        filename: "smoke-transcribe.mp3",
        mimeType: "audio/mpeg",
        byteSize: bytes.length,
        durationSec: CLIP_SECONDS,
      }),
    });
    const created = (await createRes.json()) as {
      id?: string;
      storageKey?: string;
      error?: { message?: string };
    };
    if (!createRes.ok || !created.id || !created.storageKey) {
      throw new Error(created.error?.message ?? `Create failed HTTP ${createRes.status}`);
    }
    recordingId = created.id;

    const signRes = await fetch(`${base}/api/uploads/sign`, {
      method: "POST",
      headers: {
        ...headers,
        "x-lexa-recording": created.id,
        "x-lexa-object": created.storageKey,
      },
      body: JSON.stringify({ byteSize: bytes.length, forceLocal: true }),
    });
    const signBody = (await signRes.json()) as { mode?: string; error?: { message?: string } };
    if (!signRes.ok) {
      throw new Error(signBody.error?.message ?? `Sign failed HTTP ${signRes.status}`);
    }

    if (signBody.mode === "tus") {
      const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
      const tusCreate = await fetch(`${base}/api/uploads/tus`, {
        method: "POST",
        headers: {
          cookie,
          "tus-resumable": "1.0.0",
          "upload-length": String(bytes.length),
          "upload-metadata": [
            `objectName ${encode(created.storageKey)}`,
            `contentType ${encode("audio/mpeg")}`,
          ].join(","),
          "x-lexa-recording": created.id,
        },
      });
      if (tusCreate.status !== 201) {
        throw new Error(`Tus create failed HTTP ${tusCreate.status}: ${await tusCreate.text()}`);
      }
      const location = tusCreate.headers.get("location");
      if (!location) throw new Error("Tus create returned no location");
      const patchRes = await fetch(location.startsWith("http") ? location : `${base}${location}`, {
        method: "PATCH",
        headers: {
          cookie,
          "tus-resumable": "1.0.0",
          "upload-offset": "0",
          "content-type": "application/offset+octet-stream",
        },
        body: bytes,
      });
      if (patchRes.status !== 204) {
        throw new Error(`Tus patch failed HTTP ${patchRes.status}: ${await patchRes.text()}`);
      }
    } else if (signBody.mode === "direct") {
      const put = await fetch(`${base}/api/uploads/direct`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "audio/mpeg",
          "x-lexa-recording": created.id,
          "x-lexa-object": created.storageKey,
        },
        body: bytes,
      });
      if (!put.ok) {
        throw new Error(`Direct upload failed HTTP ${put.status}: ${await put.text()}`);
      }
    } else {
      throw new Error(`Unexpected upload mode ${signBody.mode ?? "unknown"}`);
    }

    const uploaded = await fetch(`${base}/api/recordings/${created.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ action: "uploaded" }),
    });
    if (!uploaded.ok) {
      throw new Error(`Queue failed HTTP ${uploaded.status}: ${await uploaded.text()}`);
    }
    console.log(`queued ${created.id} (${bytes.length} bytes)`);

    const deadline = Date.now() + 12 * 60 * 1000;
    let last = "";
    while (Date.now() < deadline) {
      const row = await prisma.recording.findUniqueOrThrow({
        where: { id: created.id },
        select: {
          status: true,
          progress: true,
          stage: true,
          failureReason: true,
          _count: { select: { segments: true } },
        },
      });
      const line = `${row.status} ${row.progress}% ${row.stage ?? ""}`.trim();
      if (line !== last) {
        console.log(line);
        last = line;
      }
      if (row.status === "READY" || row.status === "COMPLETE") {
        if (row._count.segments < 1) {
          throw new Error("Transcription finished but produced no segments.");
        }
        const first = await prisma.segment.findFirst({
          where: { recordingId: created.id },
          orderBy: { index: "asc" },
          select: { text: true, start: true, end: true },
        });
        console.log(
          `OK: ${row._count.segments} segments, first “${first?.text ?? ""}” ${first?.start ?? 0}–${first?.end ?? 0}`,
        );
        return;
      }
      if (row.status === "FAILED") {
        throw new Error(row.failureReason ?? "Transcription failed.");
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error("Timed out waiting for transcription.");
  } finally {
    await cleanup(recordingId, cookie);
    await unlink(clip).catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    const leftover = await prisma.recording.findFirst({
      where: { filename: "smoke-transcribe.mp3" },
      select: { id: true },
    });
    const leftoverProject = await prisma.project.findFirst({
      where: { name: PROJECT },
      select: { id: true },
    });
    if (leftover || leftoverProject) {
      console.warn("cleanup incomplete — smoke row still in the database");
    } else {
      console.log("cleaned up: recording and smoke project removed");
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
