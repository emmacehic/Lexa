"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

import { formatTimecode } from "@/lib/time";
import { splitTokens } from "@/lib/tokenize";
import { CORRECTION, resolveLabel } from "@/lib/labels";
import type { AnnotationDTO, SegmentDTO, WordDTO } from "@/lib/dto";
import { useOpsQueue, useWorkspace, useWorkspaceStore } from "./context";
import { usePlayback } from "./playback";
import { TimeStepper } from "./TimeStepper";

/**
 * One transcript segment. It re-renders when its own row changes, when it
 * becomes active, or when the selection touches it — and not otherwise.
 */
export const SegmentRow = memo(function SegmentRow({
  segmentId,
  searchHitIds,
  searchCurrentWordId,
}: {
  segmentId: string;
  searchHitIds: ReadonlySet<string>;
  searchCurrentWordId: string | null;
}) {
  const segment = useWorkspace((s) => s.segmentsById[segmentId]);
  const isActive = useWorkspace((s) => s.activeSegmentId === segmentId);
  const isEditing = useWorkspace((s) => s.editingSegmentId === segmentId);
  const selectedWordIds = useWorkspace((s) =>
    s.selection?.segmentId === segmentId ? s.selection.wordIds : null,
  );
  const annotationsById = useWorkspace((s) => s.annotationsById);
  const customLabels = useWorkspace((s) => s.recording.customLabels);
  const locked = useWorkspace((s) => s.recording.status === "COMPLETE");

  const store = useWorkspaceStore();
  const queue = useOpsQueue();
  const playback = usePlayback();
  const [editingTime, setEditingTime] = useState<"start" | "end" | null>(null);

  const commitEdit = useCallback(
    (text: string) => {
      store.getState().setEditing(null);
      const trimmed = text.replace(/\s+/g, " ").trim();
      if (!segment || trimmed === segment.text || trimmed.length === 0) return;
      store.getState().patchSegmentText(segment.id, trimmed);
      queue.push({ kind: "segment.edit", segmentId: segment.id, text: trimmed });
    },
    [queue, segment, store],
  );

  if (!segment) return null;

  const selected = selectedWordIds ? new Set(selectedWordIds) : null;

  return (
    <div
      data-segment-id={segment.id}
      data-active={isActive}
      className="relative py-2 pl-4 pr-2"
      style={{
        borderRadius: "var(--radius-row)",
        background: isActive
          ? "color-mix(in oklch, var(--surface) 62%, transparent)"
          : "transparent",
        boxShadow: isActive
          ? "inset 0 1px 0 rgba(255,255,255,.22), 0 4px 16px rgba(0,0,0,.06)"
          : "none",
        transition: "background 150ms var(--ease)",
      }}
    >
      {isActive ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full"
          style={{ background: "var(--accent)" }}
        />
      ) : null}

      <div className="mb-1 flex items-center gap-3">
        <button
          type="button"
          className="timecode control-plain"
          onClick={() => !locked && setEditingTime("start")}
          title="Segment start — click to adjust"
        >
          {formatTimecode(segment.start)}
        </button>
        <button
          type="button"
          className="timecode control-plain"
          onClick={() => !locked && setEditingTime("end")}
          title="Segment end — click to adjust"
        >
          {formatTimecode(segment.end)}
        </button>
        {segment.isReviewed ? (
          <span
            className="pill"
            style={{
              background: "color-mix(in oklch, var(--accent) 12%, transparent)",
              color: "var(--accent)",
            }}
          >
            Reviewed
          </span>
        ) : null}
        {segment.speakerTag ? (
          <span className="text-soft text-[11px]">{segment.speakerTag}</span>
        ) : null}
      </div>

      {editingTime ? (
        <TimeStepper
          segment={segment}
          field={editingTime}
          onClose={() => setEditingTime(null)}
        />
      ) : null}

      {isEditing ? (
        <SegmentEditor
          segment={segment}
          onCommit={commitEdit}
          onSplit={(wordIndex, text) => {
            store.getState().setEditing(null);
            const trimmed = text.trim();
            if (trimmed && trimmed !== segment.text) {
              queue.push({ kind: "segment.edit", segmentId: segment.id, text: trimmed });
            }
            queue.push({ kind: "segment.split", segmentId: segment.id, wordIndex });
          }}
          onMerge={(text) => {
            store.getState().setEditing(null);
            const trimmed = text.trim();
            if (trimmed && trimmed !== segment.text) {
              queue.push({ kind: "segment.edit", segmentId: segment.id, text: trimmed });
            }
            queue.push({ kind: "segment.merge", segmentId: segment.id });
          }}
        />
      ) : (
        <p
          className="transcript m-0 cursor-text select-none"
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("[data-word-id]")) return;
            // ⌥-click plays just this segment and stops at its end (§8.2).
            playback.seekToSegment(
              {
                id: segment.id,
                start: segment.start,
                end: segment.end,
                words: segment.words.map((w) => ({
                  id: w.id,
                  start: w.start,
                  end: w.end,
                })),
              },
              { only: event.altKey },
            );
          }}
          onDoubleClick={(event) => {
            if (locked) return;
            // Double-clicking a word inside an annotation selects the whole
            // annotation (§9.1) — the transcript handles that. Anywhere else,
            // double-click opens the editor (§8.3).
            const target = event.target as HTMLElement;
            const span = target.closest<HTMLElement>("[data-word-id]");
            const word = span
              ? segment.words.find((w) => w.id === span.dataset.wordId)
              : undefined;
            if (!word || (!word.annotationId && !word.correctionId)) {
              store.getState().setEditing(segment.id);
            }
          }}
        >
          {renderWords(
            segment.words,
            annotationsById,
            customLabels,
            selected,
            playback,
            searchHitIds,
            searchCurrentWordId,
          )}
        </p>
      )}
    </div>
  );
});

