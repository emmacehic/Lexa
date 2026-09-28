import { prisma } from "../lib/prisma";

const id = process.argv[2];
if (!id) {
  console.error("Usage: tsx scripts/check-recording.ts <recordingId>");
  process.exit(1);
}

const row = await prisma.recording.findUnique({
  where: { id },
  select: {
    filename: true,
    durationSec: true,
    progress: true,
    stage: true,
    status: true,
    byteSize: true,
    createdAt: true,
    refinementSkipped: true,
  },
});

console.log(
  JSON.stringify(
    row,
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
await prisma.$disconnect();
