"use client";

import { Sheet } from "@/components/ui/Sheet";

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Playback",
    rows: [
      ["Space", "Play / pause"],
      ["← →", "∓2 s · with ⇧ ∓10 s"],
      ["↑ ↓", "Previous / next segment, and seek there"],
      ["⌥← ⌥→", "Previous / next word"],
      ["1–9", "Playback speed 0.5× – 2×"],
      ["⌥-click a segment", "Play just that segment"],
    ],
  },
  {
    title: "Editing",
    rows: [
      ["E", "Edit the active segment · Esc commits and exits"],
      ["R", "Toggle reviewed on the active segment"],
      ["[ ]", "Set segment start / end to the playhead"],
      ["⌘↵", "Split the segment at the caret"],
      ["⌫ at the segment start", "Merge into the segment above"],
    ],
  },
  {
    title: "Annotation",
    rows: [
      ["⌥L", "Mark the selection as a loanword"],
      ["⌥C", "Mark the selection as a code-switch"],
      ["⌥U", "Mark the selection as unclear"],
      ["⌫", "Remove the annotation under the selection"],
    ],
  },
  {
    title: "Everything else",
    rows: [
      ["⌘Z · ⌘⇧Z", "Undo / redo"],
      ["⌘E", "Export"],
      ["⌘F", "Find in transcript"],
      ["?", "This sheet"],
    ],
  },
];

/** The only help surface in the product (§12). */
export function ShortcutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Keyboard shortcuts" width={620}>
      <div className="max-h-[80dvh] overflow-y-auto p-6 scroll-quiet">
        <div className="mb-5 flex items-center justify-between">
          <h1>Keyboard</h1>
          <button className="control" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="flex flex-col gap-6">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h2 className="text-soft mb-2 text-[12px] font-medium">{group.title}</h2>
              <dl className="flex flex-col gap-1.5">
                {group.rows.map(([keys, description]) => (
                  <div key={keys} className="flex items-baseline gap-4">
                    <dt className="mono w-[180px] shrink-0 text-[12px]">{keys}</dt>
                    <dd className="m-0 text-[13px]">{description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
