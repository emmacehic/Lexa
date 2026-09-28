import { handle } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  createLocalReadStream,
  isLocalLocation,
  openLocalStream,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stream a recording from local disk with Range support (local storage only). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user);

    const row = await prisma.recording.findUniqueOrThrow({
      where: { id },
      select: { storageKey: true, mimeType: true, storageLocation: true },
    });

    if (!isLocalLocation(row.storageLocation)) {
      throw new HttpError(
        404,
        "not-local",
        "This recording is not stored on this machine.",
      );
    }

    let info;
    try {
      info = await openLocalStream(
        row.storageKey,
        row.mimeType || "application/octet-stream",
      );
    } catch {
      throw new HttpError(
        404,
        "media-missing",
        "The recording file is not on this machine yet.",
      );
    }

    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/i.exec(range);
      if (!match) {
        throw new HttpError(416, "bad-range", "That byte range is not valid.");
      }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : info.size - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= info.size) {
        throw new HttpError(416, "bad-range", "That byte range is not valid.");
      }

      const stream = createLocalReadStream(info.path, start, end);
      return new Response(stream as unknown as BodyInit, {
        status: 206,
        headers: {
          "Content-Type": info.mimeType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
        },
      });
    }

    const stream = createLocalReadStream(info.path, 0, info.size - 1);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": info.mimeType,
        "Content-Length": String(info.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      },
    });
  });
}
