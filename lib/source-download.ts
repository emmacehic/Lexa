import { contentDispositionAttachment } from "./download-filename";
import type { StorageLocation } from "@prisma/client";
import {
  createLocalReadStream,
  isLocalLocation,
  openLocalStream,
  signedPlaybackUrl,
} from "./storage";

export interface SourceDownloadInput {
  storageKey: string;
  storageLocation: StorageLocation;
  mimeType: string;
  filename: string;
}

/** Stream the original uploaded media as a file download (local disk or Supabase). */
export async function sourceDownloadResponse(
  input: SourceDownloadInput,
): Promise<Response> {
  const disposition = contentDispositionAttachment(input.filename);
  const mimeType = input.mimeType || "application/octet-stream";

  if (isLocalLocation(input.storageLocation)) {
    const info = await openLocalStream(input.storageKey, mimeType);
    const stream = createLocalReadStream(info.path, 0, info.size - 1);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": info.mimeType,
        "Content-Length": String(info.size),
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const url = await signedPlaybackUrl(input.storageKey);
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    throw new Error(
      `Could not read the recording from storage (HTTP ${upstream.status}).`,
    );
  }

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Disposition": disposition,
    "Cache-Control": "private, no-store",
  };
  const length = upstream.headers.get("content-length");
  if (length) headers["Content-Length"] = length;

  return new Response(upstream.body, { headers });
}
