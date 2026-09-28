"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useState } from "react";

import { CODE_SWITCH, CORRECTION, LOANWORD, UNCLEAR } from "@/lib/labels";
import { formatDuration } from "@/lib/time";

interface CorpusRecording {
  id: string;
  filename: string;
  durationSec: number;
  languages: string[];
  projectName: string;
  speakerName: string | null;
  sourceUrl: string | null;
  sourceContext: string | null;
  speaker: {
    name: string;
    ageGroup: string | null;
    gender: string | null;
    mainLanguage: string | null;
    otherLanguages: string[];
    dominantLanguage: string | null;
    bilingualStatus: string | null;
    heritageLanguage: string | null;
    countryOrRegion: string | null;
    currentCountry: string | null;
    generation: string | null;
    languageAtHome: string | null;
    speakerRole: string | null;
    metadataSource: string | null;
  } | null;
}

interface CorpusSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  speakerTag: string | null;
  isReviewed: boolean;
  annotationTypes: string[];
}

interface CorpusAnnotation {
  id: string;
  type: string;
  surface: string;
  start: number;
  end: number;
  languageTag: string | null;
  nativeAlternative: string | null;
  pronunciation: string | null;
  confidence: string | null;
  note: string | null;
  status: string;
  annotatedBy: string;
  annotatedAt: string;
  segmentIndex: number | null;
}

interface CorpusPayload {
  recording: CorpusRecording;
  segments: CorpusSegment[];
  annotations: CorpusAnnotation[];
}

function sampleType(types: string[]): string {
  const linguistic = types.filter((t) => t !== CORRECTION);
  if (linguistic.length === 0) return "";
  const hasLoan = linguistic.includes(LOANWORD);
  const hasCS = linguistic.includes(CODE_SWITCH);
  if (hasLoan && hasCS) return "BOTH";
  if (hasLoan) return "LOAN_ONLY";
  if (hasCS) return "CS_ONLY";
  if (linguistic.includes(UNCLEAR)) return "UNCLEAR";
  return "ANNOTATED";
}

function labelName(type: string): string {
  if (type === LOANWORD) return "LOANWORD";
  if (type === CODE_SWITCH) return "CODE_SWITCH";
  if (type === UNCLEAR) return "UNCLEAR";
  if (type === CORRECTION) return "CORRECTION";
  return type.toUpperCase();
}

function labelColor(type: string): string {
  if (type === LOANWORD) return "var(--loanword)";
  if (type === CODE_SWITCH) return "var(--codeswitch)";
  if (type === UNCLEAR) return "var(--unclear)";
  if (type === CORRECTION) return "var(--correction)";
  return "var(--text-secondary)";
}

