"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { formatTimecode, parseTimecode } from "@/lib/time";
import type { SegmentDTO } from "@/lib/dto";
import { useOpsQueue } from "./context";

/**
 * §8.4 — a compact mm:ss.mmm stepper. Arrows nudge by 10 ms, ⇧+arrow by
 * 100 ms. When a value would cross into a neighbour, the control offers to
 * push the neighbour rather than refusing the edit.
 */
export function TimeStepper({
  segment,
  field,
  onClose,
}: {
  segment: SegmentDTO;
  field: "start" | "end";
  onClose: () => void;
}) {
  const queue = useOpsQueue();
  const [value, setValue] = useState(segment[field]);
  const [text, setText] = useState(formatTimecode(segment[field], 3));
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const nudge = (delta: number) => {
    const next = Math.max(0, Math.round((value + delta) * 1000) / 1000);
    setValue(next);
    setText(formatTimecode(next, 3));
  };

  const commit = async (pushNeighbour: boolean) => {
    setBusy(true);
    setConflict(null);
    try {
      await queue.sendNow([
        {
          kind: "segment.timing",
          segmentId: segment.id,
          [field]: value,
          pushNeighbour,
        } as never,
      ]);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "That timing was refused.";
      if (/neighbour|above|below/i.test(message) && !pushNeighbour) setConflict(message);
      else setConflict(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}
      className="glass glass-e3 absolute z-30 mt-1 flex flex-col gap-2 p-2"
      style={{ borderRadius: "var(--radius-control)" }}
      onKeyDown={(event) => {
        event.stopPropagation();
        const step = event.shiftKey ? 0.1 : 0.01;
        if (event.key === "ArrowUp" || event.key === "ArrowRight") {
          event.preventDefault();
          nudge(step);
        } else if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(-step);
        } else if (event.key === "Enter") {
          event.preventDefault();
          void commit(false);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <span className="text-soft text-[11px]">
          {field === "start" ? "Segment start" : "Segment end"}
        </span>
        <input
          ref={inputRef}
          className="field mono h-7 w-[110px] text-[13px]"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = parseTimecode(event.target.value);
            if (parsed !== null) setValue(parsed);
          }}
        />
        <button className="control h-7" disabled={busy} onClick={() => void commit(false)}>
          Set
        </button>
        <button className="control control-plain h-7" onClick={onClose}>
          Cancel
        </button>
      </div>

      {conflict ? (
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: "var(--loanword)" }}>
            {conflict}
          </span>
          <button
            className="control h-7"
            disabled={busy}
            onClick={() => void commit(true)}
          >
            Push neighbour
          </button>
        </div>
      ) : (
        <span className="text-soft text-[11px]">
          Arrows nudge 10 ms · ⇧ arrows 100 ms · [ and ] set from the playhead
        </span>
      )}
    </motion.div>
  );
}
