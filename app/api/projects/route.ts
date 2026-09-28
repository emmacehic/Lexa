import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { requireAdmin, requireUser, visibleProjectIds } from "@/lib/authz";
import { defaultAnnotationGuidelines } from "@/lib/default-guidelines";
import { assertProjectNameAvailable } from "@/lib/project-names";
import { prisma } from "@/lib/prisma";
import { WHISPER_LANGUAGE_MAX } from "@/lib/whisper-languages";

const createSchema = z.object({
  name: z.string().min(1).max(160),
  languageCodes: z
    .array(z.string().min(2).max(35))
    .min(1, "A project needs at least one language.")
    .max(
      WHISPER_LANGUAGE_MAX,
      `A project can name at most ${WHISPER_LANGUAGE_MAX} languages (Whisper's set).`,
    ),
  customLabels: z
    .array(z.object({ type: z.string().min(1).max(64), label: z.string().min(1).max(64) }))
    .max(4)
    .default([]),
});

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const ids = await visibleProjectIds(user);
    const projects = await prisma.project.findMany({
      where: { id: { in: ids } },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { recordings: true, members: true } },
      },
    });
    return json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        languageCodes: p.languageCodes,
        customLabels: p.customLabels,
        recordingCount: p._count.recordings,
        memberCount: p._count.members,
      })),
    });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await parseBody(request, createSchema);
    await assertProjectNameAvailable(body.name);
    const project = await prisma.project.create({
      data: {
        name: body.name.trim(),
        languageCodes: body.languageCodes,
        customLabels: body.customLabels,
        guidelines: defaultAnnotationGuidelines(),
        members: { create: { userId: admin.id } },
      },
    });
    return json({ id: project.id }, { status: 201 });
  });
}
