import { handle, json } from "@/lib/api";
import { HttpError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inter-annotator agreement comparison.
 * Given a recording and its clone, compute word-level agreement
 * on annotation labels.
 */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const url = new URL(request.url);
    const recordingA = url.searchParams.get("a");
    const recordingB = url.searchParams.get("b");
    if (!recordingA || !recordingB) {
      throw new HttpError(400, "missing-params", "Provide ?a=recordingId&b=recordingId");
    }

    const [wordsA, wordsB] = await Promise.all([
      prisma.word.findMany({
        where: { segment: { recordingId: recordingA } },
        include: { annotation: { select: { type: true } } },
        orderBy: [{ segment: { index: "asc" } }, { index: "asc" }],
      }),
      prisma.word.findMany({
        where: { segment: { recordingId: recordingB } },
        include: { annotation: { select: { type: true } } },
        orderBy: [{ segment: { index: "asc" } }, { index: "asc" }],
      }),
    ]);

    const length = Math.min(wordsA.length, wordsB.length);
    let agree = 0;
    let disagree = 0;
    const confusionMap = new Map<string, number>();

    for (let i = 0; i < length; i++) {
      const labelA = wordsA[i].annotation?.type ?? "none";
      const labelB = wordsB[i].annotation?.type ?? "none";
      if (labelA === labelB) {
        agree++;
      } else {
        disagree++;
        const key = `${labelA} vs ${labelB}`;
        confusionMap.set(key, (confusionMap.get(key) ?? 0) + 1);
      }
    }

    const total = agree + disagree;
    const percentAgreement = total > 0 ? agree / total : 0;

    // Cohen's kappa: (po - pe) / (1 - pe)
    const labels = new Set<string>();
    for (let i = 0; i < length; i++) {
      labels.add(wordsA[i].annotation?.type ?? "none");
      labels.add(wordsB[i].annotation?.type ?? "none");
    }
    let pe = 0;
    for (const label of labels) {
      const countA = wordsA.slice(0, length).filter((w) => (w.annotation?.type ?? "none") === label).length;
      const countB = wordsB.slice(0, length).filter((w) => (w.annotation?.type ?? "none") === label).length;
      pe += (countA / total) * (countB / total);
    }
    const kappa = total > 0 && pe < 1 ? (percentAgreement - pe) / (1 - pe) : percentAgreement;

    const confusion = [...confusionMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([pair, count]) => ({ pair, count }));

    return json({
      totalWords: total,
      agree,
      disagree,
      percentAgreement: Math.round(percentAgreement * 10000) / 100,
      cohensKappa: Math.round(kappa * 10000) / 100,
      confusion,
      wordCountA: wordsA.length,
      wordCountB: wordsB.length,
    });
  });
}
