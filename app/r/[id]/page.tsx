import { notFound, redirect } from "next/navigation";

import { assertRecordingAccess, currentUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { canDeleteRecording } from "@/lib/recording-delete";
import { transcriptDTO } from "@/lib/recordings";
import { Workspace } from "@/components/workspace/WorkspaceClient";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  await assertRecordingAccess(id, user);

  const status = await prisma.recording.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!status) notFound();
  if (status.status !== "READY" && status.status !== "COMPLETE") {
    redirect(`/r/${id}/processing`);
  }

  const transcript = await transcriptDTO(id, user.id);
  return (
    <Workspace
      transcript={transcript}
      canDelete={canDeleteRecording(status.status, user.role)}
    />
  );
}
