"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { WaveformThumb } from "./WaveformThumb";
import { ThemeToggle } from "./ThemeToggle";
import { SignOutButton } from "./SignOutButton";
import { MetadataWizard } from "./MetadataWizard";
import { TranscriptionPipeline } from "./TranscriptionPipeline";
import { WorkflowAnimation } from "./WorkflowAnimation";
import { startUpload, probeDuration } from "@/lib/upload-client";
import { formatDuration } from "@/lib/time";
import {
  ACCEPTED_DESCRIPTION,
  ACCEPTED_EXTENSIONS,
  FILE_ACCEPT,
} from "@/lib/mime";
import { BUILT_IN_LABELS, CODE_SWITCH, LOANWORD, UNCLEAR } from "@/lib/labels";
import type { LibraryRow } from "@/lib/recordings";
import { canDeleteRecording, DELETE_CONFIRM_MESSAGE } from "@/lib/recording-delete";
import { useActiveRecordingStatuses } from "@/lib/use-active-recording-statuses";
import {
  isActiveTranscriptionStatus,
  transcriptionStatusShort,
  type RecordingStatusSnapshot,
} from "@/lib/transcription-status";

type SortKey = "date" | "name" | "duration" | "progress";

interface ProjectOption {
  id: string;
  name: string;
}

interface UploadState {
  filename: string;
  sent: number;
  total: number;
  error: string | null;
}

