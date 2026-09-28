import { handle, json } from "@/lib/api";
import { assertProjectMember, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertProjectMember(id, user);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id },
      select: { guidelines: true },
    });
    return json({ guidelines: project.guidelines });
  });
}