function renderWords(
  words: WordDTO[],
  annotationsById: Record<string, AnnotationDTO>,
  customLabels: { type: string; label: string }[],
  selected: Set<string> | null,
  playback: ReturnType<typeof usePlayback>,
  searchHitIds: ReadonlySet<string>,
  searchCurrentWordId: string | null,
) {
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < words.length) {
    const word = words[i];

    if (word.correctionId) {
      let j = i;
      while (j < words.length && words[j].correctionId === word.correctionId) j++;
      const run = words.slice(i, j);
      const correction = annotationsById[word.correctionId];
      const displays = correctedDisplayTexts(run, correction);
      const label = resolveLabel(CORRECTION, customLabels);

      nodes.push(
        <mark
          key={`corr-${word.correctionId}`}
          className="ann group/ann relative"
          data-annotation-id={word.correctionId}
          data-underline="overline"
          data-status={correction?.status ?? "ACTIVE"}
          style={{ ["--ann-color" as string]: `var(${label.varName})` }}
          aria-label={`Corrected “${correction?.nativeAlternative ?? run.map((w) => w.text).join(" ")}”, originally “${correction?.surface ?? run.map((w) => w.text).join(" ")}”`}
        >
          <span
            className="pointer-events-none absolute -top-5 left-0 z-30 hidden whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium group-hover/ann:inline-block"
            style={{ background: `var(${label.varName})`, color: "#fff" }}
            aria-hidden="true"
          >
            corrected
            {correction?.nativeAlternative ? ` \u00b7 ${correction.nativeAlternative}` : ""}
          </span>
          {renderLinguisticPieces(
            run,
            displays,
            annotationsById,
            customLabels,
            selected,
            playback,
            searchHitIds,
            searchCurrentWordId,
          )}
        </mark>,
      );
      if (j < words.length) nodes.push(" ");
      i = j;
      continue;
    }

    if (word.annotationId) {
      let j = i;
      while (
        j < words.length &&
        words[j].annotationId === word.annotationId &&
        !words[j].correctionId
      ) {
        j++;
      }
      const run = words.slice(i, j);
      nodes.push(
        linguisticMark(
          run,
          run.map((w) => w.text),
          annotationsById,
          customLabels,
          selected,
          playback,
          searchHitIds,
          searchCurrentWordId,
        ),
      );
      if (j < words.length) nodes.push(" ");
      i = j;
      continue;
    }

    nodes.push(
      <WordSpan
        key={word.id}
        word={word}
        displayText={word.text}
        selected={selected?.has(word.id) ?? false}
        searchHit={searchHitIds.has(word.id)}
        searchCurrent={searchCurrentWordId === word.id}
        playback={playback}
      />,
    );
    if (i < words.length - 1) nodes.push(" ");
    i++;
  }

  return nodes;
}

