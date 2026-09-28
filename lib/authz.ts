import { auth } from "./auth";
import { prisma } from "./prisma";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "CONTRIBUTOR";
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: unknown;

  constructor(status: number, code: string, message: string, detail?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const row = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new HttpError(403, "forbidden", "This area is for project admins.");
  }
  return user;
}

export async function assertProjectMember(
  projectId: string,
  user: SessionUser,
): Promise<void> {
  if (user.role === "ADMIN") return;
  const membership = await prisma.membership.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
    select: { id: true },
  });
  if (!membership) {
    throw new HttpError(
      403,
      "not-a-member",
      "You are not a member of this project.",
    );
  }
}

export interface RecordingAccess {
  id: string;
  projectId: string;
  assignedToId: string | null;
  status: string;
}

/**
 * Every API route that touches a recording goes through here. A contributor
 * only ever sees recordings inside the projects they belong to (§3).
 */
export async function assertRecordingAccess(
  recordingId: string,
  user: SessionUser,
  options: { write?: boolean } = {},
): Promise<RecordingAccess> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { id: true, projectId: true, assignedToId: true, status: true },
  });
  if (!recording) {
    throw new HttpError(404, "not-found", "That recording does not exist.");
  }
  await assertProjectMember(recording.projectId, user);

  if (options.write && recording.status === "COMPLETE" && user.role !== "ADMIN") {
    throw new HttpError(
      409,
      "locked",
      "This recording is locked as complete. Ask an admin to reopen it.",
    );
  }

  return recording;
}

export async function visibleProjectIds(user: SessionUser): Promise<string[]> {
  if (user.role === "ADMIN") {
    const all = await prisma.project.findMany({ select: { id: true } });
    return all.map((p) => p.id);
  }
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { projectId: true },
  });
  return memberships.map((m) => m.projectId);
}
