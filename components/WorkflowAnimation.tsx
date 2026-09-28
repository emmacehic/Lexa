"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

const STEPS = [
  {
    id: "upload",
    label: "Upload",
    title: "1 · Upload a recording",
    body: "Drop an audio or video file. Small files go to cloud storage; larger ones stay on this server. If the cloud path fails, upload falls back to local disk automatically.",
  },
  {
    id: "extract",
    label: "Extract",
    title: "2 · Extract the audio",
    body: "The soundtrack is pulled out and normalised to FLAC. A waveform is built so you can see and scrub the recording later.",
  },
  {
    id: "transcribe",
    label: "Transcribe",
    title: "3 · Transcribe with Whisper",
    body: "A local Whisper model turns speech into text and timestamps every word, so the transcript stays locked to the audio.",
  },
  {
    id: "segment",
    label: "Segment",
    title: "4 · Build segments",
    body: "Words are grouped into utterances from pauses and speaker turns. Those segments become the rows you review in the workspace.",
  },
  {
    id: "annotate",
    label: "Annotate",
    title: "5 · Annotate the transcript",
    body: "Mark loanwords and code-switches on the words themselves. Each label keeps the original wording and its start / end time.",
  },
  {
    id: "export",
    label: "Export",
    title: "6 · Export the corpus",
    body: "Download structured JSON (the canonical format), or CSV, ELAN, Praat TextGrid, subtitles, or XLSX — all generated from the same annotated data.",
  },
] as const;

const WORDS = [
  { t: "Das", kind: "plain" },
  { t: "war", kind: "plain" },
  { t: "really", kind: "switch" },
  { t: "cool", kind: "loan" },
  { t: "gestern", kind: "plain" },
] as const;

