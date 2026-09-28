"use client";

import { useEffect } from "react";

/**
 * Modal that asks once, by name, before a destructive delete.
 */
export function ConfirmDeleteDialog({
  open,
  filename,
  message,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  filename: string;
  message: string;
  deleting: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, deleting, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        background: "color-mix(in oklch, var(--bg) 55%, transparent)",
      }}
      role="presentation"
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <div
        className="glass glass-e3 w-full max-w-[420px] p-6"
        style={{ borderRadius: "var(--radius-panel)" }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        aria-describedby="confirm-delete-body"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className="text-[17px] font-medium">
          Delete this transcription?
        </h2>
        <p id="confirm-delete-body" className="mt-2 text-[14px] leading-relaxed">
          Are you sure you want to delete <strong>{filename}</strong>? {message}
        </p>
        {error ? (
          <p className="mt-3 text-[13px]" role="alert" style={{ color: "var(--loanword)" }}>
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="control" disabled={deleting} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="control"
            disabled={deleting}
            style={{ color: "var(--loanword)" }}
            onClick={onConfirm}
          >
            {deleting ? "Deleting…" : "Yes, delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
