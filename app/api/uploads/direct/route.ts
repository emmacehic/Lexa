import { handle, json } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { putObjectFromStream } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * Direct upload of the recording bytes. One continuous POST — faster than tus
 * for medium files (e.g. 60 MB mp3) through the Cloudflare tunnel.
 */
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
      select: { storageKey: true, mimeType: true, storageLocation: true },
    });

    const claimedKey = request.headers.get("x-lexa-object");
    if (claimedKey && claimedKey !== recording.storageKey) {
      throw new HttpError(
        403,
        "object-mismatch",
        "That upload does not belong to this recording.",
      );
    }

    if (!request.body) {
      throw new HttpError(400, "empty-upload", "The uploaded file was empty.");
    }

    const bytes = await putObjectFromStream(
      recording.storageKey,
      request.body,
      recording.storageLocation,
    );
    if (bytes === 0) {
      throw new HttpError(400, "empty-upload", "The uploaded file was empty.");
    }

    return json({ ok: true, bytes });
  });
}
