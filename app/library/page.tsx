import { redirect } from "next/navigation";

import { currentUser, visibleProjectIds } from "@/lib/authz";
import { libraryRows } from "@/lib/recordings";
import { prisma } from "@/lib/prisma";
import { LibraryClient } from "@/components/LibraryClient";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const projectIds = await visibleProjectIds(user);
  const [rows, projects] = await Promise.all([
    libraryRows(projectIds),
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <LibraryClient
      rows={rows}
      projects={projects}
      isAdmin={user.role === "ADMIN"}
      userName={
        (user.name ?? "").replace(/^Lexa\s+/i, "").trim() || user.email
      }
    />
  );
}
