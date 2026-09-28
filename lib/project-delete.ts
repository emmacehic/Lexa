import { HttpError } from "./authz";
import { DELETE_PROJECT_CONFIRM_MESSAGE } from "./project-delete-messages";
import { prisma } from "./prisma";
import { objectExists, removeObject } from "./storage";

export { DELETE_PROJECT_CONFIRM_MESSAGE };

/** Remove storage objects, then delete the project row (DB cascades the rest). */
export async function deleteProject(projectId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      recordings: { select: { storageKey: true, storageLocation: true } },
    },
  });
  if (!project) {
    throw new HttpError(404, "not-found", "That project does not exist.");
  }

  for (const recording of project.recordings) {
    try {
      await removeObject(recording.storageKey, recording.storageLocation);
    } catch (error) {
      const stillThere = await objectExists(recording.storageKey, recording.storageLocation);
      if (stillThere) {
        throw new HttpError(
          502,
          "storage-delete-failed",
          error instanceof Error
            ? error.message
            : "A recording file could not be deleted from storage. The project was left in place.",
        );
      }
    }
  }

  await prisma.project.delete({ where: { id: projectId } });
}