function correctedDisplayTexts(
  run: WordDTO[],
  correction: AnnotationDTO | undefined,
): string[] {
  const original = run.map((w) => w.text);
  const alt = correction?.nativeAlternative?.trim();
  if (!alt) return original;
  const tokens = alt.split(/\s+/).filter(Boolean);
  if (tokens.length === run.length) return tokens;
  return run.map((_, k) => (k === 0 ? alt : "\u200b"));
}

function renderLinguisticPieces(
  run: WordDTO[],
  displays: string[],
  annotationsById: Record<string, AnnotationDTO>,
  customLabels: { type: string; label: string }[],
  selected: Set<string> | null,
  playback: ReturnType<typeof usePlayback>,
  searchHitIds: ReadonlySet<string>,
  searchCurrentWordId: string | null,
): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < run.length) {
    const word = run[i];
    if (word.annotationId) {
      let j = i;
      while (j < run.length && run[j].annotationId === word.annotationId) j++;
      nodes.push(
        linguisticMark(
          run.slice(i, j),
          displays.slice(i, j),
          annotationsById,
          customLabels,
          selected,
          playback,
          searchHitIds,
          searchCurrentWordId,
        ),
      );
      if (j < run.length) nodes.push(" ");
      i = j;
      continue;
    }
    nodes.push(
      <WordSpan
        key={word.id}
        word={word}
        displayText={displays[i] ?? word.text}
        selected={selected?.has(word.id) ?? false}
        searchHit={searchHitIds.has(word.id)}
        searchCurrent={searchCurrentWordId === word.id}
        playback={playback}
      />,
    );
    if (i < run.length - 1) nodes.push(" ");
    i++;
  }
  return nodes;
}

function linguisticMark(
  run: WordDTO[],
  displays: string[],
  annotationsById: Record<string, AnnotationDTO>,
  customLabels: { type: string; label: string }[],
  selected: Set<string> | null,
  playback: ReturnType<typeof usePlayback>,
  searchHitIds: ReadonlySet<string>,
  searchCurrentWordId: string | null,
): React.ReactNode {
  const annotationId = run[0].annotationId!;
  const annotation = annotationsById[annotationId];
  const label = resolveLabel(annotation?.type ?? "loanword", customLabels);
  return (
    <mark
      key={annotationId}
      className="ann group/ann relative"
      data-annotation-id={annotationId}
      data-underline={label.underline}
      data-status={annotation?.status ?? "ACTIVE"}
      style={{ ["--ann-color" as string]: `var(${label.varName})` }}
      aria-label={`${label.label}${annotation?.languageTag ? `, ${annotation.languageTag}` : ""}, “${annotation?.surface ?? run.map((w) => w.text).join(" ")}”`}
    >
      <span
        className="pointer-events-none absolute -top-5 left-0 z-30 hidden whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium group-hover/ann:inline-block"
        style={{ background: `var(${label.varName})`, color: "#fff" }}
        aria-hidden="true"
      >
        {label.label.toLowerCase()}{annotation?.languageTag ? ` \u00b7 ${annotation.languageTag}` : ""}
      </span>
      {run.map((w, k) => (
        <span key={w.id}>
          <WordSpan
            word={w}
            displayText={displays[k] ?? w.text}
            selected={selected?.has(w.id) ?? false}
            searchHit={searchHitIds.has(w.id)}
            searchCurrent={searchCurrentWordId === w.id}
            playback={playback}
          />
          {k < run.length - 1 ? " " : null}
        </span>
      ))}
    </mark>
  );
}

