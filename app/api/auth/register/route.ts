import { randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { HttpError } from "@/lib/authz";
import { hashPassword } from "@/lib/hash";
import { prisma } from "@/lib/prisma";
import {
  PROFICIENCY_LEVELS,
  type UserLanguageEntry,
} from "@/lib/user-languages";
import {
  WHISPER_LANGUAGE_MAX,
  WHISPER_LANGUAGES,
} from "@/lib/whisper-languages";

export const runtime = "nodejs";

const whisperCodes = new Set(WHISPER_LANGUAGES.map((l) => l.code));

const registerSchema = z.object({
  name: z.string().min(1, "Name is required.").max(200),
  password: z.string().min(10, "Password must be at least 10 characters."),
  languages: z
    .array(
      z.object({
        code: z.string().min(2).max(8),
        proficiency: z.enum(PROFICIENCY_LEVELS),
      }),
    )
    .max(WHISPER_LANGUAGE_MAX)
    .default([]),
});

export async function POST(request: Request) {
  return handle(async () => {
    const body = await parseBody(request, registerSchema);
    const name = body.name.trim();

    const nameTaken = await prisma.user.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (nameTaken) {
      throw new HttpError(
        409,
        "name-taken",
        "That name is already in use. Add a last name, or a number, and try again.",
      );
    }

    const seen = new Set<string>();
    const languageProficiency: UserLanguageEntry[] = [];
    for (const entry of body.languages) {
      const code = entry.code.split("-")[0]?.toLowerCase() ?? "";
      if (!whisperCodes.has(code) || seen.has(code)) continue;
      seen.add(code);
      languageProficiency.push({ code, proficiency: entry.proficiency });
    }

    const spokenLanguages = languageProficiency.map((entry) => entry.code);

    const passwordHash = await hashPassword(body.password);
    const email = `u-${randomBytes(8).toString("hex")}@local.lexa`;

    const user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: "CONTRIBUTOR",
        spokenLanguages,
        languageProficiency: languageProficiency as unknown as Prisma.InputJsonValue,
      },
    });

    return json({ id: user.id }, { status: 201 });
  });
}
