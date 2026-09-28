import { handle, json } from "@/lib/api";
import { assertRecordingAccess, HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { exportFilename, FORMATS, isExportFormat, previewExport } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The first 40 lines and the exact byte size, for the export sheet (§10). */
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
      throw new HttpError(400, "unknown-format", `${format} is not an export format.`);
    }

    const spec = FORMATS[format];

    const [recording, annotationCount] = await Promise.all([
      prisma.recording.findUniqueOrThrow({
        where: { id },
        select: { filename: true },
      }),
      prisma.annotation.count({ where: { recordingId: id } }),
    ]);

    if (spec.generateBuffer) {
      const buffer = await spec.generateBuffer(id);
      return json({
        format,
        filename: exportFilename(recording.filename, format),
        label: spec.label,
        description: spec.description,
        lines: [
          `XLSX workbook with 3 sheets: Instructions, Samples, Annotations`,
          `${annotationCount} annotation(s)`,
        ],
        truncated: false,
        bytes: buffer.byteLength,
        annotationCount,
      });
    }

    const preview = await previewExport(id, format);

    return json({
      format,
      filename: exportFilename(recording.filename, format),
      label: spec.label,
      description: spec.description,
      lines: preview.lines,
      truncated: preview.truncated,
      bytes: preview.bytes,
      annotationCount,
    });
  });
}
