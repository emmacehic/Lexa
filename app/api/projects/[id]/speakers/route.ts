import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { HttpError, requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  ageGroup: z.string().max(30).nullable().optional(),
  gender: z.string().max(30).nullable().optional(),
  mainLanguage: z.string().max(100).nullable().optional(),
  otherLanguages: z.array(z.string().max(100)).max(10).default([]),
  dominantLanguage: z.string().max(100).nullable().optional(),
  bilingualStatus: z.string().max(60).nullable().optional(),
  heritageLanguage: z.string().max(100).nullable().optional(),
  countryOrRegion: z.string().max(10).nullable().optional(),
  currentCountry: z.string().max(10).nullable().optional(),
  generation: z.string().max(30).nullable().optional(),
  languageAtHome: z.string().max(200).nullable().optional(),
  speakerRole: z.string().max(60).nullable().optional(),
  metadataSource: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const patchSchema = z.object({
  speakerId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  ageGroup: z.string().max(30).nullable().optional(),
  gender: z.string().max(30).nullable().optional(),
  mainLanguage: z.string().max(100).nullable().optional(),
  otherLanguages: z.array(z.string().max(100)).max(10).optional(),
  dominantLanguage: z.string().max(100).nullable().optional(),
  bilingualStatus: z.string().max(60).nullable().optional(),
  heritageLanguage: z.string().max(100).nullable().optional(),
  countryOrRegion: z.string().max(10).nullable().optional(),
  currentCountry: z.string().max(10).nullable().optional(),
  generation: z.string().max(30).nullable().optional(),
  languageAtHome: z.string().max(200).nullable().optional(),
  speakerRole: z.string().max(60).nullable().optional(),
  metadataSource: z.string().max(60).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const speakers = await prisma.speaker.findMany({
      where: { projectId: id },
      orderBy: { name: "asc" },
      include: { _count: { select: { recordings: true } } },
    });
    return json({
      speakers: speakers.map((s) => ({
        id: s.id,
        name: s.name,
        ageGroup: s.ageGroup,
        gender: s.gender,
        mainLanguage: s.mainLanguage,
        otherLanguages: s.otherLanguages,
        dominantLanguage: s.dominantLanguage,
        bilingualStatus: s.bilingualStatus,
        heritageLanguage: s.heritageLanguage,
        countryOrRegion: s.countryOrRegion,
        currentCountry: s.currentCountry,
        generation: s.generation,
        languageAtHome: s.languageAtHome,
        speakerRole: s.speakerRole,
        metadataSource: s.metadataSource,
        notes: s.notes,
        recordingCount: s._count.recordings,
      })),
    });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const body = await parseBody(request, createSchema);
    const speaker = await prisma.speaker.create({
      data: {
        projectId: id,
        name: body.name,
        ageGroup: body.ageGroup ?? null,
        gender: body.gender ?? null,
        mainLanguage: body.mainLanguage ?? null,
        otherLanguages: body.otherLanguages,
        dominantLanguage: body.dominantLanguage ?? null,
        bilingualStatus: body.bilingualStatus ?? null,
        heritageLanguage: body.heritageLanguage ?? null,
        countryOrRegion: body.countryOrRegion ?? null,
        currentCountry: body.currentCountry ?? null,
        generation: body.generation ?? null,
        languageAtHome: body.languageAtHome ?? null,
        speakerRole: body.speakerRole ?? null,
        metadataSource: body.metadataSource ?? null,
        notes: body.notes ?? null,
      },
    });
    return json({ id: speaker.id }, { status: 201 });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await params;
    const body = await parseBody(request, patchSchema);
    const speaker = await prisma.speaker.findFirst({
      where: { id: body.speakerId, projectId: id },
      select: { id: true },
    });
    if (!speaker) {
      throw new HttpError(404, "speaker-not-found", "That speaker is not in this project.");
    }
    const data: Record<string, unknown> = {};
    const fields = [
      "name", "ageGroup", "gender", "mainLanguage", "otherLanguages",
      "dominantLanguage", "bilingualStatus", "heritageLanguage",
      "countryOrRegion", "currentCountry", "generation",
      "languageAtHome", "speakerRole", "metadataSource", "notes",
    ] as const;
    for (const key of fields) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    await prisma.speaker.update({
      where: { id: body.speakerId },
      data,
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
    const speakerId = new URL(request.url).searchParams.get("speakerId");
    if (!speakerId) return json({ ok: false }, { status: 400 });
    const speaker = await prisma.speaker.findFirst({
      where: { id: speakerId, projectId: id },
      select: { id: true },
    });
    if (!speaker) {
      throw new HttpError(404, "speaker-not-found", "That speaker is not in this project.");
    }
    await prisma.speaker.delete({ where: { id: speakerId } });
    return json({ ok: true });
  });
}
