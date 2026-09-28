import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { HttpError, requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const createSchema = z.object({
  recordingId: z.string().min(1),
  projectId: z.string().min(1),
  name: z.string().min(1).max(100),
  dominantLanguage: z.string().min(1).max(100),
  heritageLanguage: z.string().min(1).max(100),
  mainLanguage: z.string().max(100).nullable().optional(),
  ageGroup: z.string().max(30).nullable().optional(),
  gender: z.string().max(30).nullable().optional(),
  otherLanguages: z.array(z.string().max(100)).optional().default([]),
  bilingualStatus: z.string().max(60).nullable().optional(),
  countryOrRegion: z.string().max(10).nullable().optional(),
  currentCountry: z.string().max(10).nullable().optional(),
  generation: z.string().max(30).nullable().optional(),
  languageAtHome: z.string().max(200).nullable().optional(),
  speakerRole: z.string().max(60).nullable().optional(),
  metadataSource: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Creates a speaker and links it to a recording.
 * Called by the metadata wizard after upload. Speaker ID, dominant and
 * heritage language are required; remaining columns stay null unless supplied.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await parseBody(request, createSchema);

    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, projectId: body.projectId },
    });
    if (!membership) {
      throw new HttpError(403, "not-a-member", "You are not a member of this project.");
    }

    const recording = await prisma.recording.findUnique({
      where: { id: body.recordingId },
      select: { id: true, projectId: true },
    });
    if (!recording || recording.projectId !== body.projectId) {
      throw new HttpError(404, "recording-not-found", "That recording does not exist in this project.");
    }

    const speaker = await prisma.speaker.create({
      data: {
        projectId: body.projectId,
        name: body.name,
        ageGroup: body.ageGroup ?? null,
        gender: body.gender ?? null,
        mainLanguage: body.mainLanguage ?? body.dominantLanguage,
        otherLanguages: body.otherLanguages,
        dominantLanguage: body.dominantLanguage,
        bilingualStatus: body.bilingualStatus ?? null,
        heritageLanguage: body.heritageLanguage,
        countryOrRegion: body.countryOrRegion ?? null,
        currentCountry: body.currentCountry ?? null,
        generation: body.generation ?? null,
        languageAtHome: body.languageAtHome ?? null,
        speakerRole: body.speakerRole ?? null,
        metadataSource: body.metadataSource ?? null,
        notes: body.notes ?? null,
      },
    });

    await prisma.recording.update({
      where: { id: body.recordingId },
      data: { speakerId: speaker.id },
    });

    return json({ id: speaker.id }, { status: 201 });
  });
}