function WordSpan({
  word,
  displayText,
  selected,
  searchHit,
  searchCurrent,
  playback,
}: {
  word: WordDTO;
  displayText: string;
  selected: boolean;
  searchHit: boolean;
  searchCurrent: boolean;
  playback: ReturnType<typeof usePlayback>;
}) {
  const corrected = displayText !== word.text && displayText !== "\u200b";
  return (
    <span
      data-word-id={word.id}
      data-timing={word.timing}
      data-search-hit={searchHit ? "true" : undefined}
      data-search-current={searchCurrent ? "true" : undefined}
      title={
        corrected
          ? `Originally “${word.text}”`
          : word.timing === "INTERPOLATED"
            ? "Timing estimated after edit"
            : undefined
      }
      onClick={(event) => {
        if (event.detail === 1 && !event.shiftKey) {
          playback.seek(word.start + 0.01);
        }
      }}
      style={{
        borderRadius: 4,
        background: selected
          ? "color-mix(in oklch, var(--accent) 22%, transparent)"
          : searchCurrent
            ? "color-mix(in oklch, #ffd60a 62%, transparent)"
            : searchHit
              ? "color-mix(in oklch, #ffd60a 38%, transparent)"
              : "transparent",
        boxShadow: searchCurrent && !selected
          ? "inset 0 0 0 1.5px color-mix(in oklch, var(--text) 22%, #ffd60a)"
          : undefined,
        textDecoration: word.timing === "INTERPOLATED" ? "underline dotted" : undefined,
        textDecorationColor:
          word.timing === "INTERPOLATED"
            ? "color-mix(in oklch, var(--text-secondary) 60%, transparent)"
            : undefined,
        textUnderlineOffset: "4px",
      }}
    >
      {displayText}
    </span>
  );
}

/**
 * Editing keeps the same type metrics as the rendered paragraph, so committing
 * an edit never shifts the transcript by a pixel (§8.3).
 */
function SegmentEditor({
  segment,
  onCommit,
  onSplit,
  onMerge,
}: {
  segment: SegmentDTO;
  onCommit: (text: string) => void;
  onSplit: (wordIndex: number, text: string) => void;
  onMerge: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.textContent = segment.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [segment.text]);

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label="Segment text"
      aria-multiline="true"
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      className="transcript m-0 outline-none"
      style={{
        borderRadius: 8,
        boxShadow: "inset 0 0 0 2px var(--accent)",
        padding: "0 2px",
      }}
      onKeyDown={(event) => {
        event.stopPropagation();

        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          const node = ref.current;
          if (!node) return;
          const wordIndex = caretWordIndex(node, segment.words.length);
          if (wordIndex === null) return;
          committed.current = true;
          onSplit(wordIndex, node.textContent ?? segment.text);
          return;
        }

        if (event.key === "Backspace" && caretOffset(ref.current) === 0) {
          event.preventDefault();
          committed.current = true;
          onMerge(ref.current?.textContent ?? segment.text);
          return;
        }

        if (event.key === "Escape" || (event.key === "Enter" && !event.shiftKey)) {
          event.preventDefault();
          committed.current = true;
          onCommit(ref.current?.textContent ?? segment.text);
        }
      }}
      onBlur={() => {
        if (committed.current) return;
        committed.current = true;
        onCommit(ref.current?.textContent ?? segment.text);
      }}
    />
  );
}

/** Characters before the caret inside a contenteditable node. */
function caretOffset(node: HTMLElement | null): number | null {
  if (!node) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(node);
  range.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
  return range.toString().length;
}

/**
 * The word the caret sits on, snapped to the nearest word boundary (§8.4), as
 * an index into the segment's words. Returns null when a split there would
 * leave one side empty.
 */
function caretWordIndex(node: HTMLElement, wordCount: number): number | null {
  const offset = caretOffset(node);
  if (offset === null) return null;
  const text = node.textContent ?? "";
  const prefix = text.slice(0, offset);
  const before = splitTokens(prefix);

  let index = before.length;
  const insideToken =
    prefix.length > 0 && !/\s$/.test(prefix) && offset < text.length && !/^\s/.test(text.slice(offset));
  if (insideToken && before.length > 0) {
    const token = before[before.length - 1];
    const consumed = token.length;
    const tokenStart = prefix.length - consumed;
    const half = tokenStart + consumed / 2;
    index = offset < half ? before.length - 1 : before.length;
  }

  if (index < 1 || index > wordCount - 1) return null;
  return index;
}
