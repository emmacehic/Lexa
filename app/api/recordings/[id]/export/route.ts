import { handle } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { streamOf } from "@/lib/export/corpus";
import { exportFilename, FORMATS, isExportFormat } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generated server-side and streamed — nothing is assembled in the browser. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user);

    const format = new URL(request.url).searchParams.get("format") ?? "json";
    if (!isExportFormat(format)) {
      throw new HttpError(
        400,
        "unknown-format",
        `${format} is not an export format. Choose one of ${Object.keys(FORMATS).join(", ")}.`,
      );
    }

    const recording = await prisma.recording.findUniqueOrThrow({
      where: { id },
      select: { filename: true },
    });
    const spec = FORMATS[format];

    if (spec.generateBuffer) {
      const buffer = await spec.generateBuffer(id);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": spec.contentType,
          "Content-Disposition": `attachment; filename="${exportFilename(recording.filename, format)}"`,
          "Content-Length": String(buffer.byteLength),
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(streamOf(spec.generate(id)), {
      headers: {
        "Content-Type": spec.contentType,
        "Content-Disposition": `attachment; filename="${exportFilename(recording.filename, format)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
