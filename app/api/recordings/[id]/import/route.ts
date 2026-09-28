import { handle, json } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { parseSrtVtt, parsePlainText } from "@/lib/import/srt";
import { importXlsxAnnotations } from "@/lib/import/xlsx";
import { splitTokens } from "@/lib/tokenize";

export const runtime = "nodejs";

/**
 * Import transcript (SRT/VTT/plain text) or XLSX annotations
 * into an existing recording.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user, { write: true });

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const mode = formData.get("mode") as string | null;

    if (!file) {
      throw new HttpError(400, "no-file", "No file provided.");
    }

    if (mode === "annotations") {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await importXlsxAnnotations(id, user.id, buffer);
      return json(result);
    }

    // Transcript import: SRT, VTT, or plain text
    const recording = await prisma.recording.findUniqueOrThrow({
      where: { id },
      select: { durationSec: true, status: true },
    });

    const existingSegments = await prisma.segment.count({ where: { recordingId: id } });
    if (existingSegments > 0) {
      throw new HttpError(
        409,
        "has-segments",
        "This recording already has segments. Import is only available for recordings without existing transcript data.",
      );
    }

    const content = await file.text();
    const filename = file.name.toLowerCase();

    let segments;
    if (filename.endsWith(".srt") || filename.endsWith(".vtt")) {
      segments = parseSrtVtt(content);
    } else {
      segments = parsePlainText(content, recording.durationSec);
    }

    if (segments.length === 0) {
      throw new HttpError(400, "empty-transcript", "The file contains no usable segments.");
    }

    const duration = recording.durationSec;
    if (duration <= 0) {
      throw new HttpError(
        400,
        "no-duration",
        "The recording has no known duration. Upload the media file first so the system can compute it.",
      );
    }

    for (const seg of segments) {
      if (seg.start < 0) seg.start = 0;
      if (seg.end <= seg.start) seg.end = seg.start + 0.5;
      if (seg.end > duration) seg.end = duration;
    }

    await prisma.$transaction(async (tx) => {
      for (const seg of segments) {
        const words = splitTokens(seg.text);
        const span = seg.end - seg.start;
        const wordDuration = words.length > 0 ? span / words.length : 0;

        const dbSeg = await tx.segment.create({
          data: {
            recordingId: id,
            index: seg.index,
            start: seg.start,
            end: seg.end,
            text: seg.text,
          },
        });

        if (words.length > 0) {
          await tx.word.createMany({
            data: words.map((text, i) => ({
              segmentId: dbSeg.id,
              index: i,
              text,
              start: Math.round((seg.start + i * wordDuration) * 1000) / 1000,
              end: Math.round((seg.start + (i + 1) * wordDuration) * 1000) / 1000,
              timing: "INTERPOLATED" as const,
            })),
          });
        }
      }

      await tx.recording.update({
        where: { id },
        data: { status: "READY" },
      });
    });

    return json({ segments: segments.length });
  });
}
