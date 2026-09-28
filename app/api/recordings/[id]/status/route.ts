import { handle, json } from "@/lib/api";
import { assertRecordingAccess, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The processing screen polls this; it stays deliberately small. */
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
        status: true,
        progress: true,
        stage: true,
        failureReason: true,
        filename: true,
        durationSec: true,
        refinementSkipped: true,
      },
    });
    return json(row);
  });
}
