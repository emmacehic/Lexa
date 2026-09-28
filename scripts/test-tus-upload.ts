/**
 * Smoke-test local tus upload against a running server on PORT (default 3001).
 * Usage: pnpm exec tsx --env-file=.env.local scripts/test-tus-upload.ts
 */
import { prisma } from "../lib/prisma";

const port = Number(process.env.PORT ?? "3001");
const base = `http://127.0.0.1:${port}`;

async function login(): Promise<string> {
  const csrf = await fetch(`${base}/api/auth/csrf`).then((r) => r.json()) as {
    csrfToken: string;
  };
  const body = new URLSearchParams({
    csrfToken: csrf.csrfToken,
    email: process.env.SEED_ADMIN_EMAIL ?? "admin@lexa.local",
    password: process.env.SEED_ADMIN_PASSWORD ?? "lexadev",
    callbackUrl: `${base}/library`,
    json: "true",
  });
  const res = await fetch(`${base}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual",
  });
  const cookie = res.headers.getSetCookie?.() ?? [];
  let session = cookie.find((c) => c.startsWith("authjs.session-token"));
  if (!session && (res.status === 302 || res.status === 303)) {
    const location = res.headers.get("location");
    if (location) {
      const follow = await fetch(location.startsWith("http") ? location : `${base}${location}`, {
        headers: { cookie: cookie.map((c) => c.split(";")[0]).join("; ") },
        redirect: "manual",
      });
      const followCookies = follow.headers.getSetCookie?.() ?? [];
      session = followCookies.find((c) => c.startsWith("authjs.session-token"));
    }
  }
  if (!session) {
    throw new Error(`Login failed (HTTP ${res.status}). Is the app running on port ${port}?`);
  }
  return session.split(";")[0]!;
}

async function main(): Promise<void> {
  const cookie = await login();
  const headers = {
    cookie,
    "content-type": "application/json",
  };

  const bytes = Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00" + "x".repeat(64 * 1024));

  const createRes = await fetch(`${base}/api/recordings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      projectName: `tus-test-${Date.now()}`,
      filename: "test.mp3",
      mimeType: "audio/mpeg",
      byteSize: bytes.length,
      durationSec: 0,
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

  const signRes = await fetch(`${base}/api/uploads/sign`, {
    method: "POST",
    headers: {
      ...headers,
      "x-lexa-recording": created.id,
      "x-lexa-object": created.storageKey,
    },
    body: JSON.stringify({ byteSize: bytes.length }),
  });
  const signBody = (await signRes.json()) as { mode?: string };
  if (!signRes.ok || signBody.mode !== "tus") {
    throw new Error(`Sign expected tus, got ${JSON.stringify(signBody)}`);
  }

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
    const detail = await tusCreate.text();
    throw new Error(`Tus create failed HTTP ${tusCreate.status}: ${detail}`);
  }
  const location = tusCreate.headers.get("location");
  if (!location) throw new Error("Tus create returned no location");

  const patchRes = await fetch(`${base}${location}`, {
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
    const detail = await patchRes.text();
    throw new Error(`Tus patch failed HTTP ${patchRes.status}: ${detail}`);
  }

  const uploaded = await fetch(`${base}/api/recordings/${created.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ action: "uploaded" }),
  });
  if (!uploaded.ok) {
    const detail = await uploaded.text();
    throw new Error(`uploaded action failed HTTP ${uploaded.status}: ${detail}`);
  }

  await prisma.recording.delete({ where: { id: created.id } }).catch(() => undefined);
  console.log(`OK: tus uploaded ${bytes.length} bytes for recording ${created.id}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
