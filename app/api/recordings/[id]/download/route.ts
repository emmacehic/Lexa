import { handle } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { objectExists } from "@/lib/storage";
import { sourceDownloadResponse } from "@/lib/source-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download the original uploaded audio or video file. */
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
      select: {
        filename: true,
        mimeType: true,
        storageKey: true,
        storageLocation: true,
        status: true,
      },
    });

    if (row.status === "UPLOADED") {
      throw new HttpError(
        409,
        "upload-incomplete",
        "The file is still uploading. Try again once the upload has finished.",
      );
    }

    if (row.storageKey === "pending" || !(await objectExists(row.storageKey, row.storageLocation))) {
      throw new HttpError(
        404,
        "media-missing",
        "The original recording file is not in storage.",
      );
    }

    try {
      return await sourceDownloadResponse({
        storageKey: row.storageKey,
        storageLocation: row.storageLocation,
        mimeType: row.mimeType,
        filename: row.filename,
      });
    } catch (error) {
      throw new HttpError(
        502,
        "download-failed",
        error instanceof Error
          ? error.message
          : "The recording file could not be downloaded.",
      );
    }
  });
}
