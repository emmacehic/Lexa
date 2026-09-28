import { prisma } from "../lib/prisma";
import { deleteProject } from "../lib/project-delete";

/**
 * One-off operator script: keep Test-01 as the sample project, remove the rest.
 * Run: npx tsx --env-file=.env.local scripts/keep-sample-project.ts
 */
async function main(): Promise<void> {
  const keep = await prisma.project.findFirst({
    where: { name: { equals: "Test-01", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!keep) {
    throw new Error('No project named "Test-01" found — nothing was deleted.');
  }

  const others = await prisma.project.findMany({
    where: { id: { not: keep.id } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  for (const project of others) {
    console.log(`Deleting ${project.name}…`);
    await deleteProject(project.id);
  }

  console.log(`Done. Sample project kept: ${keep.name} (${keep.id}).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
