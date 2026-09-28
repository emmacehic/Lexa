import { redirect } from "next/navigation";

import { assertRecordingAccess, currentUser } from "@/lib/authz";
import { CorpusPreview } from "@/components/CorpusPreview";

export const dynamic = "force-dynamic";

export default async function CorpusPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  await assertRecordingAccess(id, user);
  return <CorpusPreview recordingId={id} />;
}