function formatMmSs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(1).padStart(4, "0")}`;
}

type Tab = "samples" | "annotations" | "metadata" | "corrections";

export function CorpusPreview({ recordingId }: { recordingId: string }) {
  const [tab, setTab] = useState<Tab>("samples");
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<CorpusPayload>({
    queryKey: ["corpus-preview", recordingId],
    queryFn: async () => {
      const res = await fetch(
        `/api/recordings/${recordingId}/export/corpus`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message ?? "Could not load corpus data.",
        );
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  const updateAnnotation = useCallback(
    async (
      annotationId: string,
      patch: Record<string, string | null | undefined>,
    ) => {
      const res = await fetch(`/api/recordings/${recordingId}/ops`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ops: [{ kind: "ann.update", annotationId, ...patch }],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Update failed.");
      }
      await queryClient.invalidateQueries({
        queryKey: ["corpus-preview", recordingId],
      });
    },
    [recordingId, queryClient],
  );

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-soft text-[14px]">Loading corpus data…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <p className="text-[14px]" style={{ color: "var(--loanword)" }}>
          {(error as Error)?.message ?? "Failed to load."}
        </p>
        <Link className="control" href={`/r/${recordingId}`}>
          Back to workspace
        </Link>
      </div>
    );
  }

  const { recording, segments, annotations } = data;
  const linguistic = annotations.filter((a) => a.type !== CORRECTION);
  const corrections = annotations.filter((a) => a.type === CORRECTION);

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="glass glass-e2 z-30 flex h-14 shrink-0 items-center gap-3 px-4"
        style={{
          borderRadius: 0,
          borderLeft: "none",
          borderRight: "none",
          borderTop: "none",
        }}
      >
        <Link className="control control-plain" href={`/r/${recordingId}`}>
          ‹ Workspace
        </Link>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">
          Corpus Preview
          <span className="text-soft"> · {recording.filename}</span>
        </span>
        <a
          className="control control-primary"
          href={`/api/recordings/${recordingId}/export?format=xlsx`}
          download
        >
          Export XLSX
        </a>
        <Link className="control" href={`/r/${recordingId}/export`}>
          All formats
        </Link>
      </header>

      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b px-4 py-2.5"
        style={{ borderColor: "var(--hairline)" }}
      >
        <MetaItem label="Project" value={recording.projectName} />
        <MetaItem label="Languages" value={recording.languages.join(", ")} />
        <MetaItem label="Duration" value={formatDuration(recording.durationSec)} />
        {recording.speakerName && (
          <MetaItem label="Speaker" value={recording.speakerName} />
        )}
        <MetaItem
          label="Segments"
          value={`${segments.length} (${segments.filter((s) => s.isReviewed).length} reviewed)`}
        />
        <MetaItem
          label="Linguistic annotations"
          value={String(linguistic.length)}
        />
        <MetaItem label="Transcript corrections" value={String(corrections.length)} />
        <MetaItem label="Total marked items" value={String(annotations.length)} />
      </div>

      <div
        className="flex gap-1 border-b px-4 pt-1"
        style={{ borderColor: "var(--hairline)" }}
      >
        <TabButton
          active={tab === "samples"}
          onClick={() => setTab("samples")}
          label={`Samples (${segments.length})`}
        />
        <TabButton
          active={tab === "annotations"}
          onClick={() => setTab("annotations")}
          label={`Annotations (${linguistic.length})`}
        />
        <TabButton
          active={tab === "metadata"}
          onClick={() => setTab("metadata")}
          label="Metadata"
        />
        <TabButton
          active={tab === "corrections"}
          onClick={() => setTab("corrections")}
          label={`Corrections (${corrections.length})`}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "samples" ? (
          <SamplesTable segments={segments} recording={recording} />
        ) : tab === "annotations" ? (
          <AnnotationsTable
            annotations={linguistic}
            languages={recording.languages}
            onUpdate={updateAnnotation}
          />
        ) : tab === "metadata" ? (
          <MetadataTable recording={recording} />
        ) : (
          <CorrectionsTable
            corrections={corrections}
            onUpdate={updateAnnotation}
          />
        )}
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-[12px]">
      <span className="text-soft">{label}: </span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 text-[13px] font-medium transition-colors"
      style={{
        borderBottom: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
      }}
    >
      {label}
    </button>
  );
}

function SamplesTable({
  segments,
  recording,
}: {
  segments: CorpusSegment[];
  recording: CorpusRecording;
}) {
  if (segments.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-soft text-[14px]">No segments in this recording.</p>
      </div>
    );
  }

  return (
    <table className="corpus-table w-full text-[12px]">
      <thead>
        <tr>
          <th>ID</th>
          <th>Start</th>
          <th>End</th>
          <th>Transcript</th>
          <th>Speaker</th>
          <th>Type</th>
          <th>Reviewed</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((seg) => {
          const type = sampleType(seg.annotationTypes);
          return (
            <tr key={seg.index}>
              <td className="mono whitespace-nowrap">
                S{String(seg.index + 1).padStart(3, "0")}
              </td>
              <td className="mono whitespace-nowrap">{formatMmSs(seg.start)}</td>
              <td className="mono whitespace-nowrap">{formatMmSs(seg.end)}</td>
              <td className="max-w-[420px]">{seg.text}</td>
              <td className="whitespace-nowrap">
                {recording.speakerName ?? seg.speakerTag ?? ""}
              </td>
              <td className="whitespace-nowrap">
                {type ? (
                  <TypePill type={type} />
                ) : null}
              </td>
              <td className="text-center">{seg.isReviewed ? "✓" : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TypePill({ type }: { type: string }) {
  const colorVar =
    type === "BOTH"
      ? "--accent"
      : type === "LOAN_ONLY"
        ? "--loanword"
        : type === "CS_ONLY"
          ? "--codeswitch"
          : "--unclear";
  return (
    <span
      className="pill"
      style={{
        background: `color-mix(in oklch, var(${colorVar}) 12%, transparent)`,
        color: `var(${colorVar})`,
      }}
    >
      {type}
    </span>
  );
}

function AnnotationsTable({
  annotations,
  languages,
  onUpdate,
}: {
  annotations: CorpusAnnotation[];
  languages: string[];
  onUpdate: (id: string, patch: Record<string, string | null | undefined>) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (annotations.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[14px] font-medium">Nothing annotated yet.</p>
        <p className="text-soft text-[12px]">
          Annotations you create in the workspace will appear here.
        </p>
      </div>
    );
  }

  return (
    <table className="corpus-table w-full text-[12px]">
      <thead>
        <tr>
          <th>Sample</th>
          <th>Time</th>
          <th>Form</th>
          <th>Label</th>
          <th>Language</th>
          <th>Native alt.</th>
          <th>Pronunciation</th>
          <th>Confidence</th>
          <th>Note</th>
          <th>Status</th>
          <th>Annotator</th>
        </tr>
      </thead>
      <tbody>
        {annotations.map((a) =>
          editingId === a.id ? (
            <AnnotationEditRow
              key={a.id}
              annotation={a}
              languages={languages}
              onSave={async (patch) => {
                await onUpdate(a.id, patch);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <AnnotationReadRow
              key={a.id}
              annotation={a}
              onEdit={() => setEditingId(a.id)}
            />
          ),
        )}
      </tbody>
    </table>
  );
}

function EditableCell({
  value,
  onEdit,
}: {
  value: string | null;
  onEdit: () => void;
}) {
  return (
    <td
      onClick={onEdit}
      className="cursor-pointer"
      style={{ minWidth: 60 }}
      title="Click to edit"
    >
      {value ? (
        value
      ) : (
        <span className="text-soft hover:text-[var(--accent)]" style={{ borderBottom: "1px dashed var(--hairline)" }}>
          —
        </span>
      )}
    </td>
  );
}

function AnnotationReadRow({
  annotation: a,
  onEdit,
}: {
  annotation: CorpusAnnotation;
  onEdit: () => void;
}) {
  return (
    <tr onClick={onEdit} className="cursor-pointer">
      <td className="mono whitespace-nowrap">
        {a.segmentIndex !== null
          ? `S${String(a.segmentIndex + 1).padStart(3, "0")}`
          : "—"}
      </td>
      <td className="mono whitespace-nowrap">{formatMmSs(a.start)}</td>
      <td className="font-medium">{a.surface}</td>
      <td>
        <span
          className="pill"
          style={{
            background: `color-mix(in oklch, ${labelColor(a.type)} 14%, transparent)`,
            color: labelColor(a.type),
          }}
        >
          {labelName(a.type)}
        </span>
      </td>
      <EditableCell value={a.languageTag} onEdit={onEdit} />
      <EditableCell value={a.nativeAlternative} onEdit={onEdit} />
      <EditableCell value={a.pronunciation} onEdit={onEdit} />
      <EditableCell value={a.confidence} onEdit={onEdit} />
      <EditableCell value={a.note} onEdit={onEdit} />
      <td>
        {a.status === "NEEDS_REVIEW" ? (
          <span
            className="pill"
            style={{
              background:
                "color-mix(in oklch, var(--loanword) 14%, transparent)",
              color: "var(--loanword)",
            }}
          >
            Review
          </span>
        ) : (
          <span className="text-soft">Active</span>
        )}
      </td>
      <td className="whitespace-nowrap">{a.annotatedBy}</td>
    </tr>
  );
}

function AnnotationEditRow({
  annotation: a,
  languages,
  onSave,
  onCancel,
}: {
  annotation: CorpusAnnotation;
  languages: string[];
  onSave: (patch: Record<string, string | null>) => Promise<void>;
  onCancel: () => void;
}) {
  const [languageTag, setLanguageTag] = useState(a.languageTag ?? "");
  const [nativeAlt, setNativeAlt] = useState(a.nativeAlternative ?? "");
  const [pronunciation, setPronunciation] = useState(a.pronunciation ?? "");
  const [confidence, setConfidence] = useState(a.confidence ?? "");
  const [note, setNote] = useState(a.note ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        languageTag: languageTag.trim() || null,
        nativeAlternative: nativeAlt.trim() || null,
        pronunciation: pronunciation || null,
        confidence: confidence || null,
        note: note.trim() || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr style={{ background: "color-mix(in oklch, var(--accent) 6%, transparent)" }}>
      <td className="mono whitespace-nowrap">
        {a.segmentIndex !== null
          ? `S${String(a.segmentIndex + 1).padStart(3, "0")}`
          : "—"}
      </td>
      <td className="mono whitespace-nowrap">{formatMmSs(a.start)}</td>
      <td className="font-medium">{a.surface}</td>
      <td>
        <span
          className="pill"
          style={{
            background: `color-mix(in oklch, ${labelColor(a.type)} 14%, transparent)`,
            color: labelColor(a.type),
          }}
        >
          {labelName(a.type)}
        </span>
      </td>
      <td>
        <select
          className="field h-6 w-[80px] px-1 text-[11px]"
          value={languageTag}
          onChange={(e) => setLanguageTag(e.target.value)}
        >
          <option value="">—</option>
          {languages.map((code) => {
            const short = code.split("-")[0];
            return (
              <option key={code} value={short}>
                {code}
              </option>
            );
          })}
        </select>
      </td>
      <td>
        <input
          className="field h-6 w-full min-w-[80px] px-1 text-[11px]"
          placeholder="Native alt."
          value={nativeAlt}
          onChange={(e) => setNativeAlt(e.target.value)}
        />
      </td>
      <td>
        <select
          className="field h-6 w-auto px-1 text-[11px]"
          value={pronunciation}
          onChange={(e) => setPronunciation(e.target.value)}
        >
          <option value="">—</option>
          <option value="local">local</option>
          <option value="foreign">foreign</option>
          <option value="mixed/unclear">mixed/unclear</option>
        </select>
      </td>
      <td>
        <select
          className="field h-6 w-auto px-1 text-[11px]"
          value={confidence}
          onChange={(e) => setConfidence(e.target.value)}
        >
          <option value="">—</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </td>
      <td>
        <input
          className="field h-6 w-full min-w-[100px] px-1 text-[11px]"
          placeholder="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </td>
      <td colSpan={2}>
        <div className="flex items-center gap-1">
          <button
            className="control control-primary h-6 px-2 text-[11px]"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            className="control h-6 px-2 text-[11px]"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
        {err ? (
          <p className="mt-1 text-[10px]" style={{ color: "var(--loanword)" }}>
            {err}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

function MetadataTable({ recording }: { recording: CorpusRecording }) {
  const sp = recording.speaker;
  const rows: { label: string; value: string }[] = [
    { label: "Speaker ID", value: sp?.name ?? recording.speakerName ?? "—" },
    { label: "Age group", value: sp?.ageGroup ?? "—" },
    { label: "Gender", value: sp?.gender ?? "—" },
    { label: "Dominant", value: sp?.dominantLanguage ?? sp?.mainLanguage ?? "—" },
    { label: "Other languages", value: sp?.otherLanguages.length ? sp.otherLanguages.join(", ") : "—" },
    { label: "Bilingual status", value: sp?.bilingualStatus ?? "—" },
    { label: "Heritage", value: sp?.heritageLanguage ?? "—" },
    { label: "Country / region", value: sp?.countryOrRegion ?? "—" },
    { label: "Current country", value: sp?.currentCountry ?? "—" },
    { label: "Generation", value: sp?.generation ?? "—" },
    { label: "Language at home", value: sp?.languageAtHome ?? "—" },
    { label: "Speaker role", value: sp?.speakerRole ?? "—" },
    { label: "Metadata source", value: sp?.metadataSource ?? "—" },
    { label: "Source URL", value: recording.sourceUrl ?? "—" },
    { label: "Source context", value: recording.sourceContext ?? "—" },
  ];

  return (
    <table className="corpus-table w-full max-w-[720px] text-[12px]">
      <thead>
        <tr>
          <th>Field</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td className="whitespace-nowrap text-soft">{row.label}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CorrectionsTable({
  corrections,
  onUpdate,
}: {
  corrections: CorpusAnnotation[];
  onUpdate: (id: string, patch: Record<string, string | null | undefined>) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (corrections.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[14px] font-medium">No spelling corrections yet.</p>
        <p className="text-soft text-[12px]">
          Select a word in the workspace and press Correct above it.
        </p>
      </div>
    );
  }

  return (
    <table className="corpus-table w-full text-[12px]">
      <thead>
        <tr>
          <th>Sample</th>
          <th>Time</th>
          <th>As written</th>
          <th>Corrected</th>
          <th>Confidence</th>
          <th>Annotator</th>
        </tr>
      </thead>
      <tbody>
        {corrections.map((a) =>
          editingId === a.id ? (
            <CorrectionEditRow
              key={a.id}
              annotation={a}
              onSave={async (patch) => {
                await onUpdate(a.id, patch);
                setEditingId(null);
              }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <tr
              key={a.id}
              className="cursor-pointer"
              onClick={() => setEditingId(a.id)}
              title="Click to edit"
            >
              <td className="mono whitespace-nowrap">
                {a.segmentIndex !== null
                  ? `S${String(a.segmentIndex + 1).padStart(3, "0")}`
                  : "—"}
              </td>
              <td className="mono whitespace-nowrap">{formatMmSs(a.start)}</td>
              <td>{a.surface}</td>
              <td>
                <span style={{ color: "var(--correction)" }}>
                  {a.nativeAlternative ?? "—"}
                </span>
              </td>
              <td>{a.confidence ?? "—"}</td>
              <td>{a.annotatedBy}</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}

function CorrectionEditRow({
  annotation: a,
  onSave,
  onCancel,
}: {
  annotation: CorpusAnnotation;
  onSave: (patch: Record<string, string | null>) => Promise<void>;
  onCancel: () => void;
}) {
  const [corrected, setCorrected] = useState(a.nativeAlternative ?? "");
  const [confidence, setConfidence] = useState(a.confidence ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        nativeAlternative: corrected.trim() || null,
        confidence: confidence || null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
      setSaving(false);
    }
  };

  return (
    <tr>
      <td className="mono whitespace-nowrap">
        {a.segmentIndex !== null
          ? `S${String(a.segmentIndex + 1).padStart(3, "0")}`
          : "—"}
      </td>
      <td className="mono whitespace-nowrap">{formatMmSs(a.start)}</td>
      <td>{a.surface}</td>
      <td>
        <input
          className="field h-6 w-full min-w-[120px] px-1 text-[11px]"
          value={corrected}
          onChange={(e) => setCorrected(e.target.value)}
          autoFocus
        />
      </td>
      <td>
        <select
          className="field h-6 text-[11px]"
          value={confidence}
          onChange={(e) => setConfidence(e.target.value)}
        >
          <option value="">—</option>
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </select>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <button
            className="control control-primary h-6 px-2 text-[11px]"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="control h-6 px-2 text-[11px]" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
        {err ? (
          <p className="mt-1 text-[10px]" style={{ color: "var(--loanword)" }}>
            {err}
          </p>
        ) : null}
      </td>
    </tr>
  );
}
