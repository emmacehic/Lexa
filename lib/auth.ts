import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

import { prisma } from "./prisma";
import { hashToken, verifyPassword } from "./hash";
import { env } from "./env";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "ADMIN" | "CONTRIBUTOR";
    } & DefaultSession["user"];
  }
  interface User {
    role?: "ADMIN" | "CONTRIBUTOR";
  }
}

const THIRTY_DAYS = 30 * 24 * 60 * 60;

const passwordSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const magicSchema = z.object({
  token: z.string().min(16),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: THIRTY_DAYS,
    // sliding: the cookie is re-issued whenever it is more than a day old
    updateAge: 24 * 60 * 60,
  },
  jwt: { maxAge: THIRTY_DAYS },
  cookies: {
    sessionToken: {
      name:
        env().AUTH_URL.startsWith("https://")
          ? "__Secure-authjs.session-token"
          : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: env().AUTH_URL.startsWith("https://"),
      },
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = passwordSchema.safeParse(raw);
        if (!parsed.success) return null;

        const identifier = parsed.data.email.trim();
        const user = identifier.includes("@")
          ? await prisma.user.findUnique({
              where: { email: identifier.toLowerCase() },
            })
          : await prisma.user.findFirst({
              where: { name: { equals: identifier, mode: "insensitive" } },
            });
        if (!user?.passwordHash) return null;

        const ok = await verifyPassword(user.passwordHash, parsed.data.password);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
    Credentials({
      id: "magic",
      name: "Magic link",
      credentials: { token: { label: "Token", type: "text" } },
      async authorize(raw) {
        const parsed = magicSchema.safeParse(raw);
        if (!parsed.success) return null;

        const record = await prisma.magicLinkToken.findUnique({
          where: { tokenHash: hashToken(parsed.data.token) },
          include: { user: true },
        });
        if (!record) return null;
        if (record.usedAt) return null;
        if (record.expiresAt.getTime() < Date.now()) return null;

        await prisma.magicLinkToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });

        return {
          id: record.user.id,
          email: record.user.email,
          name: record.user.name,
          role: record.user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.role = user.role ?? "CONTRIBUTOR";
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.role = (token.role as "ADMIN" | "CONTRIBUTOR") ?? "CONTRIBUTOR";
      return session;
    },
  },
});
