import { CORRECTION, resolveLabel } from "./labels";
import { prisma } from "./prisma";

export interface UserWorkItem {
  at: string;
  summary: string;
  recordingId: string;
  filename: string;
}

export interface UserWork {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "CONTRIBUTOR";
  joinedAt: string;
  lastActiveAt: string | null;
  assignedCount: number;
  assigned: { id: string; filename: string; status: string }[];
  annotationCount: number;
  annotationsByType: { type: string; label: string; count: number }[];
  editCount: number;
  recent: UserWorkItem[];
}

const RECENT_FETCH = 400;
const RECENT_PER_USER = 12;
const ASSIGNED_CAP = 20;

const KIND_SUMMARY: Record<string, string> = {
  "segment.edit": "Edited a segment",
  "segment.split": "Split a segment",
  "segment.merge": "Merged segments",
  "segment.timing": "Adjusted timing",
  "segment.review": "Marked a segment reviewed",
  "ann.create": "Added an annotation",
  "ann.update": "Updated an annotation",
  "ann.delete": "Removed an annotation",
  "ann.reattach": "Re-attached an annotation",
};

function annotationSummary(
  type: string,
  surface: string,
  nativeAlternative: string | null,
): string {
  if (type === CORRECTION) {
    const corrected = nativeAlternative?.trim();
    return corrected
      ? `Corrected “${surface}” → “${corrected}”`
      : `Corrected “${surface}”`;
  }
  const label = resolveLabel(type, []).label.toLowerCase();
  return `Marked ${label} “${surface}”`;
}

export async function loadUserWork(projectId: string | null): Promise<UserWork[]> {
  const recordingFilter = projectId ? { projectId } : {};
  const viaRecording = projectId ? { recording: { projectId } } : {};

  const [users, annotationGroups, revisionGroups, assignedCounts, assignedRows, revisions, annotations] =
    await Promise.all([
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { name: "asc" },
      }),
      prisma.annotation.groupBy({
        by: ["createdById", "type"],
        where: viaRecording,
        _count: { _all: true },
      }),
      prisma.revision.groupBy({
        by: ["userId"],
        where: viaRecording,
        _count: { _all: true },
      }),
      prisma.recording.groupBy({
        by: ["assignedToId"],
        where: { ...recordingFilter, assignedToId: { not: null } },
        _count: { _all: true },
      }),
      prisma.recording.findMany({
        where: { ...recordingFilter, assignedToId: { not: null } },
        select: {
          id: true,
          filename: true,
          status: true,
          assignedToId: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.revision.findMany({
        where: viaRecording,
        orderBy: { createdAt: "desc" },
        take: RECENT_FETCH,
        select: {
          userId: true,
          kind: true,
          createdAt: true,
          recording: { select: { id: true, filename: true } },
        },
      }),
      prisma.annotation.findMany({
        where: viaRecording,
        orderBy: { createdAt: "desc" },
        take: RECENT_FETCH,
        select: {
          createdById: true,
          type: true,
          surface: true,
          nativeAlternative: true,
          createdAt: true,
          recording: { select: { id: true, filename: true } },
        },
      }),
    ]);

  const annotationsByUser = new Map<string, { type: string; label: string; count: number }[]>();
  const annotationCountByUser = new Map<string, number>();
  for (const row of annotationGroups) {
    const list = annotationsByUser.get(row.createdById) ?? [];
    list.push({
      type: row.type,
      label: resolveLabel(row.type, []).label,
      count: row._count._all,
    });
    annotationsByUser.set(row.createdById, list);
    annotationCountByUser.set(
      row.createdById,
      (annotationCountByUser.get(row.createdById) ?? 0) + row._count._all,
    );
  }
  for (const list of annotationsByUser.values()) {
    list.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  const editsByUser = new Map(revisionGroups.map((r) => [r.userId, r._count._all]));
  const assignedCountByUser = new Map(
    assignedCounts
      .filter((r): r is typeof r & { assignedToId: string } => r.assignedToId !== null)
      .map((r) => [r.assignedToId, r._count._all]),
  );

  const assignedByUser = new Map<
    string,
    { id: string; filename: string; status: string }[]
  >();
  for (const rec of assignedRows) {
    if (!rec.assignedToId) continue;
    const list = assignedByUser.get(rec.assignedToId) ?? [];
    if (list.length < ASSIGNED_CAP) {
      list.push({ id: rec.id, filename: rec.filename, status: rec.status });
    }
    assignedByUser.set(rec.assignedToId, list);
  }

  type RawItem = {
    userId: string;
    at: Date;
    summary: string;
    recordingId: string;
    filename: string;
  };
  const raw: RawItem[] = [];
  for (const rev of revisions) {
    raw.push({
      userId: rev.userId,
      at: rev.createdAt,
      summary: KIND_SUMMARY[rev.kind] ?? rev.kind,
      recordingId: rev.recording.id,
      filename: rev.recording.filename,
    });
  }
  for (const ann of annotations) {
    raw.push({
      userId: ann.createdById,
      at: ann.createdAt,
      summary: annotationSummary(ann.type, ann.surface, ann.nativeAlternative),
      recordingId: ann.recording.id,
      filename: ann.recording.filename,
    });
  }
  raw.sort((a, b) => b.at.getTime() - a.at.getTime());

  const recentByUser = new Map<string, UserWorkItem[]>();
  const lastActive = new Map<string, Date>();
  for (const item of raw) {
    const previous = lastActive.get(item.userId);
    if (!previous || item.at > previous) lastActive.set(item.userId, item.at);
    const list = recentByUser.get(item.userId) ?? [];
    if (list.length < RECENT_PER_USER) {
      list.push({
        at: item.at.toISOString(),
        summary: item.summary,
        recordingId: item.recordingId,
        filename: item.filename,
      });
      recentByUser.set(item.userId, list);
    }
  }

  return users.map((user) => {
    const assigned = assignedByUser.get(user.id) ?? [];
    const last = lastActive.get(user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      joinedAt: user.createdAt.toISOString(),
      lastActiveAt: last ? last.toISOString() : null,
      assignedCount: assignedCountByUser.get(user.id) ?? 0,
      assigned,
      annotationCount: annotationCountByUser.get(user.id) ?? 0,
      annotationsByType: annotationsByUser.get(user.id) ?? [],
      editCount: editsByUser.get(user.id) ?? 0,
      recent: recentByUser.get(user.id) ?? [],
    };
  });
}
