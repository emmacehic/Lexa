"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SegmentRow } from "./SegmentRow";
import { SelectionToolbar } from "./SelectionToolbar";
import { TranscriptSearch } from "./TranscriptSearch";
import { useWorkspace, useWorkspaceStore } from "./context";
import { usePlayback } from "./playback";
import type { SegmentDTO } from "@/lib/dto";
import { findTranscriptMatches } from "@/lib/transcript-search";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

/**
 * The transcript column: virtualized rows, word-granular selection, the
 * active-word underline, and auto-scroll that yields the moment the reader
 * takes over (§8.2).
 */
export function Transcript() {
  const order = useWorkspace((s) => s.order);
  const segmentsById = useWorkspace((s) => s.segmentsById);
  const follow = useWorkspace((s) => s.follow);
  const editing = useWorkspace((s) => s.editingSegmentId);
  const store = useWorkspaceStore();
  const playback = usePlayback();

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const [toolbarAt, setToolbarAt] = useState<{
    x: number;
    y: number;
    yAbove: number;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);

  const virtualizer = useVirtualizer({
    count: order.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 104,
    overscan: 8,
    measureElement: (element) => element.getBoundingClientRect().height,
  });

  // --- playback → active segment, active word, auto-scroll ----------------
  useEffect(() => {
    playback.setSegments(
      order
        .map((id) => segmentsById[id])
        .filter((s): s is SegmentDTO => Boolean(s))
        .map((s) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          words: s.words.map((w) => ({ id: w.id, start: w.start, end: w.end })),
        })),
    );
  }, [order, segmentsById, playback]);

  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    order.forEach((id, i) => map.set(id, i));
    return map;
  }, [order]);

  const searchable = useMemo(
    () =>
      order
        .map((id) => segmentsById[id])
        .filter((s): s is SegmentDTO => Boolean(s))
        .map((s) => ({ id: s.id, words: s.words })),
    [order, segmentsById],
  );

  const searchMatches = useMemo(
    () => findTranscriptMatches(searchable, searchQuery),
    [searchable, searchQuery],
  );

  const searchHitIds = useMemo(
    () => new Set(searchMatches.map((hit) => hit.wordId)),
    [searchMatches],
  );

  const currentHit = searchMatches[searchCursor] ?? null;

  const jumpToHit = useCallback(
    (hit: { segmentId: string; wordId: string } | null) => {
      if (!hit) return;
      store.getState().setFollow(false);
      const index = indexOf.get(hit.segmentId);
      const element = scrollRef.current;
      if (element && index !== undefined) {
        const offset = virtualizer.getOffsetForIndex(index, "center")?.[0];
        if (typeof offset === "number") springScroll(element, offset);
      }
    },
    [indexOf, store, virtualizer],
  );

  useEffect(() => {
    if (searchMatches.length === 0) {
      if (searchCursor !== 0) setSearchCursor(0);
      return;
    }
    if (searchCursor >= searchMatches.length) {
      setSearchCursor(0);
    }
  }, [searchMatches, searchCursor]);

  const lastJumpKey = useRef("");
  useEffect(() => {
    if (!searchQuery.trim() || !currentHit) return;
    const key = `${searchQuery}:${searchCursor}:${currentHit.wordId}`;
    if (lastJumpKey.current === key) return;
    lastJumpKey.current = key;
    jumpToHit(currentHit);
  }, [searchQuery, searchCursor, currentHit, jumpToHit]);

  const focusRequest = useWorkspace((s) => s.focusRequest);
  useEffect(() => {
    if (!focusRequest) return;
    const annotation = store.getState().annotationsById[focusRequest.annotationId];
    store.getState().clearFocusRequest();
    if (!annotation?.segmentId || annotation.wordIds.length === 0) return;
    store.getState().setFollow(false);
    store.getState().setSelection({
      segmentId: annotation.segmentId,
      wordIds: annotation.wordIds,
      annotationId: annotation.id,
      correctionId: null,
    });
    store.getState().announce(`Jumped to “${annotation.surface}”`);
    jumpToHit({
      segmentId: annotation.segmentId,
      wordId: annotation.wordIds[0],
    });
    playback.seek(annotation.start + 0.01);
  }, [focusRequest, jumpToHit, playback, store]);

  const stepSearch = useCallback(
    (direction: 1 | -1) => {
      if (searchMatches.length === 0) return;
      setSearchCursor((cursor) => {
        const next =
          (cursor + direction + searchMatches.length) % searchMatches.length;
        return next;
      });
    },
    [searchMatches.length],
  );

  useEffect(() => {
    return playback.subscribeSegment((segmentId) => {
      store.getState().setActiveSegment(segmentId);
      if (!segmentId) return;
      if (!store.getState().follow) return;
      const index = indexOf.get(segmentId);
      if (index === undefined) return;
      const element = scrollRef.current;
      if (!element) return;
      const offset = virtualizer.getOffsetForIndex(index, "center")?.[0];
      if (typeof offset === "number") springScroll(element, offset);
    });
  }, [playback, store, indexOf, virtualizer]);

  useEffect(() => {
    return playback.subscribeWord((_segmentId, wordId) => {
      const cursor = cursorRef.current;
      const inner = innerRef.current;
      if (!cursor || !inner) return;
      if (!wordId) {
        cursor.style.opacity = "0";
        return;
      }
      const span = inner.querySelector<HTMLElement>(`[data-word-id="${wordId}"]`);
      if (!span) {
        cursor.style.opacity = "0";
        return;
      }
      const base = inner.getBoundingClientRect();
      const rect = span.getBoundingClientRect();
      cursor.style.opacity = "1";
      cursor.style.width = `${rect.width}px`;
      cursor.style.transform = `translate3d(${rect.left - base.left}px, ${rect.bottom - base.top + 2}px, 0)`;
    });
  }, [playback]);

  // --- the reader takes over -----------------------------------------------
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const yield_ = () => {
      cancelSpring(element);
      if (store.getState().follow) store.getState().setFollow(false);
    };
    element.addEventListener("wheel", yield_, { passive: true });
    element.addEventListener("touchstart", yield_, { passive: true });
    return () => {
      element.removeEventListener("wheel", yield_);
      element.removeEventListener("touchstart", yield_);
    };
  }, [store]);

  // --- word-granular selection ---------------------------------------------
  const anchor = useRef<{ segmentId: string; index: number } | null>(null);
  const dragging = useRef(false);

  const wordUnder = useCallback(
    (element: Element | null) => {
      const span = element?.closest<HTMLElement>("[data-word-id]");
      if (!span) return null;
      const segmentElement = span.closest<HTMLElement>("[data-segment-id]");
      const segmentId = segmentElement?.dataset.segmentId;
      if (!segmentId) return null;
      const segment = store.getState().segmentsById[segmentId];
      if (!segment) return null;
      const index = segment.words.findIndex((w) => w.id === span.dataset.wordId);
      if (index < 0) return null;
      return { segmentId, index, segment };
    },
    [store],
  );

  const positionToolbar = useCallback((wordId: string) => {
    const inner = innerRef.current;
    if (!inner) return;
    const span = inner.querySelector<HTMLElement>(`[data-word-id="${wordId}"]`);
    if (!span) return;
    const rect = span.getBoundingClientRect();
    setToolbarAt({
      x: rect.left,
      y: rect.bottom + 10,
      yAbove: rect.top,
    });
  }, []);

  const select = useCallback(
    (segmentId: string, from: number, to: number) => {
      const segment = store.getState().segmentsById[segmentId];
      if (!segment) return;
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const wordIds = segment.words.slice(low, high + 1).map((w) => w.id);
      const range = segment.words.slice(low, high + 1);
      const annotationIds = new Set(range.map((w) => w.annotationId));
      const correctionIds = new Set(range.map((w) => w.correctionId));
      store.getState().setSelection({
        segmentId,
        wordIds,
        annotationId:
          annotationIds.size === 1 ? ([...annotationIds][0] ?? null) : null,
        correctionId:
          correctionIds.size === 1 ? ([...correctionIds][0] ?? null) : null,
      });
      positionToolbar(segment.words[high].id);
    },
    [store, positionToolbar],
  );

  useEffect(() => {
    const onPointerUp = () => {
      dragging.current = false;
    };
    window.addEventListener("pointerup", onPointerUp);
    return () => window.removeEventListener("pointerup", onPointerUp);
  }, []);

  const selection = useWorkspace((s) => s.selection);
  useEffect(() => {
    if (!selection) {
      setToolbarAt(null);
      return;
    }
    const wordId = selection.wordIds[selection.wordIds.length - 1];
    if (!wordId) {
      setToolbarAt(null);
      return;
    }
    const update = () => positionToolbar(wordId);
    update();
    const scroller = scrollRef.current;
    scroller?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [selection, positionToolbar]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <TranscriptSearch
        query={searchQuery}
        matchCount={searchMatches.length}
        currentIndex={currentHit ? searchCursor : 0}
        onQueryChange={(value) => {
          setSearchQuery(value);
          setSearchCursor(0);
        }}
        onPrev={() => stepSearch(-1)}
        onNext={() => stepSearch(1)}
      />
      <div
        ref={scrollRef}
        className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto px-3 py-6"
        onPointerDown={(event) => {
          if (editing) return;
          const hit = wordUnder(event.target as Element);
          if (!hit) {
            store.getState().setSelection(null);
            return;
          }
          if (event.shiftKey && anchor.current) {
            if (anchor.current.segmentId === hit.segmentId) {
              select(hit.segmentId, anchor.current.index, hit.index);
            } else {
              // §9.1 — spans may not cross segments. Say so, and offer the fix.
              const anchorIndex = indexOf.get(anchor.current.segmentId) ?? 0;
              const hitIndex = indexOf.get(hit.segmentId) ?? 0;
              const later = hitIndex > anchorIndex ? hit.segmentId : anchor.current.segmentId;
              store.getState().setSpanWarning(later);
              positionToolbar(hit.segment.words[hit.index].id);
            }
            return;
          }
          anchor.current = { segmentId: hit.segmentId, index: hit.index };
          dragging.current = true;
          select(hit.segmentId, hit.index, hit.index);
        }}
        onPointerMove={(event) => {
          if (!dragging.current || !anchor.current) return;
          const target = document.elementFromPoint(event.clientX, event.clientY);
          const hit = wordUnder(target);
          if (!hit || hit.segmentId !== anchor.current.segmentId) return;
          select(hit.segmentId, anchor.current.index, hit.index);
        }}
        onDoubleClick={(event) => {
          const hit = wordUnder(event.target as Element);
          if (!hit) return;
          const word = hit.segment.words[hit.index];
          const spanId = word.annotationId ?? word.correctionId;
          if (!spanId) return;
          const key = word.annotationId ? "annotationId" : "correctionId";
          const first = hit.segment.words.findIndex((w) => w[key] === spanId);
          let last = first;
          while (
            last + 1 < hit.segment.words.length &&
            hit.segment.words[last + 1][key] === spanId
          ) {
            last++;
          }
          anchor.current = { segmentId: hit.segmentId, index: first };
          select(hit.segmentId, first, last);
        }}
      >
        <div className="mx-auto mb-4 w-full max-w-[640px] rounded-panel glass-inset px-3 py-2.5 text-[12px] text-soft">
          <p className="font-medium" style={{ color: "var(--text-primary)" }}>
            Select transcript text to correct or annotate it.
          </p>
          <p className="mt-1 leading-relaxed">
            Use <strong>Correct</strong> only when the transcript does not match the audio.
            Keep dialectal and informal speech as spoken — do not translate or tidy the wording.
          </p>
        </div>
        <div
          ref={innerRef}
          className="relative mx-auto w-full max-w-[640px]"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={order[item.index]}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <SegmentRow
                segmentId={order[item.index]}
                searchHitIds={searchHitIds}
                searchCurrentWordId={currentHit?.wordId ?? null}
              />
            </div>
          ))}

          <div ref={cursorRef} className="word-cursor" style={{ opacity: 0 }} />

          {toolbarAt ? (
            <SelectionToolbar x={toolbarAt.x} y={toolbarAt.y} yAbove={toolbarAt.yAbove} />
          ) : null}
        </div>
      </div>

      <AnimatePresence>
        {!follow ? (
          <motion.button
            key="follow"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={SPRING}
            className="glass glass-e1 absolute bottom-4 left-1/2 z-20 -translate-x-1/2 px-3 py-1.5 text-[12px] font-medium"
            style={{ borderRadius: 9999 }}
            onClick={() => {
              store.getState().setFollow(true);
              const id = store.getState().activeSegmentId;
              const index = id ? indexOf.get(id) : undefined;
              const element = scrollRef.current;
              if (element && index !== undefined) {
                const offset = virtualizer.getOffsetForIndex(index, "center")?.[0];
                if (typeof offset === "number") springScroll(element, offset);
              }
            }}
          >
            Follow playback
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------
   A small critically-damped spring for the auto-scroll. `scroll-behavior:
   smooth` eases; this settles, which is what the Apple motion reads like.
------------------------------------------------------------------------- */

const springs = new WeakMap<Element, number>();

function springScroll(element: HTMLElement, target: number): void {
  cancelSpring(element);
  const stiffness = 170;
  const damping = 26;
  let position = element.scrollTop;
  let velocity = 0;
  let last = performance.now();

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    element.scrollTop = target;
    return;
  }

  const step = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    const force = -stiffness * (position - target) - damping * velocity;
    velocity += force * dt;
    position += velocity * dt;
    element.scrollTop = position;
    if (Math.abs(position - target) < 0.5 && Math.abs(velocity) < 2) {
      element.scrollTop = target;
      springs.delete(element);
      return;
    }
    springs.set(element, requestAnimationFrame(step));
  };
  springs.set(element, requestAnimationFrame(step));
}

function cancelSpring(element: Element): void {
  const frame = springs.get(element);
  if (frame) {
    cancelAnimationFrame(frame);
    springs.delete(element);
  }
}
