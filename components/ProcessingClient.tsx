"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { TranscriptionPipeline } from "@/components/TranscriptionPipeline";
import { DELETE_CONFIRM_MESSAGE } from "@/lib/recording-delete";
import { formatDuration } from "@/lib/time";
import { type RecordingStatusSnapshot } from "@/lib/transcription-status";

type StatusPayload = RecordingStatusSnapshot;

/**
 * §7 — the filename, one liquid progress bar and one line of live status text
 * that actually reflects the pipeline stage.
 */
export function ProcessingClient({
  recordingId,
  filename,
  initialStatus,
  initialStage,
  initialProgress,
  initialFailure,
  durationSec,
  canDelete,
}: {
  recordingId: string;
  filename: string;
  initialStatus: StatusPayload["status"];
  initialStage: string | null;
  initialProgress: number;
  initialFailure: string | null;
  durationSec: number;
  canDelete: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteRecording = async () => {
    setDeleting(true);
    setDeleteError(null);
    const response = await fetch(`/api/recordings/${recordingId}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setDeleteError(
        body?.error?.message ??
          "The transcription could not be deleted. The file was left in storage.",
      );
      setDeleting(false);
      return;
    }
    router.push("/library");
    router.refresh();
  };

  const deleteControls = canDelete ? (
    <button
      type="button"
      className="control"
      onClick={() => {
        setDeleteError(null);
        setConfirmDelete(true);
      }}
    >
      Delete
    </button>
  ) : null;

  const confirmDialog = (
    <ConfirmDeleteDialog
      open={confirmDelete}
      filename={filename}
      message={DELETE_CONFIRM_MESSAGE}
      deleting={deleting}
      error={deleteError}
      onCancel={() => {
        if (deleting) return;
        setConfirmDelete(false);
        setDeleteError(null);
      }}
      onConfirm={() => {
        void deleteRecording();
      }}
    />
  );

  const { data } = useQuery<StatusPayload>({
    queryKey: ["recording-status", recordingId],
    queryFn: async () => {
      const response = await fetch(`/api/recordings/${recordingId}/status`);
      if (!response.ok) throw new Error("status unavailable");
      return response.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "READY" || status === "COMPLETE" || status === "FAILED"
        ? false
        : 1500;
    },
    initialData: {
      status: initialStatus,
      progress: initialProgress,
      stage: initialStage,
      failureReason: initialFailure,
      filename,
      durationSec,
      refinementSkipped: false,
    },
  });

  useEffect(() => {
    if (data.status === "READY" || data.status === "COMPLETE") {
      router.replace(`/r/${recordingId}`);
    }
  }, [data.status, recordingId, router]);

  if (data.status === "FAILED") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <div
          className="glass glass-e2 w-full max-w-[520px] p-7"
          style={{ borderRadius: "var(--radius-panel)" }}
        >
          <h1 className="mb-1">Transcription failed.</h1>
          <p className="text-soft mb-1 text-[13px]">{filename}</p>
          <p className="mt-4 text-[14px] leading-relaxed">
            {data.failureReason ?? "The transcription job failed with no message."}
          </p>
          <p className="text-soft mt-2 text-[13px] leading-relaxed">
            {/web page|not a media file/i.test(data.failureReason ?? "")
              ? "Upload the original audio or video file, not a downloaded web page."
              : /whisper/i.test(data.failureReason ?? "")
                ? "Fix the Whisper server (API key in .env.local, then restart the worker) and press Try again."
                : "Try uploading the original file again, or contact your project admin."}
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              className="control control-primary"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true);
                await fetch(`/api/recordings/${recordingId}`, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ action: "retry" }),
                });
                await queryClient.invalidateQueries({
                  queryKey: ["recording-status", recordingId],
                });
                router.refresh();
                setRetrying(false);
              }}
            >
              {retrying ? "Queueing…" : "Try again"}
            </button>
            {deleteControls}
            <Link className="control" href="/library">
              Back to library
            </Link>
          </div>
          {confirmDialog}
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div
        className="glass glass-e2 w-full max-w-[480px] p-7"
        style={{ borderRadius: "var(--radius-panel)" }}
      >
        <p className="mb-1 text-center text-[15px] font-medium">{filename}</p>
        {data.durationSec > 0 ? (
          <p className="text-soft mb-5 text-center text-[12px]">
            {formatDuration(data.durationSec)} recording
          </p>
        ) : (
          <div className="mb-5" />
        )}

        <div
          className="glass glass-e1 relative mb-6 h-[6px] w-full overflow-hidden"
          style={{ borderRadius: 999 }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={data.progress}
          aria-label="Transcription progress"
        >
          <div
            className="absolute inset-y-0 left-0"
            style={{
              width: `${Math.max(4, data.progress)}%`,
              background:
                "linear-gradient(90deg, color-mix(in oklch, var(--accent) 55%, transparent), var(--accent))",
              borderRadius: 999,
              transition: "width 280ms var(--ease)",
            }}
          />
        </div>

        <TranscriptionPipeline
          status={data.status}
          stage={data.stage}
          progress={data.progress}
          durationSec={data.durationSec}
        />

        <div className="mt-8 flex justify-center gap-2">
          {deleteControls}
          <Link
            className="control control-plain text-[13px]"
            href="/library"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["library-rows"] });
              router.refresh();
            }}
          >
            Back to library
          </Link>
        </div>
        {confirmDialog}
      </div>
    </main>
  );
}
