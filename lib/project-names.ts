import { HttpError } from "./authz";
import { prisma } from "./prisma";

export async function findProjectByNameInsensitive(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return prisma.project.findFirst({
    where: { name: { equals: trimmed, mode: "insensitive" } },
    select: { id: true, name: true, languageCodes: true },
  });
}

/** Reject a name that differs only by capitalisation from an existing project. */
export async function assertProjectNameAvailable(
  name: string,
  excludeId?: string,
): Promise<void> {
  const existing = await findProjectByNameInsensitive(name);
  if (existing && existing.id !== excludeId) {
    throw new HttpError(
      409,
      "project-name-taken",
      `A project named “${existing.name}” already exists (${existing.languageCodes.join(", ")}). Names are unique regardless of capitalisation — use that project or pick a different name.`,
    );
  }
}
