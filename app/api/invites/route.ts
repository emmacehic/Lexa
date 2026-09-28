import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/hash";
import { env } from "@/lib/env";

const schema = z.object({
  projectId: z.string().min(1),
  email: z.string().email().nullable().optional(),
  role: z.enum(["ADMIN", "CONTRIBUTOR"]).default("CONTRIBUTOR"),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireAdmin();
    const invites = await prisma.invite.findMany({
      orderBy: { createdAt: "desc" },
      include: { project: { select: { name: true } } },
      take: 100,
    });
    return json({
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        projectId: i.projectId,
        projectName: i.project.name,
        expiresAt: i.expiresAt.toISOString(),
        acceptedAt: i.acceptedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    });
  });
}

/** Invitation-only registration (§3): only an admin can open the door. */
export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin();
    const body = await parseBody(request, schema);

    const token = generateToken();
    const invite = await prisma.invite.create({
      data: {
        tokenHash: hashToken(token),
        email: body.email ?? null,
        projectId: body.projectId,
        role: body.role,
        createdById: admin.id,
        expiresAt: new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000),
      },
    });

    return json({
      id: invite.id,
      url: `${env().AUTH_URL}/invite/${token}`,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });
}
