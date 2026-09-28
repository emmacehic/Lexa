import { prisma } from "../lib/prisma";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const queue = new Queue("lexa-transcribe", { connection: redis });

const stuck = await prisma.recording.findMany({
  where: { status: { in: ["PROCESSING", "UPLOADED"] } },
  orderBy: { createdAt: "desc" },
  select: { id: true, filename: true, status: true, stage: true, createdAt: true },
});

console.log("Recordings waiting:");
for (const row of stuck) {
  console.log(`${row.createdAt.toISOString()} ${row.status} ${row.stage ?? "-"} ${row.filename} ${row.id}`);
}

const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
console.log("Queue:", counts);

const failed = await queue.getFailed(0, 5);
for (const job of failed) {
  console.log(`Failed job ${job.id}: ${job.failedReason}`);
}

await queue.close();
await redis.quit();
await prisma.$disconnect();
