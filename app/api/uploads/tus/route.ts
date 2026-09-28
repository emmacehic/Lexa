import { handle } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { requireEnv } from "@/lib/env";
import { storageAuthHeaders, usesLegacyJwt } from "@/lib/storage-auth";
import { createLocalUpload } from "@/lib/tus-local";
import { registerTusUpload } from "@/lib/tus-registry";
import { MAX_UPLOAD_BYTES } from "@/lib/mime";
import { usesHybridStorage, usesLocalStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resumable upload, proxied (§6.1).
 *
 * The browser speaks tus to this route. When a legacy JWT service-role key is
 * present, chunks go to Supabase Storage's tus endpoint. New `sb_secret_…`
 * keys are not JWTs — Storage's tus API rejects them with "Invalid Compact
 * JWS" — so those uploads are assembled locally and then stored with the
 * object API, which accepts the new keys.
 */

function tusEndpoint(): string {
  const { SUPABASE_URL } = requireEnv("SUPABASE_URL");
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

function decodeMetadata(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(",")) {
    const [key, value] = pair.trim().split(" ");
    if (!key) continue;
    out[key] = value ? Buffer.from(value, "base64").toString("utf8") : "";
  }
  return out;
}

function created(uploadId: string): Response {
  return new Response(null, {
    status: 201,
    headers: {
      "tus-resumable": "1.0.0",
      location: `/api/uploads/tus/${uploadId}`,
      "access-control-expose-headers": "location, tus-resumable, upload-offset",
    },
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();

    const recordingId = request.headers.get("x-lexa-recording");
    if (!recordingId) {
      throw new HttpError(400, "missing-recording", "The upload named no recording.");
    }
    await assertRecordingAccess(recordingId, user, { write: true });

    const recording = await prisma.recording.findUniqueOrThrow({
      where: { id: recordingId },
      select: { storageKey: true, mimeType: true },
    });

    const metadata = decodeMetadata(request.headers.get("upload-metadata"));
    if (metadata.objectName && metadata.objectName !== recording.storageKey) {
      throw new HttpError(
        403,
        "object-mismatch",
        "That upload does not belong to this recording.",
      );
    }

    const contentType =
      metadata.contentType || recording.mimeType || "application/octet-stream";
    const uploadLength = Number(request.headers.get("upload-length") ?? "0");
    if (!Number.isFinite(uploadLength) || uploadLength <= 0) {
      throw new HttpError(400, "missing-length", "The upload did not declare its size.");
    }

    if (usesLocalStorage() || usesHybridStorage() || !usesLegacyJwt()) {
      const session = await createLocalUpload({
        recordingId,
        storageKey: recording.storageKey,
        contentType,
        uploadLength,
      });
      return created(session.id);
    }

    const { SUPABASE_BUCKET } = requireEnv("SUPABASE_BUCKET");
    const encode = (value: string) => Buffer.from(value, "utf8").toString("base64");
    const uploadMetadata = [
      `bucketName ${encode(SUPABASE_BUCKET)}`,
      `objectName ${encode(recording.storageKey)}`,
      `contentType ${encode(contentType)}`,
      `cacheControl ${encode("3600")}`,
    ].join(",");

    const upstream = await fetch(tusEndpoint(), {
      method: "POST",
      headers: {
        ...storageAuthHeaders(),
        "tus-resumable": "1.0.0",
        "upload-length": String(uploadLength),
        "upload-metadata": uploadMetadata,
        "x-upsert": "true",
      },
    });

    if (!upstream.ok && upstream.status !== 201) {
      const detail = await upstream.text();
      throw new HttpError(
        upstream.status,
        "upload-create-failed",
        `Supabase Storage refused the upload: ${detail || upstream.statusText}`,
      );
    }

    const location = upstream.headers.get("location") ?? "";
    const uploadId = location.split("/").filter(Boolean).pop() ?? "";
    if (uploadId) {
      await registerTusUpload(uploadId, recordingId);
    }
    return created(uploadId);
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "tus-resumable": "1.0.0",
      "tus-version": "1.0.0",
      "tus-extension": "creation",
      "tus-max-size": String(MAX_UPLOAD_BYTES),
    },
  });
}
