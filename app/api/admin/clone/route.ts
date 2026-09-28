import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  recordingId: z.string().min(1),
  assignToUserId: z.string().min(1).optional(),
});

export const runtime = "nodejs";

/**
 * Clone a recording for inter-annotator agreement.
 * Copies segments + words but no annotations. The second annotator
 * works independently on the clone.
 */
export async function POST(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const body = await parseBody(request, schema);

    const source = await prisma.recording.findUniqueOrThrow({
      where: { id: body.recordingId },
      include: {
        segments: {
          include: { words: { orderBy: { index: "asc" } } },
          orderBy: { index: "asc" },
        },
      },
    });

    const clone = await prisma.$transaction(async (tx) => {
      const rec = await tx.recording.create({
        data: {
          projectId: source.projectId,
          assignedToId: body.assignToUserId ?? null,
          speakerId: source.speakerId,
          filename: `${source.filename.replace(/\.[^.]+$/, "")}_IAA.${source.filename.split(".").pop()}`,
          mimeType: source.mimeType,
          byteSize: source.byteSize,
          durationSec: source.durationSec,
          kind: source.kind,
          storageKey: source.storageKey,
          storageLocation: source.storageLocation,
          waveformPeaks: source.waveformPeaks ?? undefined,
          status: "READY",
          detectedLanguage: source.detectedLanguage,
          sourceUrl: source.sourceUrl,
          sourceContext: source.sourceContext,
          sourceRecordingId: source.id,
        },
      });

      for (const segment of source.segments) {
        const seg = await tx.segment.create({
          data: {
            recordingId: rec.id,
            index: segment.index,
            start: segment.start,
            end: segment.end,
            text: segment.text,
            speakerTag: segment.speakerTag,
          },
        });

        if (segment.words.length > 0) {
          await tx.word.createMany({
            data: segment.words.map((w) => ({
              segmentId: seg.id,
              index: w.index,
              text: w.text,
              start: w.start,
              end: w.end,
              confidence: w.confidence,
              timing: w.timing,
            })),
          });
        }
      }

      return rec;
    });

    return json({ id: clone.id }, { status: 201 });
  });
}
