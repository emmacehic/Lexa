import { handle, json } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { LOANWORD } from "@/lib/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-project corpus statistics (§7 /admin). */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const projectId = new URL(request.url).searchParams.get("projectId");

    const where = projectId ? { recording: { projectId } } : {};
    const recWhere = projectId ? { projectId } : {};

    const [
      byType,
      byLanguage,
      byContributor,
      byPronunciation,
      byConfidence,
      annotations,
      recordings,
      needsReview,
      totalDurationResult,
    ] = await Promise.all([
      prisma.annotation.groupBy({
        by: ["type"],
        where,
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.annotation.groupBy({
        by: ["languageTag"],
        where,
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.annotation.groupBy({
        by: ["createdById"],
        where,
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.annotation.groupBy({
        by: ["pronunciation"],
        where: { ...where, pronunciation: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.annotation.groupBy({
        by: ["confidence"],
        where: { ...where, confidence: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.annotation.findMany({
        where: { ...where, type: LOANWORD },
        select: { surface: true },
      }),
      prisma.recording.count(projectId ? { where: recWhere } : undefined),
      prisma.annotation.count({ where: { ...where, status: "NEEDS_REVIEW" } }),
      prisma.recording.aggregate({
        where: recWhere,
        _sum: { durationSec: true },
      }),
    ]);

    const contributors = await prisma.user.findMany({
      where: { id: { in: byContributor.map((c) => c.createdById) } },
      select: { id: true, name: true, email: true },
    });
    const nameById = new Map(contributors.map((c) => [c.id, c.name]));

    const frequency = new Map<string, { surface: string; count: number }>();
    for (const a of annotations) {
      const key = a.surface.toLowerCase();
      const entry = frequency.get(key) ?? { surface: a.surface, count: 0 };
      entry.count++;
      frequency.set(key, entry);
    }
    const topLoanwords = [...frequency.values()]
      .sort((a, b) => b.count - a.count || a.surface.localeCompare(b.surface))
      .slice(0, 25);

    return json({
      recordings,
      totalDuration: totalDurationResult._sum.durationSec ?? 0,
      needsReview,
      byType: byType.map((t) => ({ type: t.type, count: t._count._all })),
      byLanguage: byLanguage.map((l) => ({
        languageTag: l.languageTag ?? "(untagged)",
        count: l._count._all,
      })),
      byContributor: byContributor.map((c) => ({
        userId: c.createdById,
        name: nameById.get(c.createdById) ?? "Unknown",
        count: c._count._all,
      })),
      byPronunciation: byPronunciation.map((p) => ({
        pronunciation: p.pronunciation ?? "(none)",
        count: p._count._all,
      })),
      byConfidence: byConfidence.map((c) => ({
        confidence: c.confidence ?? "(none)",
        count: c._count._all,
      })),
      topLoanwords,
    });
  });
}
