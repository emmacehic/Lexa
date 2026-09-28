import { redirect } from "next/navigation";

import { assertRecordingAccess, currentUser } from "@/lib/authz";
import { ExportSheetRoute } from "@/components/ExportSheet";

export const dynamic = "force-dynamic";

/**
 * The direct-navigation fallback for /r/[id]/export. Reaching this URL from
 * inside the workspace intercepts into the sheet slot instead.
 */
export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  await assertRecordingAccess(id, user);
  return <ExportSheetRoute recordingId={id} standalone />;
}
