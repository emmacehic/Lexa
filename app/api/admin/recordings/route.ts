import { handle, json } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return json({ recordings: [] });

    const rows = await prisma.recording.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      include: {
        assignedTo: { select: { name: true } },
        speaker: { select: { id: true, name: true } },
        _count: { select: { segments: true } },
      },
    });

    const ids = rows.map((r) => r.id);
    const reviewed = await prisma.segment.groupBy({
      by: ["recordingId"],
      where: { recordingId: { in: ids }, isReviewed: true },
      _count: { _all: true },
    });
    const reviewedBy = new Map(reviewed.map((r) => [r.recordingId, r._count._all]));

    return json({
      recordings: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        projectId: r.projectId,
        status: r.status,
        assignedToId: r.assignedToId,
        assignedToName: r.assignedTo?.name ?? null,
        speakerId: r.speakerId,
        speakerName: r.speaker?.name ?? null,
        sourceUrl: r.sourceUrl,
        sourceContext: r.sourceContext,
        durationSec: r.durationSec,
        segmentCount: r._count.segments,
        reviewedCount: reviewedBy.get(r.id) ?? 0,
      })),
    });
  });
}
