"use client";

import type { KeyboardEvent } from "react";

export function TranscriptSearch({
  query,
  matchCount,
  currentIndex,
  onQueryChange,
  onPrev,
  onNext,
}: {
  query: string;
  matchCount: number;
  currentIndex: number;
  onQueryChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const status = !hasQuery
    ? ""
    : matchCount === 0
      ? "No matches"
      : `${currentIndex + 1} of ${matchCount}`;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (hasQuery) onQueryChange("");
      else event.currentTarget.blur();
    }
  };

  return (
    <div
      className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3"
      style={{
        background: "color-mix(in oklch, var(--bg) 92%, transparent)",
      }}
    >
      <div className="mx-auto flex w-full max-w-[640px] items-center gap-2">
        <input
          id="transcript-search"
          className="field h-8 min-w-0 flex-1 text-[13px]"
          type="search"
          value={query}
          placeholder="Find in transcript"
          autoComplete="off"
          spellCheck={false}
          aria-label="Find in transcript"
          aria-controls="transcript-search-status"
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <span
          id="transcript-search-status"
          className="timecode shrink-0"
          aria-live="polite"
        >
          {status || "\u00a0"}
        </span>
        <button
          type="button"
          className="control h-8 px-2.5"
          aria-label="Previous match"
          disabled={!hasQuery || matchCount === 0}
          onClick={onPrev}
        >
          ↑
        </button>
        <button
          type="button"
          className="control h-8 px-2.5"
          aria-label="Next match"
          disabled={!hasQuery || matchCount === 0}
          onClick={onNext}
        >
          ↓
        </button>
      </div>
    </div>
  );
}
