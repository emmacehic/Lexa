import { z } from "zod";

import { handle, json, parseBody } from "@/lib/api";
import { assertRecordingAccess, requireUser } from "@/lib/authz";
import { redo, undo } from "@/lib/ops";

export const runtime = "nodejs";

const schema = z.object({ direction: z.enum(["undo", "redo"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user, { write: true });
    const { direction } = await parseBody(request, schema);
    const result =
      direction === "undo" ? await undo(id, user.id) : await redo(id, user.id);
    return json(result ?? { nothingToDo: true });
  });
}
