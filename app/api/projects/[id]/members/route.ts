import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { HttpError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const bodySchema = z.object({ userId: z.string().min(1) });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const members = await prisma.membership.findMany({
      where: { projectId: id },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { user: { name: "asc" } },
    });
    return json({ members: members.map((m) => m.user) });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const { userId } = await parseBody(request, bodySchema);
    await prisma.membership.upsert({
      where: { userId_projectId: { userId, projectId: id } },
      create: { userId, projectId: id },
      update: {},
    });
    return json({ ok: true });
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId) {
      throw new HttpError(400, "missing-user", "Which member should be removed?");
    }
    const assigned = await prisma.recording.count({
      where: { projectId: id, assignedToId: userId },
    });
    if (assigned > 0) {
      throw new HttpError(
        409,
        "member-has-recordings",
        `That contributor still has ${assigned} recording${assigned === 1 ? "" : "s"} assigned in this project. Reassign them first.`,
      );
    }
    await prisma.membership.deleteMany({ where: { projectId: id, userId } });
    return json({ ok: true });
  });
}
