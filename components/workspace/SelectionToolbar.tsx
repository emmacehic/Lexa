"use client";

import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BUILT_IN_LABELS, CODE_SWITCH, CORRECTION, LOANWORD, UNCLEAR, resolveLabel } from "@/lib/labels";
import { LanguageFlag } from "@/components/LanguageFlag";
import {
  filterWhisperLanguages,
  whisperLanguageByCode,
} from "@/lib/whisper-languages";
import type { AnnotationDTO } from "@/lib/dto";
import { useOpsQueue, useWorkspace, useWorkspaceStore } from "./context";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9 };

type WizardStep = "type" | "language" | "pronunciation" | "confidence" | "nativeAlt" | "note";

const WIZARD_STEPS: WizardStep[] = [
  "language",
  "pronunciation",
  "confidence",
  "nativeAlt",
  "note",
];

interface WizardState {
  type: string;
  languageTag: string | null;
  pronunciation: "local" | "foreign" | "mixed/unclear" | null;
  confidence: "high" | "medium" | "low" | null;
  nativeAlternative: string | null;
  note: string | null;
}

/**
 * §9.2 — the only floating element in the app. A small glass capsule anchored
 * beneath the selection, on a 180 ms spring.
 */
export function SelectionToolbar({ x, y, yAbove }: { x: number; y: number; yAbove: number }) {
  const selection = useWorkspace((s) => s.selection);
  const spanWarning = useWorkspace((s) => s.spanWarning);
  const reattaching = useWorkspace((s) => s.reattaching);
  const annotationsById = useWorkspace((s) => s.annotationsById);
  const languages = useWorkspace((s) => s.recording.languageCodes);
  const customLabels = useWorkspace((s) => s.recording.customLabels);
  const locked = useWorkspace((s) => s.recording.status === "COMPLETE");
  const pendingWizardType = useWorkspace((s) => s.pendingWizardType);
  const store = useWorkspaceStore();
  const queue = useOpsQueue();
  const [wizardStep, setWizardStep] = useState<WizardStep | null>(null);
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [open, setOpen] = useState(false);
  const [correctionStep, setCorrectionStep] = useState<"spelling" | "confidence" | null>(null);

  const resetWizard = () => {
    setWizardStep(null);
    setWizard(null);
    setCorrectionStep(null);
    store.getState().setPendingWizardType(null);
  };

  useEffect(() => {
    if (pendingWizardType) {
      setCorrectionStep(null);
      setWizard({
        type: pendingWizardType,
        languageTag: null,
        pronunciation: null,
        confidence: null,
        nativeAlternative: null,
        note: null,
      });
      setWizardStep("language");
      store.getState().setPendingWizardType(null);
    }
  }, [pendingWizardType, store]);

  if (spanWarning) {
    return (
      <ToolbarCluster x={x} y={y} yAbove={yAbove} below={
        <Capsule>
          <span className="max-w-[320px] text-[12px]">
            Code-switches cannot cross segments. Merge the segments first (⌫ at the
            segment start).
          </span>
          <button
            className="control h-7"
            onClick={() => {
              queue.push({ kind: "segment.merge", segmentId: spanWarning });
              store.getState().setSpanWarning(null);
            }}
          >
            Merge
          </button>
        </Capsule>
      } />
    );
  }

  if (!selection || locked) return null;

  if (reattaching) {
    return (
      <ToolbarCluster x={x} y={y} yAbove={yAbove} below={
        <Capsule>
          <span className="text-[12px]">Re-attach the annotation to these words?</span>
          <button
            className="control control-primary h-7"
            onClick={() => {
              queue.push({
                kind: "ann.reattach",
                annotationId: reattaching,
                wordIds: selection.wordIds,
              });
              store.getState().setReattaching(null);
              store.getState().setSelection(null);
              store.getState().announce("Annotation re-attached");
            }}
          >
            Re-attach here
          </button>
          <button
            className="control control-plain h-7"
            onClick={() => store.getState().setReattaching(null)}
          >
            Cancel
          </button>
        </Capsule>
      } />
    );
  }

  const linguistic =
    selection.annotationId &&
    annotationsById[selection.annotationId]?.type !== CORRECTION
      ? (annotationsById[selection.annotationId] ?? null)
      : null;
  const correction =
    selection.correctionId &&
    annotationsById[selection.correctionId]?.type === CORRECTION
      ? (annotationsById[selection.correctionId] ?? null)
      : null;

  const commitAnnotation = (state: WizardState) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const segment = store.getState().segmentsById[selection.segmentId];
    const words = segment
      ? segment.words.filter((w) => selection.wordIds.includes(w.id))
      : [];
    const optimistic: AnnotationDTO = {
      id: tempId,
      type: state.type,
      surface: words.map((w) => w.text).join(" "),
      start: words[0]?.start ?? 0,
      end: words[words.length - 1]?.end ?? 0,
      languageTag: state.languageTag,
      nativeAlternative: state.nativeAlternative,
      pronunciation: state.pronunciation,
      confidence: state.confidence,
      note: state.note,
      status: "ACTIVE",
      createdById: "",
      createdByName: "",
      updatedAt: new Date().toISOString(),
      segmentId: selection.segmentId,
      wordIds: selection.wordIds,
    };
    store.getState().attachOptimisticAnnotation(optimistic);
    store
      .getState()
      .announce(
        `${BUILT_IN_LABELS[state.type]?.label ?? state.type} marked: ${
          state.type === CORRECTION
            ? (state.nativeAlternative ?? optimistic.surface)
            : optimistic.surface
        }`,
      );
    queue.push({
      kind: "ann.create",
      tempId,
      wordIds: selection.wordIds,
      type: state.type,
      languageTag: state.languageTag,
      nativeAlternative: state.nativeAlternative,
      pronunciation: state.pronunciation,
      confidence: state.confidence,
      note: state.note,
    });
    if (state.type === CORRECTION) {
      store.getState().setSelection({
        ...selection,
        correctionId: tempId,
      });
    } else {
      store.getState().setSelection({
        ...selection,
        annotationId: tempId,
      });
    }
    resetWizard();
  };

  const startCorrection = () => {
    setWizard({
      type: CORRECTION,
      languageTag: null,
      pronunciation: null,
      confidence: null,
      nativeAlternative: null,
      note: null,
    });
    setWizardStep(null);
    setCorrectionStep("spelling");
  };

  const startWizard = (type: string) => {
    setWizard({
      type,
      languageTag: null,
      pronunciation: null,
      confidence: null,
      nativeAlternative: null,
      note: null,
    });
    setWizardStep("language");
    setCorrectionStep(null);
  };

  const advanceWizard = (currentStep: WizardStep) => {
    const idx = WIZARD_STEPS.indexOf(currentStep);
    if (idx < WIZARD_STEPS.length - 1) {
      setWizardStep(WIZARD_STEPS[idx + 1]);
    } else if (wizard) {
      commitAnnotation(wizard);
    }
  };

  const goBackWizard = (currentStep: WizardStep) => {
    const idx = WIZARD_STEPS.indexOf(currentStep);
    if (idx > 0) {
      setWizardStep(WIZARD_STEPS[idx - 1]);
    } else {
      resetWizard();
    }
  };

  const remove = (annotationId: string) => {
    store.getState().removeAnnotationLocally(annotationId);
    queue.push({ kind: "ann.delete", annotationId });
    store.getState().setSelection({
      ...selection,
      annotationId: selection.annotationId === annotationId ? null : selection.annotationId,
      correctionId: selection.correctionId === annotationId ? null : selection.correctionId,
    });
    store.getState().announce("Annotation removed");
  };

  const linguisticWizard = Boolean(wizard && wizardStep && wizard.type !== CORRECTION);
  const correctionWizardOpen = Boolean(correctionStep && wizard);

  const above = correctionWizardOpen && wizard ? (
    <Capsule wide>
      {correctionStep === "spelling" ? (
        <CorrectionSpellingStep
          surface={
            (store.getState().segmentsById[selection.segmentId]?.words ?? [])
              .filter((w) => selection.wordIds.includes(w.id))
              .map((w) => w.text)
              .join(" ")
          }
          onBack={resetWizard}
          onNext={(spelling) => {
            setWizard({ ...wizard, nativeAlternative: spelling });
            setCorrectionStep("confidence");
          }}
        />
      ) : (
        <CorrectionConfidenceStep
          onBack={() => setCorrectionStep("spelling")}
          onPick={(confidence) => {
            commitAnnotation({ ...wizard, confidence });
          }}
        />
      )}
    </Capsule>
  ) : correction ? (
    <Capsule>
      <span
        className="pill"
        style={{
          background: `color-mix(in oklch, var(${BUILT_IN_LABELS[CORRECTION].varName}) 16%, transparent)`,
          color: `var(${BUILT_IN_LABELS[CORRECTION].varName})`,
        }}
      >
        Corrected: {correction.nativeAlternative ?? correction.surface}
      </span>
      <button className="control h-7" onClick={() => remove(correction.id)}>
        Remove
      </button>
    </Capsule>
  ) : (
    <Capsule>
      <button className="control h-7" onClick={startCorrection}>
        Correct
      </button>
    </Capsule>
  );

  let below: React.ReactNode;
  if (linguisticWizard && wizard && wizardStep) {
    const stepIdx = WIZARD_STEPS.indexOf(wizardStep);
    const stepNum = stepIdx + 1;
    const totalSteps = WIZARD_STEPS.length;
    const typeLabel = BUILT_IN_LABELS[wizard.type]?.label ?? wizard.type;
    below = (
      <Capsule wide>
        <div className="flex w-full flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="pill" style={{
              background: `color-mix(in oklch, var(${BUILT_IN_LABELS[wizard.type]?.varName ?? "--accent"}) 16%, transparent)`,
              color: `var(${BUILT_IN_LABELS[wizard.type]?.varName ?? "--accent"})`,
            }}>
              {typeLabel}
            </span>
            <span className="text-soft text-[10px]">
              {stepNum}/{totalSteps}
            </span>
          </div>
          {wizardStep === "language" && (
            <WizardLanguageStep
              languages={languages}
              onPick={(tag) => {
                setWizard({ ...wizard, languageTag: tag });
                advanceWizard("language");
              }}
              onBack={() => goBackWizard("language")}
            />
          )}
          {wizardStep === "pronunciation" && (
            <WizardChoiceStep
              label="Pronunciation"
              options={[
                { value: "local", label: "Local" },
                { value: "foreign", label: "Foreign" },
                { value: "mixed/unclear", label: "Mixed / unclear" },
              ]}
              onPick={(v) => {
                setWizard({ ...wizard, pronunciation: v as "local" | "foreign" | "mixed/unclear" });
                advanceWizard("pronunciation");
              }}
              onBack={() => goBackWizard("pronunciation")}
            />
          )}
          {wizardStep === "confidence" && (
            <WizardChoiceStep
              label="Confidence"
              options={[
                { value: "high", label: "High" },
                { value: "medium", label: "Medium" },
                { value: "low", label: "Low" },
              ]}
              onPick={(v) => {
                setWizard({ ...wizard, confidence: v as "high" | "medium" | "low" });
                advanceWizard("confidence");
              }}
              onBack={() => goBackWizard("confidence")}
            />
          )}
          {wizardStep === "nativeAlt" && (
            <WizardTextStep
              label="Native alternative"
              placeholder="e.g. the word in the base language"
              onSubmit={(v) => {
                setWizard({ ...wizard, nativeAlternative: v || null });
                advanceWizard("nativeAlt");
              }}
              onBack={() => goBackWizard("nativeAlt")}
            />
          )}
          {wizardStep === "note" && (
            <WizardTextStep
              label="Note"
              placeholder="Any comment on this annotation"
              onSubmit={(v) => {
                setWizard({ ...wizard, note: v || null });
                commitAnnotation({ ...wizard, note: v || null });
              }}
              onSkip={() => commitAnnotation(wizard)}
              onBack={() => goBackWizard("note")}
              finishLabel="Done"
            />
          )}
        </div>
      </Capsule>
    );
  } else if (linguistic) {
    const label = resolveLabel(linguistic.type, customLabels);
    below = (
      <Capsule>
        <span
          className="pill"
          style={{
            background: `color-mix(in oklch, var(${label.varName}) 16%, transparent)`,
            color: `var(${label.varName})`,
          }}
        >
          {label.label}
          {linguistic.languageTag ? ` · ${linguistic.languageTag}` : ""}
        </span>
        <button className="control h-7" onClick={() => remove(linguistic.id)}>
          Remove ⌫
        </button>
        <button
          className="control control-plain h-7 px-2"
          aria-expanded={open}
          aria-label="Edit details"
          onClick={() => setOpen((v) => !v)}
        >
          ⌄
        </button>
        {open ? (
          <Details
            annotation={linguistic}
            languages={languages}
            customLabels={customLabels}
            onChange={(patch) => {
              queue.push({ kind: "ann.update", annotationId: linguistic.id, ...patch });
            }}
          />
        ) : null}
      </Capsule>
    );
  } else {
    below = (
      <Capsule>
        <button className="control h-7" onClick={() => startWizard(LOANWORD)}>
          Loanword <span className="text-soft">⌥L</span>
        </button>
        <button className="control h-7" onClick={() => startWizard(CODE_SWITCH)}>
          Code-switch <span className="text-soft">⌥C</span>
        </button>
        <button className="control h-7" onClick={() => startWizard(UNCLEAR)}>
          Unclear <span className="text-soft">⌥U</span>
        </button>
        {customLabels.length > 0 ? (
          <>
            <button
              className="control control-plain h-7 px-2"
              aria-expanded={open}
              aria-label="More label types"
              onClick={() => setOpen((v) => !v)}
            >
              ⌄
            </button>
            {open
              ? customLabels.map((cl) => (
                  <button
                    key={cl.type}
                    className="control h-7"
                    onClick={() => startWizard(cl.type)}
                  >
                    {cl.label}
                  </button>
                ))
              : null}
          </>
        ) : null}
      </Capsule>
    );
  }

  return (
    <ToolbarCluster x={x} y={y} yAbove={yAbove} above={above} below={below} />
  );
}

