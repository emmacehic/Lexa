import type { Role } from "@prisma/client";

/**
 * Anyone with write access may remove a recording that is not locked
 * complete. COMPLETE stays admin-only so a finished corpus cannot be
 * wiped by a contributor.
 */
export function canDeleteRecording(status: string, role: Role): boolean {
  if (role === "ADMIN") return true;
  return status !== "COMPLETE";
}

export const DELETE_CONFIRM_MESSAGE =
  "This permanently removes the recording, its transcript, and every annotation. It cannot be undone.";
