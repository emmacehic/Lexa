import { prisma } from "../lib/prisma";

const rows = await prisma.recording.findMany({
  orderBy: { createdAt: "desc" },
  take: 10,
  select: {
    id: true,
    filename: true,
    status: true,
    createdAt: true,
    byteSize: true,
    storageKey: true,
  },
});

console.log("Recent recordings:");
for (const row of rows) {
  console.log(
    `${row.createdAt.toISOString()} ${row.status} ${row.filename} ${row.byteSize} ${row.storageKey}`,
  );
}

const events = await prisma.uploadEvent.count({
  where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
});
console.log(`Upload events in last hour: ${events}`);

await prisma.$disconnect();
