import { AdminClient } from "@/components/admin/AdminClient";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      orderBy: { name: "asc" },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
        _count: { select: { recordings: true } },
      },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <AdminClient
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        languageCodes: p.languageCodes,
        customLabels: (Array.isArray(p.customLabels) ? p.customLabels : []) as { type: string; label: string }[],
        recordingCount: p._count.recordings,
        members: p.members.map((m) => m.user),
      }))}
      users={users}
    />
  );
}
