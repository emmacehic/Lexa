import { handle, json, parseBody } from "@/lib/api";
import { assertRecordingAccess, requireUser } from "@/lib/authz";
import { applyOps, opsRequestSchema } from "@/lib/ops";

export const runtime = "nodejs";

/** One batched, ordered operation list, applied in a single transaction. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user, { write: true });
    const { ops } = await parseBody(request, opsRequestSchema);
    return json(await applyOps(id, user.id, ops));
  });
}
