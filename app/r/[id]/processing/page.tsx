import { notFound, redirect } from "next/navigation";

import { currentUser, assertRecordingAccess } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ProcessingClient } from "@/components/ProcessingClient";
import { canDeleteRecording } from "@/lib/recording-delete";

export const dynamic = "force-dynamic";

export default async function ProcessingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  await assertRecordingAccess(id, user);

  const recording = await prisma.recording.findUnique({
    where: { id },
    select: {
      filename: true,
      status: true,
      stage: true,
      progress: true,
      failureReason: true,
      durationSec: true,
    },
  });
  if (!recording) notFound();
  if (recording.status === "READY" || recording.status === "COMPLETE") {
    redirect(`/r/${id}`);
  }

  return (
    <ProcessingClient
      recordingId={id}
      filename={recording.filename}
      initialStatus={recording.status}
      initialStage={recording.stage}
      initialProgress={recording.progress}
      initialFailure={recording.failureReason}
      durationSec={recording.durationSec}
      canDelete={canDeleteRecording(recording.status, user.role)}
    />
  );
}
