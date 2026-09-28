import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { assertProjectMember, HttpError, requireUser, visibleProjectIds } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { resolveOrCreateProject } from "@/lib/projects";
import { libraryRows } from "@/lib/recordings";
import { storageKeyFor, plannedStorageLocation } from "@/lib/storage";
import { consumeUploadSlot } from "@/lib/ratelimit";
import {
  ACCEPTED_DESCRIPTION,
  ACCEPTED_EXTENSIONS,
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_GB,
  describeGiven,
  inferMediaKind,
} from "@/lib/mime";

export const runtime = "nodejs";

const createSchema = z.object({
  projectId: z.string().min(1).optional(),
  projectName: z.string().min(1).max(160).optional(),
  filename: z.string().min(1).max(400),
  mimeType: z.string().max(200).default(""),
  byteSize: z.number().int().min(1),
  durationSec: z.number().min(0).default(0),
});

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const ids = await visibleProjectIds(user);
    return json({ recordings: await libraryRows(ids) });
  });
}

/**
 * Reserve a recording row before the bytes move. The upload itself goes
 * straight to storage through the resumable proxy in /api/uploads/tus.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await parseBody(request, createSchema);
    const projectId = body.projectName
      ? await resolveOrCreateProject(user, body.projectName)
      : body.projectId;
    if (!projectId) {
      throw new HttpError(
        400,
        "project-required",
        "Name the project this recording belongs to.",
      );
    }
    await assertProjectMember(projectId, user);

    const extension = body.filename.includes(".")
      ? body.filename.split(".").pop()!.toLowerCase()
      : "";
    if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
      throw new HttpError(
        415,
        "unsupported-format",
        `Lexa cannot read ${describeGiven(body.filename, body.mimeType)}. It accepts ${ACCEPTED_DESCRIPTION}.`,
      );
    }
    if (body.byteSize > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        "too-large",
        `That file is ${(body.byteSize / 1024 ** 3).toFixed(2)} GB. The limit is ${MAX_UPLOAD_GB} GB.`,
      );
    }
    if (body.durationSec > MAX_DURATION_SECONDS) {
      throw new HttpError(
        413,
        "too-long",
        `That recording is ${(body.durationSec / 3600).toFixed(1)} hours long. The limit is 4 hours.`,
      );
    }

    await consumeUploadSlot(user.id);

    const recording = await prisma.recording.create({
      data: {
        projectId,
        assignedToId: user.id,
        filename: body.filename,
        mimeType: body.mimeType || "application/octet-stream",
        byteSize: BigInt(body.byteSize),
        durationSec: body.durationSec,
        kind: inferMediaKind(body.filename),
        storageKey: "pending",
        storageLocation: plannedStorageLocation(body.byteSize),
        status: "UPLOADED",
      },
    });

    const storageKey = storageKeyFor(projectId, recording.id, body.filename);
    await prisma.recording.update({
      where: { id: recording.id },
      data: { storageKey },
    });

    return json({ id: recording.id, projectId, storageKey }, { status: 201 });
  });
}
