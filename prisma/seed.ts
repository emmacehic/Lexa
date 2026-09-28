import { randomBytes } from "node:crypto";

import { prisma } from "../lib/prisma";
import { hashPassword } from "../lib/hash";
import { env } from "../lib/env";
import { defaultAnnotationGuidelines, clearGuidelinesCache } from "../lib/default-guidelines";
import { CODE_SWITCH, LOANWORD } from "../lib/labels";

/**
 * Seeds the admin account (§1.6). Projects are created when someone uploads
 * a recording and names them in the metadata wizard.
 */
async function main(): Promise<void> {
  const config = env();
  const email = config.SEED_ADMIN_EMAIL.toLowerCase();

  const generated = config.SEED_ADMIN_PASSWORD
    ? null
    : randomBytes(12).toString("base64url");
  const password = config.SEED_ADMIN_PASSWORD ?? generated!;

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "ADMIN", name: config.SEED_ADMIN_NAME, passwordHash },
    create: {
      email,
      name: config.SEED_ADMIN_NAME,
      role: "ADMIN",
      passwordHash,
    },
  });

  const leftovers = await prisma.project.findMany({
    where: { name: { equals: "Fieldwork", mode: "insensitive" } },
    include: { _count: { select: { recordings: true } } },
  });
  for (const project of leftovers) {
    if (project._count.recordings === 0) {
      await prisma.project.delete({ where: { id: project.id } });
    }
  }

  clearGuidelinesCache();
  const guidelines = defaultAnnotationGuidelines();
  await prisma.project.updateMany({ data: { guidelines } });

  console.log("");
  console.log("  Lexa is seeded.");
  console.log(`  Admin      ${admin.email}`);
  if (generated) {
    console.log(`  Password   ${generated}`);
    console.log("             (generated because SEED_ADMIN_PASSWORD was empty —");
    console.log("              change it after the first sign-in)");
  } else {
    console.log("  Password   the value of SEED_ADMIN_PASSWORD in .env.local");
  }
  console.log("  Projects   created at upload, when the recording is named");
  console.log(`  Labels     ${LOANWORD}, ${CODE_SWITCH}`);
  console.log("");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
