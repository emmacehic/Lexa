"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

import { resolveLabel } from "@/lib/labels";
import { formatTimecode } from "@/lib/time";
import type { AnnotationDTO, SegmentDTO } from "@/lib/dto";
import { useOpsQueue, useWorkspace, useWorkspaceStore } from "./context";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

function segmentLabel(
  annotation: AnnotationDTO,
  segmentsById: Record<string, SegmentDTO>,
): string | null {
  const segId = annotation.segmentId;
  if (!segId) return null;
  const seg = segmentsById[segId];
  if (!seg) return null;
  const preview =
    seg.text.length > 50 ? `${seg.text.slice(0, 50)}\u2026` : seg.text;
  return `Segment ${seg.index + 1}: ${preview}`;
}

/**
 * \u00a79.4 \u2014 a quiet tray for annotations that lost their words. Nothing is ever
 * deleted silently; every orphan is here until a person decides.
 */
export function ReviewTray() {
  const annotationsById = useWorkspace((s) => s.annotationsById);
  const annotations = useMemo(
    () =>
      Object.values(annotationsById).filter((a) => a.status === "NEEDS_REVIEW"),
    [annotationsById],
  );
  const segmentsById = useWorkspace((s) => s.segmentsById);
  const customLabels = useWorkspace((s) => s.recording.customLabels);
  const reattaching = useWorkspace((s) => s.reattaching);
  const store = useWorkspaceStore();
  const queue = useOpsQueue();
  const [open, setOpen] = useState(false);

  if (annotations.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open ? (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={SPRING}
            className="glass glass-e3 pointer-events-auto w-[340px] max-w-[calc(100vw-2rem)] p-3"
            style={{ borderRadius: "var(--radius-panel)" }}
          >
            <h2 className="mb-2 text-[13px]">Annotations that lost their words</h2>
            <ul className="scroll-quiet flex max-h-[320px] flex-col gap-2 overflow-y-auto">
              {annotations.map((annotation) => {
                const label = resolveLabel(annotation.type, customLabels);
                const active = reattaching === annotation.id;
                const segRef = segmentLabel(annotation, segmentsById);
                return (
                  <li
                    key={annotation.id}
                    className="glass-inset p-2.5"
                    style={{ borderRadius: "var(--radius-control)" }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="pill"
                        style={{
                          background: `color-mix(in oklch, var(${label.varName}) 16%, transparent)`,
                          color: `var(${label.varName})`,
                        }}
                      >
                        {label.label}
                      </span>
                      <span className="timecode">
                        {formatTimecode(annotation.start)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px]">&ldquo;{annotation.surface}&rdquo;</p>
                    {segRef ? (
                      <p className="text-soft mt-0.5 truncate text-[11px]">{segRef}</p>
                    ) : null}
                    <div className="mt-2 flex gap-1.5">
                      <button
                        className="control h-7"
                        onClick={() =>
                          store.getState().setReattaching(active ? null : annotation.id)
                        }
                      >
                        {active ? "Cancel" : "Re-attach"}
                      </button>
                      <button
                        className="control h-7"
                        onClick={() => {
                          store.getState().removeAnnotationLocally(annotation.id);
                          queue.push({
                            kind: "ann.delete",
                            annotationId: annotation.id,
                          });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    {active ? (
                      <p className="text-soft mt-2 text-[11px]">
                        Select the words it belongs to, then choose &ldquo;Re-attach here&rdquo;.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        className="glass glass-e2 pointer-events-auto px-3 py-2 text-[12px] font-medium"
        style={{ borderRadius: 9999 }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {annotations.length} annotation{annotations.length === 1 ? "" : "s"} lost their
        words.
      </button>
    </div>
  );
}
