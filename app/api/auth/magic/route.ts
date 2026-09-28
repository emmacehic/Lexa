import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { generateToken, hashToken } from "@/lib/hash";
import { sendMagicLink } from "@/lib/mail";
import { env } from "@/lib/env";

const schema = z.object({ email: z.string().email() });

export const runtime = "nodejs";

/**
 * Request a magic link. The response is identical whether or not the address
 * belongs to an account — an invitation-only platform should not confirm who
 * is a member.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const { email } = await parseBody(request, schema);
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true },
    });

    if (user) {
      const token = generateToken();
      await prisma.magicLinkToken.create({
        data: {
          tokenHash: hashToken(token),
          userId: user.id,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      const url = `${env().AUTH_URL}/login/link?token=${encodeURIComponent(token)}`;
      await sendMagicLink(user.email, url);
    }

    return json({ ok: true });
  });
}
