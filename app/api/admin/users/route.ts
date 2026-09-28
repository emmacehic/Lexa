import { handle, json } from "@/lib/api";
import { loadUserWork } from "@/lib/admin-users";
import { requireAdmin } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();
    const projectId = new URL(request.url).searchParams.get("projectId");
    const users = await loadUserWork(projectId && projectId.length > 0 ? projectId : null);
    return json({ users });
  });
}
