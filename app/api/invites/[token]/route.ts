import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { HttpError } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { hashPassword, hashToken } from "@/lib/hash";

const acceptSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
});

export const runtime = "nodejs";

async function loadInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { project: { select: { id: true, name: true } } },
  });
  if (!invite) {
    throw new HttpError(404, "invite-not-found", "That invitation link is not valid.");
  }
  if (invite.acceptedAt) {
    throw new HttpError(
      409,
      "invite-used",
      "That invitation has already been used. Ask your project admin for a new one.",
    );
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    throw new HttpError(
      410,
      "invite-expired",
      "That invitation has expired. Ask your project admin for a new one.",
    );
  }
  return invite;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handle(async () => {
    const { token } = await params;
    const invite = await loadInvite(token);
    return json({
      projectName: invite.project.name,
      email: invite.email,
      role: invite.role,
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return handle(async () => {
    const { token } = await params;
    const invite = await loadInvite(token);
    const body = await parseBody(request, acceptSchema);

    const email = body.email.toLowerCase();
    if (invite.email && invite.email.toLowerCase() !== email) {
      throw new HttpError(
        409,
        "invite-email-mismatch",
        `This invitation was issued for ${invite.email}. Sign up with that address, or ask for a new invitation.`,
      );
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(
        409,
        "email-taken",
        "An account with that address already exists. Sign in instead.",
      );
    }

    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: body.name,
          passwordHash: await hashPassword(body.password),
          role: invite.role,
        },
      });
      await tx.membership.create({
        data: { userId: created.id, projectId: invite.projectId },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedBy: created.id },
      });
      return created;
    });

    return json({ ok: true, email: user.email });
  });
}
