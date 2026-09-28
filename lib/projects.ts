import { HttpError, type SessionUser } from "./authz";
import { defaultAnnotationGuidelines } from "./default-guidelines";
import { assertProjectNameAvailable, findProjectByNameInsensitive } from "./project-names";
import { prisma } from "./prisma";

/** Default recognizer languages for a project created at upload time. */
export const DEFAULT_LANGUAGE_CODES = ["bs-BA", "de-CH", "en-US"];

/**
 * Find a project the user already belongs to with this name, or create one
 * and add them. Admins match any existing project of that name.
 */
export async function resolveOrCreateProject(
  user: SessionUser,
  rawName: string,
): Promise<string> {
  const name = rawName.trim();
  if (!name) {
    throw new HttpError(
      400,
      "project-name-required",
      "Name the project this recording belongs to.",
    );
  }

  const existing = await findProjectByNameInsensitive(name);

  if (existing) {
    await prisma.membership.upsert({
      where: { userId_projectId: { userId: user.id, projectId: existing.id } },
      create: { userId: user.id, projectId: existing.id },
      update: {},
    });
    return existing.id;
  }

  await assertProjectNameAvailable(name);

  const project = await prisma.project.create({
    data: {
      name,
      languageCodes: [...DEFAULT_LANGUAGE_CODES],
      customLabels: [],
      guidelines: defaultAnnotationGuidelines(),
      members: { create: { userId: user.id } },
    },
  });
  return project.id;
}
