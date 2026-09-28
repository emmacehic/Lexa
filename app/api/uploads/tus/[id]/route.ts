import { handle } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { requireEnv } from "@/lib/env";
import { storageAuthHeaders } from "@/lib/storage-auth";
import {
  appendLocalChunk,
  finalizeLocalUpload,
  loadLocalUpload,
} from "@/lib/tus-local";
import { tusRecordingId } from "@/lib/tus-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function upstreamUrl(id: string): string {
  const { SUPABASE_URL } = requireEnv("SUPABASE_URL");
  return `${SUPABASE_URL.replace(/\/$/, "")}/storage/v1/upload/resumable/${encodeURIComponent(id)}`;
}

function tusHeaders(offset: string, length?: string): HeadersInit {
  const headers: Record<string, string> = {
    "tus-resumable": "1.0.0",
    "upload-offset": offset,
    "cache-control": "no-store",
    "access-control-expose-headers":
      "tus-resumable, upload-offset, upload-length",
  };
  if (length !== undefined) headers["upload-length"] = length;
  return headers;
}

async function assertTusChunkAccess(uploadId: string): Promise<void> {
  const user = await requireUser();
  const recordingId =
    uploadId.startsWith("local-")
      ? (await loadLocalUpload(uploadId))?.recordingId
      : await tusRecordingId(uploadId);
  if (!recordingId) {
    throw new HttpError(404, "upload-not-found", "That upload session does not exist.");
  }
  await assertRecordingAccess(recordingId, user, { write: true });
}

/** Where does the upload stand? tus asks this to resume after an interruption. */
export async function HEAD(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await assertTusChunkAccess(id);
    if (id.startsWith("local-")) {
      const session = await loadLocalUpload(id);
      if (!session) return new Response(null, { status: 404 });
      return new Response(null, {
        status: 200,
        headers: tusHeaders(String(session.offset), String(session.uploadLength)),
      });
    }
    const upstream = await fetch(upstreamUrl(id), {
      method: "HEAD",
      headers: { ...storageAuthHeaders(), "tus-resumable": "1.0.0" },
    });
    return new Response(null, {
      status: upstream.status,
      headers: tusHeaders(
        upstream.headers.get("upload-offset") ?? "0",
        upstream.headers.get("upload-length") ?? "",
      ),
    });
  } catch {
    return new Response(null, { status: 401 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    await assertTusChunkAccess(id);
    const body = Buffer.from(await request.arrayBuffer());

    if (id.startsWith("local-")) {
      const session = await appendLocalChunk(id, body);
      if (session.offset >= session.uploadLength) {
        try {
          await finalizeLocalUpload(session);
        } catch (error) {
          throw new HttpError(
            502,
            "storage-write-failed",
            error instanceof Error
              ? error.message
              : "The uploaded file could not be saved to disk.",
          );
        }
      }
      return new Response(null, {
        status: 204,
        headers: tusHeaders(String(session.offset)),
      });
    }

    const upstream = await fetch(upstreamUrl(id), {
      method: "PATCH",
      headers: {
        ...storageAuthHeaders(),
        "tus-resumable": "1.0.0",
        "upload-offset": request.headers.get("upload-offset") ?? "0",
        "content-type": "application/offset+octet-stream",
      },
      body,
    });

    if (upstream.status >= 400) {
      const detail = await upstream.text();
      throw new HttpError(
        upstream.status,
        "upload-chunk-failed",
        `Supabase Storage rejected a chunk: ${detail || upstream.statusText}`,
      );
    }

    return new Response(null, {
      status: upstream.status,
      headers: tusHeaders(upstream.headers.get("upload-offset") ?? "0"),
    });
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "tus-resumable": "1.0.0", "tus-version": "1.0.0" },
  });
}
