"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import type { TranscriptDTO } from "@/lib/dto";
import { jumpableAnnotations } from "@/lib/annotation-jump";
import { CODE_SWITCH, LOANWORD, UNCLEAR } from "@/lib/labels";
import { DELETE_CONFIRM_MESSAGE } from "@/lib/recording-delete";
import { AnnotationCountMenu } from "./AnnotationCountMenu";
import { Player } from "./Player";
import { ReviewTray } from "./ReviewTray";
import { ShortcutSheet } from "./ShortcutSheet";
import { Transcript } from "./Transcript";
import { WorkspaceProvider, useOpsQueue, useWorkspace, useWorkspaceStore } from "./context";
import { PlaybackContext, PlaybackEngine, SPEEDS, usePlayback } from "./playback";

export function Workspace({
  transcript,
  canDelete,
}: {
  transcript: TranscriptDTO;
  canDelete: boolean;
}) {
  const engineRef = useRef<PlaybackEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new PlaybackEngine();

  return (
    <WorkspaceProvider transcript={transcript}>
      <PlaybackContext.Provider value={engineRef.current}>
        <WorkspaceShell canDelete={canDelete} />
      </PlaybackContext.Provider>
    </WorkspaceProvider>
  );
}

function WorkspaceShell({ canDelete }: { canDelete: boolean }) {
  const recording = useWorkspace((s) => s.recording);
  const saveState = useWorkspace((s) => s.saveState);
  const error = useWorkspace((s) => s.error);
  const announcement = useWorkspace((s) => s.announcement);
  const store = useWorkspaceStore();
  const router = useRouter();
  const [shortcuts, setShortcuts] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useKeyboard(() => setShortcuts(true));

  const saveLabel =
    saveState === "saved"
      ? "Saved ✓"
      : saveState === "saving"
        ? "Saving…"
        : "Offline — changes kept locally";

  return (
    <div className="flex h-dvh flex-col">
      <header
        className="glass glass-e2 z-30 flex h-14 shrink-0 items-center gap-3 px-3"
        style={{ borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none" }}
      >
        <Link className="control control-plain" href="/library">
          ‹ Library
        </Link>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          <span className="text-soft">{recording.projectName} · </span>
          {recording.filename}
          {recording.speakerName ? (
            <span className="text-soft text-[12px]"> · {recording.speakerName}</span>
          ) : null}
        </span>
        <span
          className="text-[12px]"
          style={{
            color: saveState === "offline" ? "var(--loanword)" : "var(--text-secondary)",
          }}
        >
          {saveLabel}
        </span>
        <Link className="control" href={`/r/${recording.id}/corpus`}>
          Preview
        </Link>
        <a className="control" href={`/api/recordings/${recording.id}/download`}>
          Download
        </a>
        <ExportButton recordingId={recording.id} />
        {canDelete ? (
          <button
            type="button"
            className="control"
            aria-label={`Delete ${recording.filename}`}
            onClick={() => {
              setDeleteError(null);
              setConfirmDelete(true);
            }}
          >
            Delete
          </button>
        ) : null}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[58fr_42fr]">
        <div className="order-2 min-h-0 lg:order-1">
          <Transcript />
        </div>
        <div className="order-1 sticky top-14 z-20 p-3 lg:order-2 lg:self-start">
          <Player />
          <Legend />
        </div>
      </div>

      <ReviewTray />
      <ShortcutSheet open={shortcuts} onClose={() => setShortcuts(false)} />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p aria-live="polite" className="sr-only">
        {saveLabel}
      </p>

      <AnimatePresence>
        {error ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="glass glass-e3 fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 px-4 py-2.5"
            style={{ borderRadius: 9999 }}
            role="alert"
          >
            <span className="text-[13px]">{error}</span>
            <button
              className="control control-plain h-7"
              onClick={() => store.getState().setError(null)}
            >
              Dismiss
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDeleteDialog
        open={confirmDelete}
        filename={recording.filename}
        message={DELETE_CONFIRM_MESSAGE}
        deleting={deleting}
        error={deleteError}
        onCancel={() => {
          if (deleting) return;
          setConfirmDelete(false);
          setDeleteError(null);
        }}
        onConfirm={() => {
          void (async () => {
            setDeleting(true);
            setDeleteError(null);
            const response = await fetch(`/api/recordings/${recording.id}`, {
              method: "DELETE",
            });
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
          })();
        }}
      />
    </div>
  );
}

function ExportButton({ recordingId }: { recordingId: string }) {
  const router = useRouter();
  return (
    <button
      className="control"
      onClick={() => router.push(`/r/${recordingId}/export`)}
      title="Export ⌘E"
    >
      Export
    </button>
  );
}

function Legend() {
  const annotationsById = useWorkspace((s) => s.annotationsById);
  const segmentsById = useWorkspace((s) => s.segmentsById);

  const reviewed = useMemo(() => {
    const segments = Object.values(segmentsById);
    return {
      done: segments.filter((x) => x.isReviewed).length,
      total: segments.length,
    };
  }, [segmentsById]);

  const unclearCount = useMemo(
    () => jumpableAnnotations(Object.values(annotationsById), UNCLEAR).length,
    [annotationsById],
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
      <AnnotationCountMenu
        type={LOANWORD}
        label="loanwords"
        colorVar="--loanword"
      />
      <AnnotationCountMenu
        type={CODE_SWITCH}
        label="code-switches"
        colorVar="--codeswitch"
      />
      {unclearCount > 0 ? (
        <AnnotationCountMenu
          type={UNCLEAR}
          label="unclear"
          colorVar="--unclear"
        />
      ) : null}
      <span className="timecode ml-auto">
        {reviewed.done}/{reviewed.total} reviewed
      </span>
    </div>
  );
}

/** §12 — annotators live here. */
function useKeyboard(openShortcuts: () => void) {
  const store = useWorkspaceStore();
  const queue = useOpsQueue();
  const router = useRouter();
  const engine = usePlayback();

  const recordingId = useWorkspace((s) => s.recording.id);
  const locked = useWorkspace((s) => s.recording.status === "COMPLETE");

  const helpers = useMemo(
    () => ({
      segmentsInOrder: () => {
        const state = store.getState();
        return state.order
          .map((id) => state.segmentsById[id])
          .filter((s) => Boolean(s));
      },
    }),
    [store],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.code === "KeyF") {
        event.preventDefault();
        const field = document.getElementById("transcript-search");
        if (field instanceof HTMLInputElement) {
          field.focus();
          field.select();
        }
        return;
      }

      if (
        target &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      const state = store.getState();

      if (meta && event.code === "KeyE") {
        event.preventDefault();
        router.push(`/r/${recordingId}/export`);
        return;
      }
      if (meta && event.code === "KeyZ") {
        event.preventDefault();
        void queue.history(event.shiftKey ? "redo" : "undo");
        return;
      }
      if (event.key === "?" || (event.shiftKey && event.code === "Slash")) {
        event.preventDefault();
        openShortcuts();
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        engine.toggle();
        return;
      }

      if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
        const direction = event.code === "ArrowRight" ? 1 : -1;
        event.preventDefault();
        if (event.altKey) {
          stepWord(engine, helpers.segmentsInOrder(), direction);
        } else {
          engine.seekBy(direction * (event.shiftKey ? 10 : 2));
        }
        return;
      }

      if (event.code === "ArrowUp" || event.code === "ArrowDown") {
        event.preventDefault();
        const segments = helpers.segmentsInOrder();
        const current = segments.findIndex((s) => s.id === state.activeSegmentId);
        const next = Math.max(
          0,
          Math.min(segments.length - 1, current + (event.code === "ArrowDown" ? 1 : -1)),
        );
        const segment = segments[next];
        if (segment) {
          store.getState().setFollow(true);
          engine.seek(segment.start + 0.02);
          store.getState().setActiveSegment(segment.id);
        }
        return;
      }

      if (event.code.startsWith("Digit")) {
        const digit = Number(event.code.slice(5));
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          engine.setRate(SPEEDS[digit - 1]);
        }
        return;
      }

      if (locked) return;

      if (event.code === "KeyE" || event.code === "Enter") {
        event.preventDefault();
        if (state.activeSegmentId) store.getState().setEditing(state.activeSegmentId);
        return;
      }

      if (event.code === "KeyR") {
        event.preventDefault();
        const id = state.activeSegmentId;
        const segment = id ? state.segmentsById[id] : null;
        if (segment) {
          store.getState().patchSegmentReviewed(segment.id, !segment.isReviewed);
          queue.push({
            kind: "segment.review",
            segmentId: segment.id,
            isReviewed: !segment.isReviewed,
          });
          store
            .getState()
            .announce(segment.isReviewed ? "Marked as not reviewed" : "Marked as reviewed");
        }
        return;
      }

      if (event.altKey && (event.code === "KeyL" || event.code === "KeyC" || event.code === "KeyU")) {
        event.preventDefault();
        const selection = state.selection;
        if (!selection || selection.annotationId) return;
        const type = event.code === "KeyL" ? LOANWORD : event.code === "KeyC" ? CODE_SWITCH : UNCLEAR;
        store.getState().setPendingWizardType(type);
        return;
      }

      if (event.code === "Backspace") {
        const selection = state.selection;
        if (!selection) return;
        const targetId = selection.annotationId ?? selection.correctionId;
        if (targetId) {
          event.preventDefault();
          store.getState().removeAnnotationLocally(targetId);
          queue.push({ kind: "ann.delete", annotationId: targetId });
          store.getState().setSelection({
            ...selection,
            annotationId:
              selection.annotationId === targetId ? null : selection.annotationId,
            correctionId:
              selection.correctionId === targetId ? null : selection.correctionId,
          });
        }
        return;
      }

      if (event.code === "BracketLeft" || event.code === "BracketRight") {
        event.preventDefault();
        const id = state.activeSegmentId;
        if (!id) return;
        const field = event.code === "BracketLeft" ? "start" : "end";
        const time = Math.round(engine.currentTime * 1000) / 1000;
        void queue
          .sendNow([
            {
              kind: "segment.timing",
              segmentId: id,
              [field]: time,
              pushNeighbour: false,
            } as never,
          ])
          .catch(() =>
            queue
              .sendNow([
                {
                  kind: "segment.timing",
                  segmentId: id,
                  [field]: time,
                  pushNeighbour: true,
                } as never,
              ])
              .catch((cause: unknown) => {
                store
                  .getState()
                  .setError(
                    cause instanceof Error ? cause.message : "That timing was refused.",
                  );
              }),
          );
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [store, queue, router, engine, helpers, openShortcuts, recordingId, locked]);
}

function stepWord(
  engine: PlaybackEngine,
  segments: { words: { start: number }[] }[],
  direction: 1 | -1,
): void {
  const time = engine.currentTime;
  const all = segments.flatMap((s) => s.words.map((w) => w.start));
  if (all.length === 0) return;
  if (direction === 1) {
    const next = all.find((start) => start > time + 0.01);
    if (next !== undefined) engine.seek(next + 0.005);
  } else {
    let previous: number | undefined;
    for (const start of all) {
      if (start < time - 0.05) previous = start;
      else break;
    }
    if (previous !== undefined) engine.seek(previous + 0.005);
  }
}
