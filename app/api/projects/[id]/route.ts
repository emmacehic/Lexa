import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { assertProjectNameAvailable } from "@/lib/project-names";
import { deleteProject } from "@/lib/project-delete";
import { prisma } from "@/lib/prisma";
import { WHISPER_LANGUAGE_MAX } from "@/lib/whisper-languages";

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  languageCodes: z.array(z.string().min(2).max(35)).min(1).max(WHISPER_LANGUAGE_MAX).optional(),
  customLabels: z
    .array(z.object({ type: z.string().min(1).max(64), label: z.string().min(1).max(64) }))
    .max(4)
    .optional(),
  guidelines: z.string().max(50000).nullable().optional(),
});

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const body = await parseBody(request, patchSchema);
    if (body.name !== undefined) {
      await assertProjectNameAvailable(body.name, id);
    }
    await prisma.project.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.languageCodes !== undefined
          ? { languageCodes: body.languageCodes }
          : {}),
        ...(body.customLabels !== undefined
          ? { customLabels: body.customLabels }
          : {}),
        ...(body.guidelines !== undefined
          ? { guidelines: body.guidelines }
          : {}),
      },
    });
    return json({ ok: true });
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    await deleteProject(id);
    return json({ ok: true });
  });
}
