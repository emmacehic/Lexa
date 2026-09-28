"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { LanguageFlag } from "@/components/LanguageFlag";
import {
  filterWhisperLanguages,
  whisperLanguageByCode,
} from "@/lib/whisper-languages";

type Step = "projectName" | "speakerId" | "dominantLanguage" | "heritageLanguage";

const STEPS: Step[] = ["projectName", "speakerId", "dominantLanguage", "heritageLanguage"];

interface SpeakerData {
  name: string;
  dominantLanguage: string | null;
  heritageLanguage: string | null;
}

const INITIAL: SpeakerData = {
  name: "",
  dominantLanguage: null,
  heritageLanguage: null,
};

interface WizardUploadState {
  filename: string;
  sent: number;
  total: number;
  error: string | null;
}

export function MetadataWizard({
  recordingId,
  projectId,
  upload,
  onEnsureRecording,
}: {
  recordingId: string | null;
  projectId: string | null;
  upload: WizardUploadState | null;
  onEnsureRecording: (projectName: string) => Promise<{ recordingId: string; projectId: string }>;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("projectName");
  const [projectName, setProjectName] = useState("");
  const [created, setCreated] = useState<{ recordingId: string; projectId: string } | null>(
    recordingId && projectId ? { recordingId, projectId } : null,
  );
  const [data, setData] = useState<SpeakerData>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIdx = STEPS.indexOf(step);
  const ids = created ?? (recordingId && projectId ? { recordingId, projectId } : null);

  const ensureNamed = async (): Promise<{ recordingId: string; projectId: string }> => {
    if (ids) return ids;
    const name = projectName.trim();
    if (!name) {
      throw new Error("Name the project this recording belongs to.");
    }
    const next = await onEnsureRecording(name);
    setCreated(next);
    return next;
  };

  const stepAnswered = (current: Step): boolean => {
    switch (current) {
      case "projectName":
        return projectName.trim().length > 0;
      case "speakerId":
        return data.name.trim().length > 0;
      case "dominantLanguage":
        return Boolean(data.dominantLanguage);
      case "heritageLanguage":
        return Boolean(data.heritageLanguage);
    }
  };

  const wizardComplete = STEPS.every((s) => stepAnswered(s));

  const goNext = (force = false) => {
    if (!force && !stepAnswered(step)) return;
    if (step === "projectName") {
      void (async () => {
        setSaving(true);
        setError(null);
        try {
          await ensureNamed();
          setStep("speakerId");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not create the project.");
        } finally {
          setSaving(false);
        }
      })();
      return;
    }
    if (stepIdx < STEPS.length - 1) {
      setStep(STEPS[stepIdx + 1]);
    } else {
      void submit();
    }
  };

  const goBack = () => {
    if (stepIdx > 0) setStep(STEPS[stepIdx - 1]);
  };

  const submit = async () => {
    if (!wizardComplete) {
      setError("Answer every question before continuing.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const target = await ensureNamed();
      const res = await fetch("/api/speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          recordingId: target.recordingId,
          projectId: target.projectId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Could not save speaker metadata.");
      }
      router.push(`/r/${target.recordingId}/processing`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          background: "color-mix(in oklch, var(--bg) 60%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      />
      <motion.div
        className="glass glass-e3 relative z-10 m-4 w-full max-w-[480px] overflow-hidden"
        initial={{ y: 24, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
        style={{ borderRadius: "var(--radius-sheet)" }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-2">
          <h2 className="text-[16px] font-semibold">About this recording</h2>
          <p className="text-soft text-[12px]">
            Step {stepIdx + 1} of {STEPS.length}
          </p>
        </div>

        {/* Progress bar */}
        <div className="mx-5 mb-4 h-1 overflow-hidden" style={{ borderRadius: 9999, background: "var(--hairline)" }}>
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${((stepIdx + 1) / STEPS.length) * 100}%`,
              background: "var(--accent)",
              borderRadius: 9999,
            }}
          />
        </div>

        {upload ? (
          <div className="mx-5 mb-4">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[12px] font-medium">{upload.filename}</p>
              {!upload.error ? (
                <span className="timecode shrink-0">
                  {upload.total > 0
                    ? `${Math.round((upload.sent / upload.total) * 100)}%`
                    : "0%"}
                </span>
              ) : null}
            </div>
            {upload.error ? (
              <p className="mt-1 text-[12px]" style={{ color: "var(--loanword)" }}>
                {upload.error}
              </p>
            ) : (
              <div
                className="mt-1.5 h-[3px] overflow-hidden rounded-full"
                style={{
                  background: "color-mix(in oklch, var(--text) 10%, transparent)",
                }}
              >
                <div
                  style={{
                    width:
                      upload.total > 0
                        ? `${Math.round((upload.sent / upload.total) * 100)}%`
                        : "0%",
                    height: "100%",
                    background: "var(--accent)",
                    transition: "width 120ms var(--ease)",
                  }}
                />
              </div>
            )}
            {!upload.error && upload.total > 0 ? (
              <p className="text-soft mt-1 text-[11px]">
                {upload.sent === 0
                  ? upload.total >= 40 * 1024 * 1024
                    ? `Large file (${Math.round(upload.total / (1024 * 1024))} MB). Over the internet this can take 3–10 minutes — leave this tab open.`
                    : upload.total >= 10 * 1024 * 1024
                      ? `About ${Math.round(upload.total / (1024 * 1024))} MB — usually 1–4 minutes over the internet.`
                      : "Uploading…"
                  : upload.sent < upload.total
                    ? "Keep this tab open until the upload finishes."
                    : null}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Step content */}
        <div className="min-h-[200px] px-5 pb-5">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
            >
              {step === "projectName" && (
                <TextStep
                  label="Project name"
                  hint="Name the collection this recording belongs to. Type an existing name to add this file there."
                  value={projectName}
                  onChange={setProjectName}
                  onNext={goNext}
                  required
                  placeholder="e.g. Zürich interviews 2026"
                />
              )}
              {step === "speakerId" && (
                <SpeakerIdStep
                  value={data.name}
                  onChange={(v) => setData({ ...data, name: v })}
                />
              )}
              {step === "dominantLanguage" && (
                <CountryStep
                  label="Dominant"
                  hint="The language the speaker uses most in everyday life"
                  value={data.dominantLanguage}
                  onPick={(v) => {
                    setData({ ...data, dominantLanguage: v });
                    goNext(true);
                  }}
                />
              )}
              {step === "heritageLanguage" && (
                <CountryStep
                  label="Heritage"
                  hint="A family or community language the speaker identifies with"
                  value={data.heritageLanguage}
                  onPick={(v) => setData({ ...data, heritageLanguage: v })}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {error && (
            <p className="mt-3 text-[12px]" style={{ color: "var(--loanword)" }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer nav */}
        <div
          className="flex items-center justify-between border-t px-5 py-3"
          style={{ borderColor: "var(--hairline)" }}
        >
          <button
            className="control control-plain h-8 text-[12px]"
            onClick={goBack}
            disabled={stepIdx === 0}
          >
            ‹ Back
          </button>
          <div className="flex gap-2">
            {stepIdx === STEPS.length - 1 ? (
              <button
                className="control control-primary h-8 text-[12px]"
                onClick={submit}
                disabled={saving || !wizardComplete}
              >
                {saving ? "Saving…" : "Save & continue"}
              </button>
            ) : (
              <button
                className="control control-primary h-8 text-[12px]"
                onClick={() => goNext()}
                disabled={saving || !stepAnswered(step)}
              >
                {saving && step === "projectName" ? "Starting…" : "Next ›"}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step components                                                    */
/* ------------------------------------------------------------------ */

function parseSpeakerId(value: string): { langs: string[]; count: string } {
  const match = /^([A-Za-z]{2}(?:_[A-Za-z]{2})*)_(\d{2})$/.exec(value.trim());
  if (!match) return { langs: [], count: "" };
  return {
    langs: match[1].split("_").map((l) => l.toUpperCase()),
    count: String(Number(match[2])),
  };
}

function composeSpeakerId(langs: string[], count: string): string {
  const n = count === "5+" ? 5 : Number(count);
  if (langs.length === 0 || !n) return "";
  return `${langs.map((l) => l.toUpperCase()).join("_")}_${String(n).padStart(2, "0")}`;
}

function languageForCode(lang: string) {
  return whisperLanguageByCode(lang);
}

function SpeakerIdStep({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const parsed = parseSpeakerId(value);
  const [langs, setLangs] = useState<string[]>(parsed.langs);
  const [count, setCount] = useState(parsed.count === "5" ? "5+" : parsed.count);
  const [adding, setAdding] = useState(parsed.langs.length === 0);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) searchRef.current?.focus();
  }, [adding]);

  const apply = (nextLangs: string[], nextCount: string) => {
    setLangs(nextLangs);
    setCount(nextCount);
    const id = composeSpeakerId(nextLangs, nextCount);
    if (id) onChange(id);
    else onChange("");
  };

  const addLang = (lang: { code: string; name: string }) => {
    const code = lang.code.toUpperCase();
    if (langs.includes(code)) {
      setSearch("");
      setAdding(false);
      return;
    }
    apply([...langs, code], count);
    setSearch("");
    setAdding(false);
  };

  const removeLang = (code: string) => {
    const next = langs.filter((l) => l !== code);
    apply(next, count);
    if (next.length === 0) setAdding(true);
  };

  const filtered = filterWhisperLanguages(search);

  const preview = composeSpeakerId(langs, count);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[14px] font-medium">Speaker ID</p>
        <p className="text-soft text-[12px]">
          Pick the language(s) with flags, then how many people are speaking.
        </p>
      </div>

      <div>
        <p className="text-soft mb-1.5 text-[12px]">Language</p>
        {langs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {langs.map((code) => {
              const lang = languageForCode(code);
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
                    onClick={() => removeLang(code)}
                    aria-label={`Remove ${code}`}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {adding ? (
          <>
            <input
              ref={searchRef}
              className="field h-9 px-3 text-[13px]"
              placeholder="Search language…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <div className="scroll-quiet mt-2 flex max-h-[240px] flex-col overflow-y-auto">
              {filtered.map((lang) => (
                <LanguageRow
                  key={lang.code}
                  language={lang}
                  selected={langs.includes(lang.code.toUpperCase())}
                  onClick={() => addLang(lang)}
                />
              ))}
            </div>
            {langs.length > 0 && (
              <button
                type="button"
                className="control control-plain mt-2 h-8 w-full text-[12px]"
                onClick={() => { setAdding(false); setSearch(""); }}
              >
                Done adding
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className="control h-8 w-full text-[12px]"
            onClick={() => setAdding(true)}
          >
            Add another language
          </button>
        )}
      </div>

      <div>
        <p className="text-soft mb-1.5 text-[12px]">How many people are speaking?</p>
        <div className="flex flex-wrap gap-2">
          {["1", "2", "3", "4", "5+"].map((n) => (
            <button
              key={n}
              type="button"
              className="control h-9 px-4 text-[13px]"
              style={
                count === n
                  ? {
                      background: "color-mix(in oklch, var(--accent) 16%, transparent)",
                      borderColor: "var(--accent)",
                    }
                  : undefined
              }
              onClick={() => apply(langs, n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[13px]">
        {preview ? (
          <>
            ID: <span className="font-medium" style={{ color: "var(--accent)" }}>{preview}</span>
          </>
        ) : (
          <span className="text-soft">Pick a language and a speaker count — e.g. DE_02</span>
        )}
      </p>
    </div>
  );
}

function TextStep({
  label,
  hint,
  value,
  onChange,
  onNext,
  required,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  required?: boolean;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[14px] font-medium">{label}</p>
        <p className="text-soft text-[12px]">{hint}</p>
      </div>
      <input
        ref={inputRef}
        className="field h-9 px-3 text-[13px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (!required || value.trim())) onNext();
        }}
        placeholder={placeholder ?? label}
      />
    </div>
  );
}

function CountryStep({
  label,
  hint,
  value,
  onPick,
}: {
  label: string;
  hint: string;
  value: string | null;
  onPick: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = filterWhisperLanguages(search);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-[14px] font-medium">{label}</p>
        <p className="text-soft text-[12px]">{hint}</p>
      </div>
      <input
        ref={inputRef}
        className="field h-9 px-3 text-[13px]"
        placeholder="Search language…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="scroll-quiet flex max-h-[240px] flex-col overflow-y-auto">
        {filtered.map((lang) => (
          <LanguageRow
            key={lang.code}
            language={lang}
            selected={value === lang.name}
            onClick={() => onPick(lang.name)}
          />
        ))}
      </div>
    </div>
  );
}

function LanguageRow({
  language,
  selected,
  onClick,
}: {
  language: { code: string; name: string };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-2.5 px-2 py-1.5 text-left text-[13px]"
      style={{
        borderRadius: "var(--radius-control)",
        background: selected
          ? "color-mix(in oklch, var(--accent) 12%, transparent)"
          : undefined,
      }}
      onClick={onClick}
    >
      <LanguageFlag tag={language.code} size={18} />
      <span className="flex-1">{language.name}</span>
      <span className="text-soft text-[11px]">{language.code}</span>
    </button>
  );
}