/* ------------------------------------------------------------------ */
/* Viewport-safe cluster                                              */
/* ------------------------------------------------------------------ */

const TOOLBAR_PAD = 8;
const TOOLBAR_GAP = 8;

function ToolbarCluster({
  x,
  y,
  yAbove,
  above,
  below,
}: {
  x: number;
  y: number;
  yAbove: number;
  above?: ReactNode;
  below: ReactNode;
}) {
  const aboveRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ left: number; aboveTop: number; belowTop: number } | null>(null);

  useLayoutEffect(() => {
    const fit = () => {
      const aboveEl = aboveRef.current;
      const belowEl = belowRef.current;
      if (!belowEl) return;
      const aboveH = aboveEl?.offsetHeight ?? 0;
      const belowH = belowEl.offsetHeight;
      const width = Math.max(aboveEl?.offsetWidth ?? 0, belowEl.offsetWidth, 1);
      const maxBottom = window.innerHeight - TOOLBAR_PAD;

      let left = x - 20;
      if (left + width > window.innerWidth - TOOLBAR_PAD) {
        left = window.innerWidth - TOOLBAR_PAD - width;
      }
      if (left < TOOLBAR_PAD) left = TOOLBAR_PAD;

      let aboveTop = yAbove - TOOLBAR_GAP - aboveH;
      if (aboveEl && aboveTop < TOOLBAR_PAD) aboveTop = TOOLBAR_PAD;

      let belowTop = y;
      if (belowTop + belowH > maxBottom) {
        belowTop = maxBottom - belowH;
      }
      if (belowTop < TOOLBAR_PAD) belowTop = TOOLBAR_PAD;

      if (aboveEl && belowTop < aboveTop + aboveH + TOOLBAR_GAP) {
        belowTop = aboveTop + aboveH + TOOLBAR_GAP;
        if (belowTop + belowH > maxBottom) {
          const overflow = belowTop + belowH - maxBottom;
          aboveTop = Math.max(TOOLBAR_PAD, aboveTop - overflow);
          belowTop = aboveTop + aboveH + TOOLBAR_GAP;
        }
      }

      setLayout((prev) => {
        if (
          prev &&
          Math.abs(prev.left - left) < 0.5 &&
          Math.abs(prev.aboveTop - aboveTop) < 0.5 &&
          Math.abs(prev.belowTop - belowTop) < 0.5
        ) {
          return prev;
        }
        return { left, aboveTop, belowTop };
      });
    };

    fit();
    const observer = new ResizeObserver(fit);
    if (aboveRef.current) observer.observe(aboveRef.current);
    if (belowRef.current) observer.observe(belowRef.current);
    return () => observer.disconnect();
  }, [x, y, yAbove]);

  if (typeof document === "undefined") return null;

  const visible = layout ? "visible" : "hidden";

  return createPortal(
    <>
      {above ? (
        <div
          ref={aboveRef}
          className="fixed z-40"
          style={{
            left: layout?.left ?? x,
            top: layout?.aboveTop ?? Math.max(TOOLBAR_PAD, yAbove - 80),
            visibility: visible,
          }}
        >
          {above}
        </div>
      ) : null}
      <div
        ref={belowRef}
        className="fixed z-40"
        style={{
          left: layout?.left ?? x,
          top: layout?.belowTop ?? y,
          visibility: visible,
        }}
      >
        {below}
      </div>
    </>,
    document.body,
  );
}