export function LibraryClient({
  rows,
  projects,
  isAdmin,
  userName,
}: {
  rows: LibraryRow[];
  projects: ProjectOption[];
  isAdmin: boolean;
  userName: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const pendingFileRef = useRef<File | null>(null);
  const probedDurationRef = useRef(0);
  const createdRef = useRef<{ recordingId: string; projectId: string } | null>(null);
  const creatingRef = useRef<Promise<{ recordingId: string; projectId: string }> | null>(null);

  const [filterProject, setFilterProject] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [searchText, setSearchText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardTarget, setWizardTarget] = useState<{ recordingId: string; projectId: string } | null>(null);

  const refreshRows = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["library-rows"] });
    router.refresh();
  }, [queryClient, router]);

  const { data: libraryRows = rows } = useQuery<LibraryRow[]>({
    queryKey: ["library-rows"],
    queryFn: async () => {
      const response = await fetch("/api/recordings");
      if (!response.ok) throw new Error("Library unavailable");
      const body = (await response.json()) as { recordings: LibraryRow[] };
      return body.recordings;
    },
    initialData: rows,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data ?? rows;
      return data.some((row) => isActiveTranscriptionStatus(row.status)) ? 3000 : false;
    },
  });

  const liveById = useActiveRecordingStatuses(libraryRows, refreshRows);

  const filtered = useMemo(() => {
    let result = libraryRows;
    if (filterProject) {
      result = result.filter((r) => r.projectId === filterProject);
    }
    if (filterStatus) {
      result = result.filter((r) => r.status === filterStatus);
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      result = result.filter(
        (r) =>
          r.filename.toLowerCase().includes(q) ||
          r.projectName.toLowerCase().includes(q) ||
          (r.assignedToName && r.assignedToName.toLowerCase().includes(q)),
      );
    }
    const sorted = [...result];
    switch (sortKey) {
      case "name":
        sorted.sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      case "duration":
        sorted.sort((a, b) => b.durationSec - a.durationSec);
        break;
      case "progress": {
        const pct = (r: LibraryRow) =>
          r.segmentCount > 0 ? r.reviewedCount / r.segmentCount : 0;
        sorted.sort((a, b) => pct(b) - pct(a));
        break;
      }
      default:
        break;
    }
    return sorted.filter((row) => !hiddenIds.has(row.id));
  }, [libraryRows, filterProject, filterStatus, searchText, sortKey, hiddenIds]);

  const deleteRecording = useCallback(
    async (id: string) => {
      setDeletingId(id);
      setDeleteError(null);
      const response = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setDeleteError(
          body?.error?.message ??
            "The recording could not be deleted. The file was left in storage.",
        );
        setDeletingId(null);
        return;
      }
      setHiddenIds((current) => {
        const next = new Set(current);
        next.add(id);
        return next;
      });
      setConfirmId(null);
      setDeletingId(null);
      router.refresh();
    },
    [router],
  );

  const rejectFile = useCallback((file: File, error: string) => {
    setUpload({ filename: file.name, sent: 0, total: file.size, error });
  }, []);

  const patchDurationHint = useCallback(
    async (recordingId: string, durationSec: number) => {
      if (durationSec <= 0) return;
      await fetch(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "duration", durationSec }),
      });
      refreshRows();
    },
    [refreshRows],
  );

  const offerFile = useCallback(
    (file: File) => {
      if (wizardOpen || (upload && !upload.error)) return;
      const extension = file.name.includes(".")
        ? file.name.split(".").pop()!.toLowerCase()
        : "";
      if (!ACCEPTED_EXTENSIONS.includes(extension as (typeof ACCEPTED_EXTENSIONS)[number])) {
        rejectFile(
          file,
          `Lexa cannot read ${file.name} (.${extension || "no extension"}). It accepts ${ACCEPTED_DESCRIPTION}.`,
        );
        return;
      }
      pendingFileRef.current = file;
      probedDurationRef.current = 0;
      createdRef.current = null;
      setWizardTarget(null);
      setUpload(null);
      setWizardOpen(true);
      void probeDuration(file).then((durationSec) => {
        probedDurationRef.current = durationSec;
        const recordingId = createdRef.current?.recordingId;
        if (recordingId) void patchDurationHint(recordingId, durationSec);
      });
    },
    [patchDurationHint, rejectFile, upload, wizardOpen],
  );

  const ensureRecording = useCallback(async (projectName: string) => {
    if (createdRef.current) return createdRef.current;
    if (creatingRef.current) return creatingRef.current;

    const work = (async () => {
      const file = pendingFileRef.current;
      if (!file) {
        throw new Error("Choose a file first.");
      }

      setUpload({ filename: file.name, sent: 0, total: file.size, error: null });

      const response = await fetch("/api/recordings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectName,
          filename: file.name,
          mimeType: file.type,
          byteSize: file.size,
          durationSec: probedDurationRef.current,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: string;
        projectId?: string;
        storageKey?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !body?.id || !body.projectId || !body.storageKey) {
        const message = body?.error?.message ?? "The upload could not be started.";
        setUpload({ filename: file.name, sent: 0, total: file.size, error: message });
        throw new Error(message);
      }

      const created = { recordingId: body.id, projectId: body.projectId };
      createdRef.current = created;
      setWizardTarget(created);
      refreshRows();
      void patchDurationHint(body.id, probedDurationRef.current);

      startUpload({
        file,
        recordingId: body.id,
        storageKey: body.storageKey,
        onProgress: (sent, total) =>
          setUpload((current) =>
            current ? { ...current, sent, total } : current,
          ),
        onError: (message) =>
          setUpload((current) => (current ? { ...current, error: message } : current)),
        onSuccess: async () => {
          const finish = await fetch(`/api/recordings/${body.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "uploaded" }),
          });
          if (!finish.ok) {
            const detail = (await finish.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setUpload((current) =>
              current
                ? {
                    ...current,
                    error: detail?.error?.message ?? "The upload could not be queued.",
                  }
                : current,
            );
            return;
          }
          setUpload(null);
          refreshRows();
        },
      });

      return created;
    })();

    creatingRef.current = work;
    try {
      return await work;
    } finally {
      creatingRef.current = null;
    }
  }, [patchDurationHint, refreshRows]);

  useEffect(() => {
    refreshRows();
  }, [refreshRows]);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDragOver = (event: DragEvent) => event.preventDefault();
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) offerFile(file);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [offerFile]);

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[880px] items-center justify-between px-5 pt-6 pb-4">
        <div>
          <h1>Library</h1>
          <p className="text-soft text-[13px]">Signed in as {userName}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link className="control" href="/guidelines">
            Annotation Guidelines
          </Link>
          <Link className="control" href="/workflow">
            Project Workflow
          </Link>
          {isAdmin ? (
            <Link className="control" href="/admin">
              Admin
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col px-5 pb-4">

      <WorkflowAnimation />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="field h-8 w-[200px] text-[13px]"
          placeholder="Search filename…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <select
          className="field h-8 w-auto text-[13px]"
          value={filterProject}
          onChange={(e) => setFilterProject(e.target.value)}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          className="field h-8 w-auto text-[13px]"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="PROCESSING">Processing</option>
          <option value="UPLOADED">Upload incomplete</option>
          <option value="READY">Ready</option>
          <option value="COMPLETE">Complete</option>
          <option value="FAILED">Failed</option>
        </select>
        <select
          className="field h-8 w-auto text-[13px]"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          <option value="date">Sort: Date</option>
          <option value="name">Sort: Name</option>
          <option value="duration">Sort: Duration</option>
          <option value="progress">Sort: Progress</option>
        </select>
        <span className="text-soft text-[12px]">{filtered.length} recording{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {filtered.length === 0 ? (
        <div
          className="glass glass-e1 px-6 py-10 text-center"
          style={{ borderRadius: "var(--radius-panel)" }}
        >
          <p className="text-[15px] font-medium">
            {libraryRows.length === 0 ? "No recordings yet." : "No recordings match your filters."}
          </p>
          <p className="text-soft mt-1 text-[13px]">
            {libraryRows.length === 0
              ? "Drop an audio or video file here to start."
              : "Try adjusting your search or filters."}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((row) => (
            <li key={row.id}>
              <RecordingRow
                row={row}
                live={liveById.get(row.id)}
                canDelete={canDeleteRecording(row.status, isAdmin ? "ADMIN" : "CONTRIBUTOR")}
                deleting={deletingId === row.id}
                onAskDelete={() => {
                  setDeleteError(null);
                  setConfirmId(row.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <UploadBar
          upload={upload}
          onDismiss={() => setUpload(null)}
          onPick={() => inputRef.current?.click()}
        />
      </div>

      </div>{/* end centered flex column */}

      <footer className="text-soft mx-auto w-full max-w-[880px] px-5 pb-6 text-[12px]">
        Lexa · Created by Emma Cehic
      </footer>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={FILE_ACCEPT}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) offerFile(file);
          event.target.value = "";
        }}
      />

      <AnimatePresence>
        {dragging ? (
          <motion.div
            key="drop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              background: "color-mix(in oklch, var(--bg) 55%, transparent)",
            }}
          >
            <p className="text-[17px] font-medium">Drop to upload</p>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {wizardOpen ? (
        <MetadataWizard
          recordingId={wizardTarget?.recordingId ?? null}
          projectId={wizardTarget?.projectId ?? null}
          upload={upload}
          onEnsureRecording={ensureRecording}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={confirmId !== null}
        filename={libraryRows.find((row) => row.id === confirmId)?.filename ?? "this recording"}
        message={DELETE_CONFIRM_MESSAGE}
        deleting={deletingId !== null}
        error={deleteError}
        onCancel={() => {
          if (deletingId) return;
          setConfirmId(null);
          setDeleteError(null);
        }}
        onConfirm={() => {
          if (confirmId) void deleteRecording(confirmId);
        }}
      />
    </main>
  );
}

function RecordingRow({
  row,
  live,
  canDelete,
  deleting,
  onAskDelete,
}: {
  row: LibraryRow;
  live?: RecordingStatusSnapshot;
  canDelete: boolean;
  deleting: boolean;
  onAskDelete: () => void;
}) {
  const status = live?.status ?? row.status;
  const stage = live?.stage ?? row.stage;
  const progress = live?.progress ?? row.progress;
  const durationSec = live?.durationSec ?? row.durationSec;
  const isTranscribing = isActiveTranscriptionStatus(status);

  const href =
    status === "READY" || status === "COMPLETE"
      ? `/r/${row.id}`
      : `/r/${row.id}/processing`;

  const reviewed = row.segmentCount > 0 ? row.reviewedCount / row.segmentCount : 0;

  const annotationTypes = Object.entries(row.annotationCounts);

  return (
    <div
      className="glass glass-e1 flex items-center gap-3 px-4 py-3"
      style={{ borderRadius: "var(--radius-row)" }}
    >
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-4 transition-opacity duration-100 hover:opacity-90"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-medium">{row.filename}</span>
            <span className="timecode">{formatDuration(row.durationSec)}</span>
          </div>
          <div className="text-soft mt-0.5 truncate text-[12px]">
            {row.projectName}
            {row.assignedToName ? ` · ${row.assignedToName}` : ""}
          </div>
          <div className="mt-2 flex flex-col gap-1">
            {isTranscribing ? (
              <>
                <div className="flex items-center gap-3">
                  <div
                    className="h-[3px] flex-1 overflow-hidden rounded-full"
                    style={{
                      background: "color-mix(in oklch, var(--text) 10%, transparent)",
                    }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                    aria-label="Transcription progress"
                  >
                    <div
                      style={{
                        width: `${Math.max(4, progress)}%`,
                        height: "100%",
                        background: "var(--accent)",
                        transition: "width 280ms var(--ease)",
                      }}
                    />
                  </div>
                  <span className="timecode shrink-0">{progress}%</span>
                </div>
                <TranscriptionPipeline
                  status={status}
                  stage={stage}
                  progress={progress}
                  durationSec={durationSec}
                  compact
                />
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div
                  className="h-[3px] flex-1 overflow-hidden rounded-full"
                  style={{ background: "color-mix(in oklch, var(--text) 10%, transparent)" }}
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={row.segmentCount}
                  aria-valuenow={row.reviewedCount}
                  aria-label="Segments reviewed"
                >
                  <div
                    style={{
                      width: `${Math.round(reviewed * 100)}%`,
                      height: "100%",
                      background: "var(--accent)",
                    }}
                  />
                </div>
                <span className="timecode shrink-0">
                  {row.reviewedCount}/{row.segmentCount}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="w-[100px] shrink-0 sm:w-[140px]">
          <WaveformThumb peaks={row.waveformPeaks} height={40} bars={64} />
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-1.5">
            <CountPill
              count={row.annotationCounts[LOANWORD] ?? 0}
              color="var(--loanword)"
              label="loanwords"
            />
            <CountPill
              count={row.annotationCounts[CODE_SWITCH] ?? 0}
              color="var(--codeswitch)"
              label="code-switches"
            />
            {(row.annotationCounts[UNCLEAR] ?? 0) > 0 ? (
              <CountPill
                count={row.annotationCounts[UNCLEAR]}
                color="var(--unclear)"
                label="unclear"
              />
            ) : null}
            {annotationTypes
              .filter(([type]) => !BUILT_IN_LABELS[type])
              .map(([type, count]) => (
                <CountPill
                  key={type}
                  count={count}
                  color="var(--text-secondary)"
                  label={type}
                />
              ))}
          </div>
          <StatusLabel status={status} stage={stage} />
        </div>
      </Link>

      {row.status !== "UPLOADED" ? (
        <a
          className="control shrink-0"
          href={`/api/recordings/${row.id}/download`}
          title={`Download ${row.filename}`}
        >
          Download
        </a>
      ) : null}

      {canDelete ? (
        <button
          type="button"
          className="control shrink-0"
          aria-label={`Delete ${row.filename}`}
          disabled={deleting}
          onClick={onAskDelete}
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}

function CountPill({
  count,
  color,
  label,
}: {
  count: number;
  color: string;
  label: string;
}) {
  return (
    <span
      className="pill"
      title={`${count} ${label}`}
      style={{
        background: `color-mix(in oklch, ${color} 14%, transparent)`,
        color,
      }}
    >
      {count}
    </span>
  );
}

function StatusLabel({
  status,
  stage,
}: {
  status: LibraryRow["status"];
  stage: string | null;
}) {
  const text = transcriptionStatusShort(status, stage);
  const isProcessing = isActiveTranscriptionStatus(status);

  return (
    <span
      className="text-[11px]"
      style={{
        color:
          status === "FAILED"
            ? "var(--loanword)"
            : isProcessing
              ? "var(--accent)"
              : "var(--text-secondary)",
      }}
    >
      {text}
    </span>
  );
}

function UploadBar({
  upload,
  onDismiss,
  onPick,
}: {
  upload: UploadState | null;
  onDismiss: () => void;
  onPick: () => void;
}) {
  const percent =
    upload && upload.total > 0 ? Math.round((upload.sent / upload.total) * 100) : 0;

  return (
    <div className="mx-auto w-full max-w-[680px]">
      <div
        className="upload-glow glass glass-e2 flex items-center gap-3 px-3 py-2.5"
        style={{ borderRadius: "var(--radius-panel)" }}
      >
        {upload ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{upload.filename}</div>
              {upload.error ? (
                <div className="mt-0.5 text-[12px]" style={{ color: "var(--loanword)" }}>
                  {upload.error}
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-2">
                  <div
                    className="h-[3px] flex-1 overflow-hidden rounded-full"
                    style={{
                      background: "color-mix(in oklch, var(--text) 10%, transparent)",
                    }}
                  >
                    <div
                      style={{
                        width: `${percent}%`,
                        height: "100%",
                        background: "var(--accent)",
                        transition: "width 120ms var(--ease)",
                      }}
                    />
                  </div>
                  <span className="timecode shrink-0">{percent}%</span>
                </div>
              )}
            </div>
            {upload.error ? (
              <button className="control" onClick={onDismiss}>
                Dismiss
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="text-soft flex-1 truncate text-[13px]">
              Drop audio or video anywhere, or
            </div>
            <button className="control control-primary" onClick={onPick}>
              Upload recording
            </button>
          </>
        )}
      </div>
    </div>
  );
}
