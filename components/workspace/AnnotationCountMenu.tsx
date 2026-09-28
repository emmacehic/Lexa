"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { jumpableAnnotations } from "@/lib/annotation-jump";
import { formatTimecode } from "@/lib/time";
import { useWorkspace, useWorkspaceStore } from "./context";

export function AnnotationCountMenu({
  type,
  label,
  colorVar,
}: {
  type: string;
  label: string;
  colorVar: string;
}) {
  const annotationsById = useWorkspace((s) => s.annotationsById);
  const store = useWorkspaceStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => jumpableAnnotations(Object.values(annotationsById), type),
    [annotationsById, type],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="pill"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`${items.length} ${label}. Show list.`}
        style={{
          background: `color-mix(in oklch, var(${colorVar}) 14%, transparent)`,
          color: `var(${colorVar})`,
          border: "none",
          cursor: "pointer",
        }}
        onClick={() => setOpen((current) => !current)}
      >
        {items.length} {label}
      </button>
      {open ? (
        <div
          className="glass glass-e3 absolute left-0 top-full z-40 mt-1.5 w-[min(280px,calc(100vw-2rem))] overflow-hidden"
          style={{ borderRadius: "var(--radius-row)" }}
          role="menu"
          aria-label={label}
        >
          {items.length === 0 ? (
            <p className="text-soft px-3 py-2.5 text-[12px]">
              No {label} on this recording yet.
            </p>
          ) : (
            <ul className="scroll-quiet m-0 max-h-[280px] list-none overflow-y-auto p-1">
              {items.map((annotation) => (
                <li key={annotation.id}>
                  <button
                    type="button"
                    role="menuitem"
                    className="control control-plain h-auto w-full justify-start px-2.5 py-1.5 text-left"
                    onClick={() => {
                      store.getState().requestFocusAnnotation(annotation.id);
                      setOpen(false);
                    }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13px] font-medium">
                        {annotation.surface}
                      </span>
                      <span className="timecode">
                        {formatTimecode(annotation.start)}
                        {annotation.languageTag
                          ? ` · ${annotation.languageTag}`
                          : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
