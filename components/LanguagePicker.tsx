"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { LanguageFlag } from "@/components/LanguageFlag";
import {
  filterWhisperLanguages,
  whisperLanguageByCode,
  type WhisperLanguage,
} from "@/lib/whisper-languages";

export function LanguagePicker({
  selected,
  onChange,
  multiple = true,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const filtered = filterWhisperLanguages(search);

  function toggle(code: string) {
    if (selected.includes(code)) {
      onChange(selected.filter((c) => c !== code));
      return;
    }
    onChange(multiple ? [...selected, code] : [code]);
    if (!multiple) setOpen(false);
  }

  return (
    <div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((code) => {
            const lang = whisperLanguageByCode(code);
            return (
              <span
                key={code}
                className="flex items-center gap-1.5 px-2 py-1 text-[12px]"
                style={{
                  borderRadius: "var(--radius-control)",
                  background: "color-mix(in oklch, var(--accent) 12%, transparent)",
                  color: "var(--accent)",
                }}
              >
                <LanguageFlag tag={code} size={14} />
                {lang?.name ?? code}
                <button
                  type="button"
                  className="ml-0.5 opacity-60 hover:opacity-100"
                  onClick={() => toggle(code)}
                >
                  ✕
                </button>
              </span>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="control h-8 w-full text-[12px]"
        onClick={() => setOpen(!open)}
      >
        {open
          ? "Close"
          : selected.length
            ? "Add more languages"
            : "Select languages"}
      </button>

      {open ? (
        <LanguageScrollList
          search={search}
          searchRef={searchRef}
          onSearch={setSearch}
          filtered={filtered}
          selected={selected}
          onToggle={toggle}
        />
      ) : null}
    </div>
  );
}

export function LanguageScrollList({
  search,
  searchRef,
  onSearch,
  filtered,
  selected,
  onToggle,
  placeholder = "Search language…",
  maxHeight = 240,
}: {
  search: string;
  searchRef?: RefObject<HTMLInputElement | null>;
  onSearch: (value: string) => void;
  filtered: WhisperLanguage[];
  selected: string[];
  onToggle: (code: string) => void;
  placeholder?: string;
  maxHeight?: number;
}) {
  return (
    <div
      className="mt-2 overflow-hidden"
      style={{
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius-control)",
      }}
    >
      <input
        ref={searchRef}
        className="field w-full border-0"
        placeholder={placeholder}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div
        className="scroll-quiet overflow-y-auto"
        style={{ maxHeight }}
      >
        {filtered.length === 0 ? (
          <p className="text-soft px-3 py-2 text-[12px]">No matching language.</p>
        ) : (
          filtered.map((lang) => {
            const isOn = selected.includes(lang.code);
            return (
              <button
                type="button"
                key={lang.code}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]"
                onClick={() => onToggle(lang.code)}
              >
                <LanguageFlag tag={lang.code} size={16} />
                <span className="flex-1">{lang.name}</span>
                {isOn ? (
                  <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
                    ✓
                  </span>
                ) : null}
                <span className="text-soft text-[11px]">{lang.code}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