function Capsule({
  children,
  wide,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.div
      role="toolbar"
      aria-label="Annotate selection"
      initial={{ opacity: 0, y: -4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING}
      className="glass glass-e3 flex flex-wrap items-center gap-1.5 p-1.5"
      style={{
        borderRadius: wide ? "var(--radius-control)" : 9999,
        maxWidth: wide ? 360 : 420,
        width: wide ? 320 : undefined,
        maxHeight: "min(320px, calc(100dvh - 24px))",
        overflowY: wide ? "auto" : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Wizard steps                                                       */
/* ------------------------------------------------------------------ */

function WizardLanguageStep({
  languages,
  onPick,
  onBack,
}: {
  languages: string[];
  onPick: (tag: string) => void;
  onBack: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const projectLangs = languages
    .map((tag) => ({ tag, lang: whisperLanguageByCode(tag) }))
    .filter((entry): entry is { tag: string; lang: NonNullable<ReturnType<typeof whisperLanguageByCode>> } =>
      Boolean(entry.lang),
    );

  const filtered = filterWhisperLanguages(search);

  const confirm = () => {
    if (from && to) {
      onPick(`${from}→${to}`);
    } else if (from) {
      onPick(from);
    }
  };

  return (
    <>
      <span className="text-[12px] font-medium">Source language</span>

      {/* Quick picks from project languages */}
      {projectLangs.length > 0 && !from && (
        <div className="flex flex-wrap gap-1.5">
          {projectLangs.map(({ tag, lang }) => (
              <button
                key={tag}
                className="control h-8 gap-2 px-3 text-[12px]"
                onClick={() => setFrom(lang.code)}
              >
                <LanguageFlag tag={tag} size={16} />
                {lang.name}
              </button>
            ))}
        </div>
      )}

      {/* Country selection */}
      <div className="flex w-full items-center gap-2">
        <CountrySlot
          label="From"
          code={from}
          onClear={() => setFrom("")}
        />
        <span className="text-soft text-[14px]">→</span>
        <CountrySlot
          label="To"
          code={to}
          onClear={() => setTo("")}
        />
      </div>

      {/* Dropdown picker for whichever slot is empty */}
      {(!from || !to) && (
        <>
          <input
            className="field h-7 w-full px-2 text-[12px]"
            placeholder="Search language…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
          <div
            className="scroll-quiet flex max-h-[160px] w-full flex-col overflow-y-auto"
            style={{ borderRadius: "var(--radius-control)" }}
          >
            {filtered.map((lang) => (
                <button
                  key={lang.code}
                  className="flex items-center gap-2 px-2 py-1.5 text-left text-[12px] hover:bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]"
                  style={{ borderRadius: "var(--radius-control)" }}
                  onClick={() => {
                    if (!from) {
                      setFrom(lang.code);
                      setSearch("");
                    } else {
                      setTo(lang.code);
                      setSearch("");
                    }
                  }}
                >
                  <LanguageFlag tag={lang.code} size={16} />
                  <span>{lang.name}</span>
                  <span className="text-soft ml-auto">{lang.code}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {/* Confirm when both selected */}
      {from && to && (
        <button
          className="control control-primary h-7 w-full text-[12px]"
          onClick={confirm}
        >
          Confirm
        </button>
      )}

      <WizardNav
        onBack={onBack}
        onSkip={from && !to ? confirm : undefined}
        skipLabel="Just one language ›"
      />
    </>
  );
}

function CountrySlot({
  label,
  code,
  onClear,
}: {
  label: string;
  code: string;
  onClear: () => void;
}) {
  const lang = whisperLanguageByCode(code);

  if (!lang) {
    return (
      <div
        className="flex h-8 flex-1 items-center justify-center gap-1 text-[11px]"
        style={{
          border: "1px dashed var(--hairline)",
          borderRadius: "var(--radius-control)",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </div>
    );
  }

  return (
    <div
      className="flex h-8 flex-1 items-center gap-2 px-2 text-[12px]"
      style={{
        background: "color-mix(in oklch, var(--accent) 8%, transparent)",
        borderRadius: "var(--radius-control)",
      }}
    >
      <LanguageFlag tag={code} size={16} />
      <span className="font-medium">{lang.name}</span>
      <button
        className="text-soft ml-auto text-[10px] hover:text-[var(--text-primary)]"
        onClick={onClear}
        aria-label={`Remove ${lang.name}`}
      >
        ✕
      </button>
    </div>
  );
}

function WizardChoiceStep({
  label,
  options,
  onPick,
  onBack,
}: {
  label: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
  onBack: () => void;
}) {
  return (
    <>
      <span className="text-[12px] font-medium">{label}?</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            className="control h-7 px-3 text-[12px]"
            onClick={() => onPick(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <WizardNav onBack={onBack} />
    </>
  );
}

function WizardTextStep({
  label,
  placeholder,
  onSubmit,
  onSkip,
  onBack,
  finishLabel,
}: {
  label: string;
  placeholder: string;
  onSubmit: (value: string) => void;
  onSkip?: () => void;
  onBack: () => void;
  finishLabel?: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <>
      <span className="text-[12px] font-medium">{label}</span>
      <div className="flex w-full gap-1.5">
        <input
          ref={inputRef}
          className="field h-7 min-w-0 flex-1 px-2 text-[12px]"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              onSubmit(value.trim());
            }
          }}
        />
        <button
          className="control control-primary h-7 px-2 text-[12px]"
          onClick={() => onSubmit(value.trim())}
        >
          {finishLabel ?? "Next"}
        </button>
      </div>
      <WizardNav
        onBack={onBack}
        onSkip={onSkip}
        skipLabel={finishLabel ? "Skip & finish" : "Skip"}
      />
    </>
  );
}

function WizardNav({
  onBack,
  onSkip,
  skipLabel = "Skip",
}: {
  onBack: () => void;
  onSkip?: () => void;
  skipLabel?: string;
}) {
  return (
    <div className="flex w-full items-center justify-between">
      <button
        className="control control-plain h-6 px-2 text-[11px]"
        onClick={onBack}
      >
        ‹ Back
      </button>
      {onSkip ? (
        <button
          className="control control-plain h-6 px-2 text-[11px]"
          onClick={onSkip}
        >
          {skipLabel}
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

function CorrectionSpellingStep({
  surface,
  onBack,
  onNext,
}: {
  surface: string;
  onBack: () => void;
  onNext: (spelling: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-[12px] font-medium">Correct spelling</span>
      <p className="text-soft text-[11px]">
        As written: <span className="font-medium">{surface}</span>
      </p>
      <div className="flex w-full gap-1.5">
        <input
          ref={inputRef}
          className="field h-7 min-w-0 flex-1 px-2 text-[12px]"
          placeholder="How should this be spelled?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && value.trim()) onNext(value.trim());
          }}
        />
        <button
          className="control control-primary h-7 px-2 text-[12px]"
          disabled={!value.trim()}
          onClick={() => onNext(value.trim())}
        >
          Next
        </button>
      </div>
      <WizardNav onBack={onBack} />
    </div>
  );
}

function CorrectionConfidenceStep({
  onBack,
  onPick,
}: {
  onBack: () => void;
  onPick: (value: "high" | "medium" | "low") => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-[12px] font-medium">How sure are you?</span>
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
          ] as const
        ).map((opt) => (
          <button
            key={opt.value}
            className="control h-7 px-3 text-[12px]"
            onClick={() => onPick(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <WizardNav onBack={onBack} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Edit details for existing annotation                               */
/* ------------------------------------------------------------------ */

function Details({
  annotation,
  languages,
  customLabels,
  onChange,
}: {
  annotation: AnnotationDTO;
  languages: string[];
  customLabels: { type: string; label: string }[];
  onChange: (patch: {
    type?: string;
    languageTag?: string | null;
    nativeAlternative?: string | null;
    pronunciation?: "local" | "foreign" | "mixed/unclear" | null;
    confidence?: "high" | "medium" | "low" | null;
    note?: string | null;
  }) => void;
}) {
  const [note, setNote] = useState(annotation.note ?? "");
  const [tag, setTag] = useState(annotation.languageTag ?? "");
  const [nativeAlt, setNativeAlt] = useState(annotation.nativeAlternative ?? "");

  return (
    <div className="mt-1 flex w-full flex-col gap-2 border-t pt-2 hairline">
      <div className="flex items-center gap-1.5">
        <span className="text-soft text-[11px]">Tag</span>
        <input
          className="field h-6 w-[96px] px-2 text-[11px]"
          list="lexa-languages"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          onBlur={() => onChange({ languageTag: tag.trim() || null })}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <datalist id="lexa-languages">
          {languages.map((code) => (
            <option key={code} value={code.split("-")[0]} />
          ))}
        </datalist>

        <select
          className="field h-6 w-auto px-1 text-[11px]"
          value={annotation.type}
          onChange={(event) => onChange({ type: event.target.value })}
        >
          {Object.entries(BUILT_IN_LABELS)
            .filter(([type]) => type !== CORRECTION)
            .map(([type, style]) => (
            <option key={type} value={type}>
              {style.label}
            </option>
          ))}
          {customLabels.map((label) => (
            <option key={label.type} value={label.type}>
              {label.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-soft text-[11px]">Pronunciation</span>
        <select
          className="field h-6 w-auto px-1 text-[11px]"
          value={annotation.pronunciation ?? ""}
          onChange={(event) =>
            onChange({ pronunciation: (event.target.value || null) as "local" | "foreign" | "mixed/unclear" | null })
          }
        >
          <option value="">—</option>
          <option value="local">local</option>
          <option value="foreign">foreign</option>
          <option value="mixed/unclear">mixed/unclear</option>
        </select>
        <span className="text-soft text-[11px]">Confidence</span>
        <select
          className="field h-6 w-auto px-1 text-[11px]"
          value={annotation.confidence ?? ""}
          onChange={(event) =>
            onChange({ confidence: (event.target.value || null) as "high" | "medium" | "low" | null })
          }
        >
          <option value="">—</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </div>
      <input
        className="field h-6 px-2 text-[11px]"
        placeholder="Native alternative"
        value={nativeAlt}
        onChange={(event) => setNativeAlt(event.target.value)}
        onBlur={() => onChange({ nativeAlternative: nativeAlt.trim() || null })}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <input
        className="field h-6 px-2 text-[11px]"
        placeholder="Note"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => onChange({ note: note.trim() || null })}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}
