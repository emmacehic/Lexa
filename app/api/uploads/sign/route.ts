import { handle, json } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import {
  canFallbackToLocal,
  localUploadModeForSize,
  plannedStorageLocation,
  signedUploadTarget,
  usesHybridStorage,
  usesLocalStorage,
} from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignBody = { byteSize?: number; forceLocal?: boolean };

async function markLocalAndRespond(
  recordingId: string,
  byteSize: number,
  fallback = false,
) {
  const mode = localUploadModeForSize(byteSize);
  await prisma.recording.update({
    where: { id: recordingId },
    data: { storageLocation: "LOCAL" },
  });
  return json({ mode, fallback });
}

/**
 * Returns an upload target. Supabase mode uses a short-lived signed PUT URL;
 * local / hybrid-fallback uses direct POST or tus through this server.
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
      select: { storageKey: true },
    });

    const claimedKey = request.headers.get("x-lexa-object");
    if (claimedKey && claimedKey !== recording.storageKey) {
      throw new HttpError(
        403,
        "object-mismatch",
        "That upload does not belong to this recording.",
      );
    }

    let body: SignBody = {};
    try {
      body = (await request.json()) as SignBody;
    } catch {
      /* empty body is ok for tus-only local sign */
    }

    const byteSize = Number(body.byteSize ?? 0);
    const forceLocal = body.forceLocal === true;

    if (forceLocal) {
      if (!canFallbackToLocal()) {
        throw new HttpError(
          503,
          "local-unavailable",
          "Local storage is not configured on this server.",
        );
      }
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        throw new HttpError(400, "missing-size", "The upload did not declare its size.");
      }
      return markLocalAndRespond(recordingId, byteSize, true);
    }

    if (usesHybridStorage()) {
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        throw new HttpError(
          400,
          "missing-size",
          "Hybrid uploads need the file size so Lexa can pick the faster path.",
        );
      }

      const location = plannedStorageLocation(byteSize);
      await prisma.recording.update({
        where: { id: recordingId },
        data: { storageLocation: location },
      });

      if (location === "SUPABASE") {
        try {
          const target = await signedUploadTarget(recording.storageKey);
          return json({ mode: "signed-put" as const, ...target });
        } catch (error) {
          if (!canFallbackToLocal()) {
            throw new HttpError(
              502,
              "supabase-sign-failed",
              error instanceof Error
                ? error.message
                : "Supabase Storage could not accept this upload.",
            );
          }
          return markLocalAndRespond(recordingId, byteSize, true);
        }
      }

      return json({ mode: localUploadModeForSize(byteSize) });
    }

    if (usesLocalStorage()) {
      await prisma.recording.update({
        where: { id: recordingId },
        data: { storageLocation: "LOCAL" },
      });
      return json({ mode: localUploadModeForSize(byteSize) });
    }

    await prisma.recording.update({
      where: { id: recordingId },
      data: { storageLocation: "SUPABASE" },
    });

    try {
      const target = await signedUploadTarget(recording.storageKey);
      return json({ mode: "signed-put" as const, ...target });
    } catch (error) {
      if (!canFallbackToLocal()) {
        throw new HttpError(
          502,
          "supabase-sign-failed",
          error instanceof Error
            ? error.message
            : "Supabase Storage could not accept this upload.",
        );
      }
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        throw new HttpError(
          400,
          "missing-size",
          "The upload did not declare its size.",
        );
      }
      return markLocalAndRespond(recordingId, byteSize, true);
    }
  });
}
