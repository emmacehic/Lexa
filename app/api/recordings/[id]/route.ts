import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import {
  assertRecordingAccess,
  HttpError,
  requireAdmin,
  requireUser,
} from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { transcriptDTO } from "@/lib/recordings";
import { enqueueTranscription } from "@/lib/queue";
import { canDeleteRecording } from "@/lib/recording-delete";
import { downloadRange, removeObject } from "@/lib/storage";
import {
  MAX_DURATION_SECONDS,
  SNIFF_BYTES,
  sniffContainer,
  unrecognizedMediaMessage,
} from "@/lib/mime";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user);
    return json(await transcriptDTO(id, user.id));
  });
}

const patchSchema = z.object({
  action: z.enum(["uploaded", "assign", "complete", "reopen", "retry", "metadata", "duration"]),
  assignedToId: z.string().min(1).nullable().optional(),
  speakerId: z.string().min(1).nullable().optional(),
  sourceUrl: z.string().max(2000).nullable().optional(),
  sourceContext: z.string().max(2000).nullable().optional(),
  durationSec: z.number().min(0).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const recording = await assertRecordingAccess(id, user);
    const body = await parseBody(request, patchSchema);

    switch (body.action) {
      case "uploaded": {
        if (recording.status !== "UPLOADED") {
          throw new HttpError(
            409,
            "already-started",
            "This recording has already been queued for transcription.",
          );
        }
        await assertRecordingAccess(id, user, { write: true });
        // The extension was checked when the row was reserved; now that the
        // bytes exist, the container itself decides (§13).
        const row = await prisma.recording.findUniqueOrThrow({ where: { id } });
        const head = await downloadRange(row.storageKey, SNIFF_BYTES, row.storageLocation);
        const sniffed = sniffContainer(head);
        if (!sniffed) {
          const reason = unrecognizedMediaMessage(head);
          await prisma.recording.update({
            where: { id },
            data: {
              status: "FAILED",
              failureReason: reason,
            },
          });
          throw new HttpError(415, "unsupported-format", reason);
        }
        await prisma.recording.update({
          where: { id },
          data: {
            status: "PROCESSING",
            kind: sniffed.kind,
            mimeType: sniffed.mimeType,
            progress: 1,
            stage: "Queued",
            failureReason: null,
          },
        });
        try {
          await enqueueTranscription(id);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "The transcription job could not be queued.";
          await prisma.recording.update({
            where: { id },
            data: {
              status: "FAILED",
              failureReason: message,
              stage: null,
            },
          });
          throw new HttpError(
            502,
            "queue-failed",
            `The file is in storage, but the transcription job could not be queued: ${message}`,
          );
        }
        return json({ ok: true });
      }
      case "retry": {
        if (recording.status !== "FAILED") {
          throw new HttpError(
            409,
            "not-failed",
            "Retry is only available after a failed transcription.",
          );
        }
        await assertRecordingAccess(id, user, { write: true });
        await prisma.recording.update({
          where: { id },
          data: { status: "PROCESSING", failureReason: null, progress: 1, stage: "Queued" },
        });
        try {
          await enqueueTranscription(id);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "The transcription job could not be queued.";
          await prisma.recording.update({
            where: { id },
            data: { status: "FAILED", failureReason: message, stage: null },
          });
          throw new HttpError(
            502,
            "queue-failed",
            `The transcription job could not be queued: ${message}`,
          );
        }
        return json({ ok: true });
      }
      case "assign": {
        await requireAdmin();
        await prisma.recording.update({
          where: { id },
          data: { assignedToId: body.assignedToId ?? null },
        });
        return json({ ok: true });
      }
      case "complete": {
        await requireAdmin();
        if (recording.status !== "READY" && recording.status !== "COMPLETE") {
          throw new HttpError(
            409,
            "not-ready",
            "Only a transcribed recording can be locked as complete.",
          );
        }
        await prisma.recording.update({ where: { id }, data: { status: "COMPLETE" } });
        return json({ ok: true });
      }
      case "reopen": {
        await requireAdmin();
        await prisma.recording.update({ where: { id }, data: { status: "READY" } });
        return json({ ok: true });
      }
      case "metadata": {
        await requireAdmin();
        await prisma.recording.update({
          where: { id },
          data: {
            ...(body.speakerId !== undefined ? { speakerId: body.speakerId } : {}),
            ...(body.sourceUrl !== undefined ? { sourceUrl: body.sourceUrl } : {}),
            ...(body.sourceContext !== undefined ? { sourceContext: body.sourceContext } : {}),
          },
        });
        return json({ ok: true });
      }
      case "duration": {
        await assertRecordingAccess(id, user, { write: true });
        if (body.durationSec === undefined) {
          throw new HttpError(400, "duration-required", "durationSec is required.");
        }
        if (body.durationSec > MAX_DURATION_SECONDS) {
          throw new HttpError(
            413,
            "too-long",
            `That recording is ${(body.durationSec / 3600).toFixed(1)} hours long. The limit is 4 hours.`,
          );
        }
        const row = await prisma.recording.findUniqueOrThrow({ where: { id } });
        if (
          row.status !== "UPLOADED" &&
          !(row.status === "PROCESSING" && row.durationSec === 0)
        ) {
          throw new HttpError(
            409,
            "duration-locked",
            "Duration can only be set before the worker measures the audio.",
          );
        }
        await prisma.recording.update({
          where: { id },
          data: { durationSec: body.durationSec },
        });
        return json({ ok: true });
      }
    }
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    const recording = await assertRecordingAccess(id, user, { write: true });
    if (!canDeleteRecording(recording.status, user.role)) {
      throw new HttpError(
        403,
        "delete-not-allowed",
        "This recording is locked as complete. Ask an admin if it must be removed.",
      );
    }
    const row = await prisma.recording.findUniqueOrThrow({
      where: { id: recording.id },
      select: { storageKey: true, storageLocation: true },
    });

    try {
      await removeObject(row.storageKey, row.storageLocation);
    } catch {
      // Hybrid storage: the file might have landed on the other backend
      // due to fallback. Try the other location before giving up.
      const otherLocation = row.storageLocation === "LOCAL" ? "SUPABASE" : "LOCAL";
      try {
        await removeObject(row.storageKey, otherLocation as typeof row.storageLocation);
      } catch {
        // Best-effort: proceed with DB deletion even if storage cleanup fails.
        // The file is orphaned but the user isn't blocked.
      }
    }

    await prisma.recording.delete({ where: { id: recording.id } });
    return json({ ok: true });
  });
}