export function WorkflowAnimation() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      setActive((prev) => (prev + 1) % STEPS.length);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [paused]);

  const step = STEPS[active];

  return (
    <section
      className="glass glass-e1 mb-4 overflow-hidden"
      style={{ borderRadius: "var(--radius-panel)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-label="Project workflow animation"
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <p
          className="text-[12px] font-semibold tracking-wide uppercase"
          style={{ color: "var(--accent)" }}
        >
          How a recording moves through Lexa
        </p>
        <Link
          href="/workflow"
          className="text-[11px] font-medium"
          style={{ color: "var(--accent)" }}
        >
          Full workflow →
        </Link>
      </div>

      <div className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div
          className="relative flex min-h-[168px] items-center justify-center overflow-hidden"
          style={{
            borderRadius: "var(--radius-row)",
            background: "color-mix(in oklch, var(--accent) 6%, var(--surface))",
            border: "1px solid color-mix(in oklch, var(--accent) 12%, var(--hairline))",
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -14, scale: 0.98 }}
              transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
              className="flex h-full w-full items-center justify-center px-4 py-5"
            >
              <StepScene id={step.id} />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex min-h-[168px] flex-col justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.28 }}
            >
              <p className="text-[15px] font-semibold leading-snug">{step.title}</p>
              <p className="text-soft mt-2 text-[13px] leading-relaxed">{step.body}</p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="px-5 pb-4">
        <div
          className="relative mb-3 h-[3px] overflow-hidden rounded-full"
          style={{ background: "color-mix(in oklch, var(--text) 8%, transparent)" }}
        >
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ background: "var(--accent)" }}
            animate={{ width: `${((active + 1) / STEPS.length) * 100}%` }}
            transition={{ type: "spring", stiffness: 180, damping: 26 }}
          />
        </div>
        <ol className="flex gap-1">
          {STEPS.map((item, index) => {
            const state =
              index < active ? "done" : index === active ? "active" : "pending";
            return (
              <li key={item.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setActive(index)}
                  className="flex w-full flex-col items-center gap-1 rounded-md px-1 py-1.5 text-center"
                  aria-current={state === "active" ? "step" : undefined}
                >
                  <motion.span
                    animate={{
                      scale: state === "active" ? 1.08 : 1,
                      backgroundColor:
                        state === "done"
                          ? "var(--accent)"
                          : state === "active"
                            ? "color-mix(in oklch, var(--accent) 22%, transparent)"
                            : "color-mix(in oklch, var(--text) 8%, transparent)",
                      color: state === "done" ? "#fff" : "var(--text)",
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                  >
                    {state === "done" ? "✓" : index + 1}
                  </motion.span>
                  <span
                    className="hidden text-[10px] font-semibold leading-tight sm:block"
                    style={{
                      color:
                        state === "active"
                          ? "var(--accent)"
                          : state === "done"
                            ? "var(--text)"
                            : "var(--text-secondary)",
                    }}
                  >
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function StepScene({ id }: { id: (typeof STEPS)[number]["id"] }) {
  switch (id) {
    case "upload":
      return <UploadScene />;
    case "extract":
      return <ExtractScene />;
    case "transcribe":
      return <TranscribeScene />;
    case "segment":
      return <SegmentScene />;
    case "annotate":
      return <AnnotateScene />;
    case "export":
      return <ExportScene />;
  }
}

function UploadScene() {
  return (
    <div className="relative flex h-[132px] w-full max-w-[280px] flex-col items-center justify-end">
      <motion.div
        initial={{ y: -70, opacity: 0, rotate: -8 }}
        animate={{ y: 0, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.1 }}
        className="mb-3 flex w-[150px] items-center gap-2 rounded-lg px-3 py-2"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--hairline)",
          boxShadow: "0 8px 20px color-mix(in oklch, var(--text) 8%, transparent)",
        }}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-bold"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          MP3
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-medium">interview.mp3</p>
          <p className="text-soft text-[10px]">18.4 MB · uploading</p>
        </div>
      </motion.div>
      <div
        className="flex h-12 w-full items-center justify-center rounded-xl border-2 border-dashed text-[11px] font-medium"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
      >
        Drop file here
      </div>
      <motion.div
        className="absolute bottom-14 left-8 right-8 h-[3px] overflow-hidden rounded-full"
        style={{ background: "color-mix(in oklch, var(--text) 10%, transparent)" }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: "var(--accent)" }}
          initial={{ width: "8%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 2.2, ease: "easeInOut" }}
        />
      </motion.div>
    </div>
  );
}

function ExtractScene() {
  const bars = [18, 34, 52, 28, 64, 40, 72, 30, 48, 22, 58, 36];
  return (
    <div className="flex w-full max-w-[280px] flex-col items-center gap-3">
      <div className="flex items-center gap-3">
        <motion.div
          initial={{ x: -16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="rounded-md px-2 py-1 text-[11px] font-bold"
          style={{ background: "color-mix(in oklch, var(--text) 8%, transparent)" }}
        >
          VIDEO
        </motion.div>
        <motion.span
          animate={{ x: [0, 6, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.2, repeat: Infinity }}
          style={{ color: "var(--accent)" }}
        >
          →
        </motion.span>
        <motion.div
          initial={{ x: 16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          className="rounded-md px-2 py-1 text-[11px] font-bold"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          FLAC
        </motion.div>
      </div>
      <div className="flex h-16 items-end gap-[3px]">
        {bars.map((height, index) => (
          <motion.span
            key={height + index}
            className="w-[9px] rounded-full"
            style={{ background: "var(--accent)" }}
            initial={{ height: 6 }}
            animate={{ height }}
            transition={{ delay: 0.12 * index, type: "spring", stiffness: 260, damping: 18 }}
          />
        ))}
      </div>
      <p className="text-soft text-[11px]">Waveform ready</p>
    </div>
  );
}

function TranscribeScene() {
  return (
    <div className="flex w-full max-w-[300px] flex-col gap-3">
      <div className="flex h-8 items-end gap-[2px]">
        {Array.from({ length: 22 }, (_, index) => (
          <motion.span
            key={index}
            className="flex-1 rounded-full"
            style={{ background: "color-mix(in oklch, var(--accent) 70%, transparent)" }}
            animate={{ height: [8, 10 + ((index * 17) % 22), 8] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.04 }}
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {WORDS.map((word, index) => (
          <motion.span
            key={word.t}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18 * index }}
            className="rounded px-1.5 py-0.5 text-[12px] font-medium"
            style={{
              background: "color-mix(in oklch, var(--text) 6%, transparent)",
            }}
          >
            {word.t}
            <span className="text-soft ml-1 text-[9px] tabular-nums">
              0.{index * 4}
            </span>
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function SegmentScene() {
  return (
    <div className="flex w-full max-w-[300px] flex-col gap-2">
      {[
        WORDS.slice(0, 3),
        WORDS.slice(3),
      ].map((group, groupIndex) => (
        <motion.div
          key={groupIndex}
          initial={{ opacity: 0, x: groupIndex === 0 ? -18 : 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 + groupIndex * 0.25, type: "spring", stiffness: 220, damping: 20 }}
          className="flex flex-wrap items-center gap-1.5 rounded-lg px-3 py-2"
          style={{
            border: "1px solid var(--hairline)",
            background: "var(--surface)",
          }}
        >
          <span className="text-soft mr-1 text-[10px] font-bold">S{groupIndex + 1}</span>
          {group.map((word) => (
            <span key={word.t} className="text-[12px] font-medium">
              {word.t}
            </span>
          ))}
        </motion.div>
      ))}
    </div>
  );
}

function AnnotateScene() {
  return (
    <div className="flex w-full max-w-[300px] flex-wrap justify-center gap-2">
      {WORDS.map((word, index) => (
        <motion.span
          key={word.t}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 * index }}
          className="relative px-1 pb-1 text-[15px] font-medium"
        >
          {word.t}
          {word.kind !== "plain" ? (
            <motion.span
              className="absolute inset-x-0 bottom-0 h-[3px] rounded-full"
              style={{
                background: word.kind === "loan" ? "var(--loanword)" : "var(--codeswitch)",
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.45 + index * 0.12, duration: 0.28 }}
            />
          ) : null}
        </motion.span>
      ))}
      <div className="mt-2 flex w-full justify-center gap-3 text-[10px] font-semibold">
        <span style={{ color: "var(--loanword)" }}>loanword</span>
        <span style={{ color: "var(--codeswitch)" }}>code-switch</span>
      </div>
    </div>
  );
}

function ExportScene() {
  const formats = ["JSON", "CSV", "ELAN", "TextGrid"];
  return (
    <div className="relative flex h-[132px] w-full max-w-[260px] items-end justify-center">
      {formats.map((format, index) => (
        <motion.div
          key={format}
          initial={{ y: 40, opacity: 0, rotate: -6 + index * 3 }}
          animate={{ y: -index * 10, opacity: 1, rotate: -8 + index * 4 }}
          transition={{ delay: 0.12 * index, type: "spring", stiffness: 240, damping: 16 }}
          className="absolute flex h-[72px] w-[92px] flex-col justify-between rounded-lg px-2.5 py-2"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--hairline)",
            boxShadow: "0 10px 22px color-mix(in oklch, var(--text) 10%, transparent)",
            zIndex: formats.length - index,
          }}
        >
          <span className="text-[10px] font-bold" style={{ color: "var(--accent)" }}>
            {format}
          </span>
          <span className="text-soft text-[9px] leading-tight">
            {format === "JSON" ? "{ segments, words }" : "corpus export"}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
