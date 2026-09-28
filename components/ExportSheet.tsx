"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Sheet } from "./ui/Sheet";
import { formatBytes } from "@/lib/time";

const OPTIONS = [
  { id: "json", label: "JSON", note: "The canonical corpus format." },
  { id: "csv", label: "CSV — annotations", note: "One row per annotation." },
  { id: "csv-words", label: "CSV — words", note: "One row per word." },
  { id: "xlsx", label: "XLSX — Annotation Sheet", note: "Instructions, Samples, Annotations." },
  { id: "vtt", label: "WebVTT", note: "Subtitles." },
  { id: "srt", label: "SubRip", note: "Subtitles." },
  { id: "eaf", label: "ELAN .eaf", note: "transcript, loanword, code-switch tiers." },
  { id: "textgrid", label: "Praat .TextGrid", note: "The same three tiers." },
  { id: "corpus-json", label: "Corpus JSON (no audio)", note: "Annotations + timestamps only. No audio file reference." },
] as const;

type FormatId = (typeof OPTIONS)[number]["id"];

interface PreviewPayload {
  format: string;
  filename: string;
  label: string;
  description: string;
  lines: string[];
  truncated: boolean;
  bytes: number;
  annotationCount: number;
}

export function ExportSheetRoute({
  recordingId,
  standalone = false,
}: {
  recordingId: string;
  standalone?: boolean;
}) {
  const router = useRouter();
  const close = () => {
    if (standalone) router.replace(`/r/${recordingId}`);
    else router.back();
  };
  return <ExportSheet recordingId={recordingId} open onClose={close} />;
}

/** §10 — four (here seven) options, a live preview and a byte size. */
export function ExportSheet({
  recordingId,
  open,
  onClose,
}: {
  recordingId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<FormatId>("json");

  const { data, isFetching, error } = useQuery<PreviewPayload>({
    queryKey: ["export-preview", recordingId, format],
    queryFn: async () => {
      const response = await fetch(
        `/api/recordings/${recordingId}/export/preview?format=${format}`,
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "The preview could not be built.");
      }
      return response.json();
    },
    staleTime: 0,
  });

  return (
    <Sheet open={open} onClose={onClose} title="Export" width={800}>
      <div className="flex max-h-[86dvh] min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 pb-3 pt-6">
          <h1>Export</h1>
          <button className="control" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-6 pb-6 sm:grid-cols-[280px_1fr]">
          <div className="scroll-quiet flex flex-col gap-1 overflow-y-auto pr-0.5">
            {OPTIONS.map((option) => (
              <div
                key={option.id}
                className="flex items-center gap-2 px-3 py-2"
                style={{
                  borderRadius: "var(--radius-control)",
                  border: "1px solid var(--hairline)",
                  background:
                    format === option.id
                      ? "color-mix(in oklch, var(--accent) 14%, transparent)"
                      : "transparent",
                  borderColor:
                    format === option.id ? "var(--accent)" : "var(--hairline)",
                }}
              >
                <button
                  className="control control-plain h-auto min-w-0 flex-1 justify-start px-0 py-0 text-left"
                  aria-pressed={format === option.id}
                  onClick={() => setFormat(option.id)}
                >
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium">{option.label}</span>
                    <span className="text-soft text-[11px]">{option.note}</span>
                  </span>
                </button>
                <a
                  className="control control-primary shrink-0"
                  href={`/api/recordings/${recordingId}/export?format=${option.id}`}
                  download
                  aria-label={`Export ${option.label}`}
                >
                  Export
                </a>
              </div>
            ))}
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
            {data && data.annotationCount === 0 ? (
              <div
                className="glass-inset shrink-0 px-3 py-2"
                style={{ borderRadius: "var(--radius-control)" }}
              >
                <p className="text-[13px] font-medium">Nothing annotated yet.</p>
                <p className="text-soft text-[12px]">
                  You can still export the corrected transcript.
                </p>
              </div>
            ) : null}

            <div
              className="glass-inset scroll-quiet min-h-0 w-full min-w-0 flex-1 overflow-auto p-3"
              style={{ borderRadius: "var(--radius-row)" }}
            >
              {error ? (
                <p className="text-[13px]" style={{ color: "var(--loanword)" }}>
                  {(error as Error).message}
                </p>
              ) : isFetching && !data ? (
                <p className="text-soft text-[13px]">Building the preview…</p>
              ) : (
                <pre className="mono m-0 min-w-0 whitespace-pre text-[11px] leading-[1.5]">
                  {(data?.lines ?? []).join("\n")}
                  {data?.truncated ? "\n…" : ""}
                </pre>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-3">
              <span className="timecode">
                {data ? `${data.filename} · ${formatBytes(data.bytes)}` : "…"}
              </span>
              <span className="flex-1" />
              <a
                className="control control-primary"
                href={`/api/recordings/${recordingId}/export?format=${format}`}
                download
              >
                Download
              </a>
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
