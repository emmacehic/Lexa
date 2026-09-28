import { handle, json } from "@/lib/api";
import { assertRecordingAccess, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { playbackUrlForRecording, signedPlaybackUrl, SIGNED_URL_SECONDS, isLocalLocation } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A signed URL, valid 60 minutes. The bucket itself is never public (§13). */
export async function GET(
  _request: Request,
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
    return json({
      url: isLocalLocation(row.storageLocation)
        ? playbackUrlForRecording(id)
        : await signedPlaybackUrl(row.storageKey),
      mimeType: row.mimeType,
      expiresIn: SIGNED_URL_SECONDS,
    });
  });
}
