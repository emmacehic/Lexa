import { prisma } from "./prisma";
import { HttpError } from "./authz";

/** 10 uploads per hour per user (§13). Counted in Postgres — no extra infra. */
export const UPLOADS_PER_HOUR = 10;

export async function consumeUploadSlot(userId: string): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const used = await prisma.uploadEvent.count({
    where: { userId, createdAt: { gte: since } },
  });
  if (used >= UPLOADS_PER_HOUR) {
    throw new HttpError(
      429,
      "rate-limited",
      `You have started ${UPLOADS_PER_HOUR} uploads in the last hour, which is the limit. Try again shortly.`,
    );
  }
  await prisma.uploadEvent.create({ data: { userId } });
}
