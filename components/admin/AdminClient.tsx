"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutButton } from "@/components/SignOutButton";
import { UsersPanel } from "@/components/admin/UsersPanel";
import type { UserWork } from "@/lib/admin-users";
import { BUILT_IN_LABELS } from "@/lib/labels";
import { DELETE_PROJECT_CONFIRM_MESSAGE } from "@/lib/project-delete-messages";

interface Member {
  id: string;
  name: string;
  email: string;
}

interface ProjectRow {
  id: string;
  name: string;
  languageCodes: string[];
  customLabels: { type: string; label: string }[];
  recordingCount: number;
  members: Member[];
}

interface InviteRow {
  id: string;
  email: string | null;
  role: string;
  projectId: string;
  projectName: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

interface RecordingRow {
  id: string;
  filename: string;
  projectId: string;
  status: string;
  assignedToId: string | null;
  assignedToName: string | null;
  speakerId: string | null;
  speakerName: string | null;
  sourceUrl: string | null;
  sourceContext: string | null;
  durationSec: number;
  segmentCount: number;
  reviewedCount: number;
}

interface Stats {
  recordings: number;
  byType: { type: string; count: number }[];
  byLanguage: { languageTag: string; count: number }[];
  byContributor: { userId: string; name: string; count: number }[];
  topLoanwords: { surface: string; count: number }[];
  byPronunciation: { pronunciation: string; count: number }[];
  byConfidence: { confidence: string; count: number }[];
  needsReview: number;
  totalDuration: number;
}

/** §7 — projects, members, invites and per-project corpus statistics. */
export function AdminClient({
  projects: initialProjects,
  users,
}: {
  projects: ProjectRow[];
  users: { id: string; name: string; email: string; role: string }[];
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [selected, setSelected] = useState(initialProjects[0]?.id ?? "");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<
    "stats" | "recordings" | "invites" | "speakers" | "iaa" | "guidelines" | "users"
  >("stats");
  const [projects, setProjects] = useState(initialProjects);

  const project = projects.find((p) => p.id === selected) ?? null;

  const { data: stats } = useQuery<Stats>({
    queryKey: ["admin-stats", selected],
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/stats${selected ? `?projectId=${selected}` : ""}`,
      );
      if (!response.ok) throw new Error("Statistics unavailable.");
      return response.json();
    },
  });

  const { data: invites } = useQuery<InviteRow[]>({
    queryKey: ["admin-invites"],
    queryFn: async () => {
      const response = await fetch("/api/invites");
      if (!response.ok) return [];
      const body = await response.json();
      return body.invites ?? [];
    },
    enabled: tab === "invites",
  });

  const { data: recordings, refetch: refetchRecordings } = useQuery<RecordingRow[]>({
    queryKey: ["admin-recordings", selected],
    queryFn: async () => {
      if (!selected) return [];
      const response = await fetch(`/api/admin/recordings?projectId=${selected}`);
      if (!response.ok) return [];
      const body = await response.json();
      return body.recordings ?? [];
    },
    enabled: tab === "recordings" || tab === "iaa",
  });

  const { data: projectSpeakers } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["admin-speakers-list", selected],
    queryFn: async () => {
      if (!selected) return [];
      const response = await fetch(`/api/projects/${selected}/speakers`);
      if (!response.ok) return [];
      const body = await response.json();
      return (body.speakers ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name }));
    },
    enabled: (tab === "recordings" || tab === "speakers") && selected !== "",
  });

  const { data: people, isPending: peoplePending, isError: peopleError } = useQuery<{ users: UserWork[] }>({
    queryKey: ["admin-users", selected],
    queryFn: async () => {
      const response = await fetch(
        `/api/admin/users${selected ? `?projectId=${selected}` : ""}`,
      );
      if (!response.ok) throw new Error("Could not load users.");
      return response.json();
    },
    enabled: tab === "users",
  });

  const projectInvites = useMemo(
    () => (invites ?? []).filter((i) => i.projectId === selected),
    [invites, selected],
  );

  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 pb-24 pt-10">
      <header className="mb-8 flex items-center justify-between">
        <h1>Admin</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link className="control" href="/library">
            Library
          </Link>
          <SignOutButton />
        </div>
      </header>

      <section className="mb-6">
        <h2 className="mb-2">Projects</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="control"
            aria-pressed={selected === ""}
            style={{
              background: selected === "" ? "color-mix(in oklch, var(--accent) 14%, transparent)" : undefined,
              borderColor: selected === "" ? "var(--accent)" : undefined,
            }}
            onClick={() => { setSelected(""); setTab("stats"); }}
          >
            All projects
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className="control"
              aria-pressed={selected === p.id}
              style={{
                background:
                  selected === p.id
                    ? "color-mix(in oklch, var(--accent) 14%, transparent)"
                    : undefined,
                borderColor: selected === p.id ? "var(--accent)" : undefined,
              }}
              onClick={() => { setSelected(p.id); setTab("stats"); }}
            >
              <span className="flex flex-col items-start">
                <span>{p.name}</span>
                <span className="text-soft text-[10px]">
                  {p.languageCodes.join(", ")} · {p.recordingCount} rec.
                </span>
              </span>
            </button>
          ))}
          <CreateProject onCreated={() => router.refresh()} onError={setError} />
        </div>
      </section>

      {error ? (
        <p role="alert" className="mb-4 text-[13px]" style={{ color: "var(--loanword)" }}>
          {error}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
            {(["stats", "users", "recordings", "invites", "speakers", "iaa", "guidelines"] as const).map((t) => {
              const needsProject = t !== "stats" && t !== "users";
              const disabled = needsProject && !project;
              return (
              <button
                key={t}
                className="control"
                aria-pressed={tab === t}
                disabled={disabled}
                style={{
                  background: tab === t ? "color-mix(in oklch, var(--accent) 14%, transparent)" : undefined,
                  borderColor: tab === t ? "var(--accent)" : undefined,
                  opacity: disabled ? 0.4 : undefined,
                }}
                onClick={() => setTab(t)}
              >
                {{ stats: "Statistics", users: "People", recordings: "Recordings", invites: "Invitations", speakers: "Speakers", iaa: "Agreement", guidelines: "Guidelines" }[t]}
              </button>
              );
            })}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {project && tab !== "users" ? (
            <>
            <Panel title={`${project.name} — settings`}>
              <ProjectEditor
                project={project}
                onSaved={(updated) => {
                  setProjects((prev) =>
                    prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
                  );
                  setError(null);
                }}
                onError={setError}
              />
            </Panel>

            <Panel title={`${project.name} — members`}>
              <ul className="mb-3 flex flex-col gap-1">
                {project.members.map((member) => (
                  <li key={member.id} className="flex items-center gap-2 text-[13px]">
                    <span className="flex-1 truncate">
                      {member.name}
                      <span className="text-soft"> · {member.email}</span>
                    </span>
                    <button
                      className="control h-7"
                      onClick={async () => {
                        const response = await fetch(
                          `/api/projects/${project.id}/members?userId=${member.id}`,
                          { method: "DELETE" },
                        );
                        if (!response.ok) {
                          const body = await response.json().catch(() => null);
                          setError(body?.error?.message ?? "Could not remove that member.");
                          return;
                        }
                        router.refresh();
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <AddMember
                projectId={project.id}
                users={users.filter(
                  (u) => !project.members.some((m) => m.id === u.id),
                )}
                onDone={() => router.refresh()}
              />
              <DeleteProjectPanel
                project={project}
                onDeleted={(id) => {
                  setProjects((prev) => prev.filter((p) => p.id !== id));
                  if (selected === id) setSelected("");
                  setError(null);
                  router.refresh();
                }}
                onError={setError}
              />
              <div className="mt-3 border-t pt-3 hairline">
                <div className="flex gap-2">
                  <button
                    className="control control-primary"
                    onClick={async () => {
                      const response = await fetch("/api/invites", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ projectId: project.id }),
                      });
                      const body = await response.json().catch(() => null);
                      if (!response.ok) {
                        setError(body?.error?.message ?? "The invitation could not be created.");
                        return;
                      }
                      setInviteUrl(body.url);
                      void qc.invalidateQueries({ queryKey: ["admin-invites"] });
                    }}
                  >
                    New invite link
                  </button>
                </div>
                {inviteUrl ? (
                  <input
                    className="field mono mt-3 text-[11px]"
                    readOnly
                    value={inviteUrl}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                ) : null}
              </div>
            </Panel>
            </>
            ) : null}

            {tab === "users" ? (
              <div className="md:col-span-2">
                <Panel title={project ? `People — ${project.name}` : "People"}>
                  {peoplePending ? (
                    <p className="text-soft text-[13px]">Loading accounts…</p>
                  ) : peopleError ? (
                    <p className="text-[13px]" style={{ color: "var(--loanword)" }}>
                      Could not load accounts. Sign in as an admin and try again.
                    </p>
                  ) : (
                    <UsersPanel users={people?.users ?? []} />
                  )}
                </Panel>
              </div>
            ) : null}

            {tab === "stats" ? (
              <>
                <Panel title="Corpus summary">
                  <div className="flex flex-col gap-1 text-[13px]">
                    <Row label="Recordings" value={stats?.recordings ?? 0} />
                    <Row label="Total duration" value={stats?.totalDuration ? `${(stats.totalDuration / 60).toFixed(1)} min` : "—"} />
                    <Row label="Needs review" value={stats?.needsReview ?? 0} />
                  </div>
                </Panel>

                <Panel title="Annotations by type">
                  <Bars
                    rows={(stats?.byType ?? []).map((row) => ({
                      label: BUILT_IN_LABELS[row.type]?.label ?? row.type,
                      value: row.count,
                    }))}
                  />
                </Panel>

                <Panel title="Annotations by language tag">
                  <Bars
                    rows={(stats?.byLanguage ?? []).map((row) => ({
                      label: row.languageTag,
                      value: row.count,
                    }))}
                  />
                </Panel>

                <Panel title="Annotations by contributor">
                  <Bars
                    rows={(stats?.byContributor ?? []).map((row) => ({
                      label: row.name,
                      value: row.count,
                    }))}
                  />
                </Panel>

                <Panel title="By pronunciation">
                  <Bars
                    rows={(stats?.byPronunciation ?? []).map((row) => ({
                      label: row.pronunciation,
                      value: row.count,
                    }))}
                  />
                </Panel>

                <Panel title="By confidence">
                  <Bars
                    rows={(stats?.byConfidence ?? []).map((row) => ({
                      label: row.confidence,
                      value: row.count,
                    }))}
                  />
                </Panel>

                <Panel title="Top 25 loanword types">
                  {stats && stats.topLoanwords.length > 0 ? (
                    <ol className="m-0 flex list-none flex-col gap-1 p-0">
                      {stats.topLoanwords.map((row) => (
                        <li
                          key={row.surface}
                          className="flex items-baseline gap-2 text-[13px]"
                        >
                          <span className="flex-1 truncate">{row.surface}</span>
                          <span className="timecode">{row.count}</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-soft text-[13px]">No loanwords marked yet.</p>
                  )}
                </Panel>
              </>
            ) : null}

            {tab === "recordings" && project && selected ? (
              <Panel title="Recordings">
                <ImportUI recordings={recordings ?? []} onDone={() => void refetchRecordings()} onError={setError} />
                <RecordingsList
                  recordings={recordings ?? []}
                  users={users}
                  speakers={projectSpeakers ?? []}
                  onAction={async (id, action, extra) => {
                    const response = await fetch(`/api/recordings/${id}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action, ...extra }),
                    });
                    if (!response.ok) {
                      const body = await response.json().catch(() => null);
                      setError(body?.error?.message ?? `Action "${action}" failed.`);
                      return;
                    }
                    void refetchRecordings();
                  }}
                  onDelete={async (id) => {
                    const response = await fetch(`/api/recordings/${id}`, { method: "DELETE" });
                    if (!response.ok) {
                      const body = await response.json().catch(() => null);
                      setError(body?.error?.message ?? "Could not delete recording.");
                      return;
                    }
                    void refetchRecordings();
                  }}
                  onMetadata={async (id, data) => {
                    const response = await fetch(`/api/recordings/${id}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ action: "metadata", ...data }),
                    });
                    if (!response.ok) {
                      const body = await response.json().catch(() => null);
                      setError(body?.error?.message ?? "Could not update metadata.");
                      return;
                    }
                    void refetchRecordings();
                  }}
                />
              </Panel>
            ) : null}

            {tab === "invites" && project ? (
              <Panel title="Invitation history">
                {projectInvites.length === 0 ? (
                  <p className="text-soft text-[13px]">No invitations for this project.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {projectInvites.map((inv) => (
                      <li key={inv.id} className="flex items-center gap-2 text-[12px]">
                        <span className="flex-1 truncate">
                          {inv.email ?? "Open link"}{" "}
                          <span className="text-soft">· {inv.role.toLowerCase()}</span>
                        </span>
                        <InviteStatus invite={inv} />
                        <span className="text-soft text-[11px]">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ) : null}

            {tab === "speakers" && project ? (
              <Panel title="Speakers">
                <SpeakersPanel projectId={project.id} />
              </Panel>
            ) : null}

            {tab === "iaa" && project ? (
              <Panel title="Inter-annotator agreement">
                <IaaPanel projectId={project.id} recordings={recordings ?? []} users={users} onError={setError} />
              </Panel>
            ) : null}

            {tab === "guidelines" && project ? (
              <Panel title="Annotation guidelines">
                <GuidelinesEditor projectId={project.id} />
              </Panel>
            ) : null}
          </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-soft flex-1">{label}</span>
      <span className="timecode">{value}</span>
    </div>
  );
}

function InviteStatus({ invite }: { invite: InviteRow }) {
  if (invite.acceptedAt) {
    return <span className="pill" style={{ background: "color-mix(in oklch, var(--accent) 14%, transparent)", color: "var(--accent)" }}>Accepted</span>;
  }
  if (new Date(invite.expiresAt) < new Date()) {
    return <span className="pill" style={{ background: "color-mix(in oklch, var(--loanword) 14%, transparent)", color: "var(--loanword)" }}>Expired</span>;
  }
  return <span className="pill" style={{ background: "color-mix(in oklch, var(--text) 8%, transparent)" }}>Pending</span>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="glass glass-e1 p-4"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      <h2 className="mb-3 text-[13px]">{title}</h2>
      {children}
    </section>
  );
}

function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  if (rows.length === 0) {
    return <p className="text-soft text-[13px]">Nothing yet.</p>;
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-2">
          <span className="w-[120px] shrink-0 truncate text-[12px]">{row.label}</span>
          <span
            className="h-[6px] flex-1 overflow-hidden rounded-full"
            style={{ background: "color-mix(in oklch, var(--text) 8%, transparent)" }}
          >
            <span
              className="block h-full"
              style={{
                width: `${(row.value / max) * 100}%`,
                background: "var(--accent)",
              }}
            />
          </span>
          <span className="timecode w-[40px] text-right">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

function ProjectEditor({
  project,
  onSaved,
  onError,
}: {
  project: ProjectRow;
  onSaved: (updated: { id: string; name: string; languageCodes: string[]; customLabels: { type: string; label: string }[] }) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [languages, setLanguages] = useState(project.languageCodes.join(", "));
  const [labels, setLabels] = useState(
    project.customLabels.map((l) => `${l.type}:${l.label}`).join(", "),
  );

  if (!editing) {
    return (
      <div className="flex flex-col gap-2 text-[13px]">
        <div><span className="text-soft">Languages:</span> {project.languageCodes.join(", ")}</div>
        <div><span className="text-soft">Custom labels:</span> {project.customLabels.length > 0 ? project.customLabels.map((l) => l.label).join(", ") : "none"}</div>
        <button className="control mt-1 self-start" onClick={() => { setEditing(true); setName(project.name); setLanguages(project.languageCodes.join(", ")); setLabels(project.customLabels.map((l) => `${l.type}:${l.label}`).join(", ")); }}>
          Edit project
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        const languageCodes = languages.split(",").map((c) => c.trim()).filter(Boolean);
        const customLabels = labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [type, ...rest] = s.split(":");
            return { type: type.trim(), label: rest.join(":").trim() || type.trim() };
          });

        const response = await fetch(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, languageCodes, customLabels }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          onError(body?.error?.message ?? "Could not update project.");
          return;
        }
        onSaved({ id: project.id, name, languageCodes, customLabels });
        setEditing(false);
      }}
    >
      <label className="text-soft text-[11px]">Name</label>
      <input className="field h-8 text-[13px]" value={name} onChange={(e) => setName(e.target.value)} required />
      <label className="text-soft text-[11px]">Languages (comma-separated, Whisper 99 codes)</label>
      <input className="field h-8 text-[13px]" value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="bs, de, en, hr, tr…" />
      <label className="text-soft text-[11px]">Custom labels (type:Label, comma-separated, max 4)</label>
      <input className="field h-8 text-[13px]" value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="calque:Calque, named_entity:Named entity" />
      <div className="flex gap-2">
        <button className="control control-primary h-8">Save</button>
        <button type="button" className="control control-plain h-8" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

function RecordingsList({
  recordings,
  users,
  speakers,
  onAction,
  onDelete,
  onMetadata,
}: {
  recordings: RecordingRow[];
  users: { id: string; name: string; email: string }[];
  speakers: { id: string; name: string }[];
  onAction: (id: string, action: string, extra?: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onMetadata: (id: string, data: Record<string, unknown>) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (recordings.length === 0) {
    return <p className="text-soft text-[13px]">No recordings in this project.</p>;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {recordings.map((rec) => (
        <li key={rec.id} className="flex flex-col gap-1 border-b pb-2 hairline">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="flex-1 truncate font-medium">{rec.filename}</span>
            <StatusPill status={rec.status} />
          </div>
          <div className="text-soft text-[11px]">
            {rec.assignedToName ?? "Unassigned"}
            {rec.speakerName ? ` · Speaker: ${rec.speakerName}` : ""}
            {" · "}{Math.round(rec.durationSec)}s
            {" · "}{rec.reviewedCount}/{rec.segmentCount} reviewed
          </div>
          <div className="flex flex-wrap gap-1">
            <select
              className="field h-7 w-auto text-[11px]"
              value={rec.assignedToId ?? ""}
              onChange={(e) => onAction(rec.id, "assign", { assignedToId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <select
              className="field h-7 w-auto text-[11px]"
              value={rec.speakerId ?? ""}
              onChange={(e) => onMetadata(rec.id, { speakerId: e.target.value || null })}
            >
              <option value="">No speaker</option>
              {speakers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className="control h-7 text-[11px]" onClick={() => setExpanded(expanded === rec.id ? null : rec.id)}>
              {expanded === rec.id ? "▾ Meta" : "▸ Meta"}
            </button>
            {rec.status === "READY" ? (
              <button className="control h-7 text-[11px]" onClick={() => onAction(rec.id, "complete")}>Lock</button>
            ) : null}
            {rec.status === "COMPLETE" ? (
              <button className="control h-7 text-[11px]" onClick={() => onAction(rec.id, "reopen")}>Reopen</button>
            ) : null}
            {rec.status === "FAILED" ? (
              <button className="control h-7 text-[11px]" onClick={() => onAction(rec.id, "retry")}>Retry</button>
            ) : null}
            <button
              className="control h-7 text-[11px]"
              style={{ color: "var(--loanword)" }}
              onClick={() => { if (confirm(`Delete "${rec.filename}"?`)) onDelete(rec.id); }}
            >
              Delete
            </button>
          </div>
          {expanded === rec.id ? (
            <RecordingMetaEditor rec={rec} onSave={(data) => onMetadata(rec.id, data)} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function RecordingMetaEditor({
  rec,
  onSave,
}: {
  rec: RecordingRow;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const [sourceUrl, setSourceUrl] = useState(rec.sourceUrl ?? "");
  const [sourceContext, setSourceContext] = useState(rec.sourceContext ?? "");

  return (
    <div className="mt-1 flex flex-col gap-1 pl-2 border-l-2" style={{ borderColor: "var(--accent)" }}>
      <label className="text-soft text-[10px]">Source URL</label>
      <input className="field h-7 text-[11px]" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
      <label className="text-soft text-[10px]">Source context</label>
      <input className="field h-7 text-[11px]" value={sourceContext} onChange={(e) => setSourceContext(e.target.value)} placeholder="Interview, broadcast, field recording…" />
      <button className="control h-7 text-[11px] w-fit" onClick={() => onSave({ sourceUrl: sourceUrl || null, sourceContext: sourceContext || null })}>Save metadata</button>
    </div>
  );
}

function ImportUI({
  recordings,
  onDone,
  onError,
}: {
  recordings: RecordingRow[];
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [target, setTarget] = useState("");
  const [mode, setMode] = useState<"transcript" | "annotations">("transcript");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const eligible = recordings.filter((r) =>
    mode === "transcript" ? r.segmentCount === 0 : r.segmentCount > 0,
  );

  return (
    <div className="mb-3 border-b pb-3 hairline">
      <p className="mb-1 text-[11px] font-medium">Import</p>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-soft text-[10px]">Mode</label>
          <select className="field h-7 w-auto text-[11px]" value={mode} onChange={(e) => { setMode(e.target.value as "transcript" | "annotations"); setTarget(""); }}>
            <option value="transcript">Transcript (SRT/VTT/text)</option>
            <option value="annotations">Annotations (XLSX)</option>
          </select>
        </div>
        <div>
          <label className="text-soft text-[10px]">Recording</label>
          <select className="field h-7 w-auto text-[11px]" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select…</option>
            {eligible.map((r) => (
              <option key={r.id} value={r.id}>{r.filename}</option>
            ))}
          </select>
        </div>
        <input ref={fileRef} type="file" accept={mode === "annotations" ? ".xlsx" : ".srt,.vtt,.txt"} className="hidden" onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || !target) return;
          setUploading(true);
          try {
            const fd = new FormData();
            fd.append("file", file);
            if (mode === "annotations") fd.append("mode", "annotations");
            const response = await fetch(`/api/recordings/${target}/import`, { method: "POST", body: fd });
            if (!response.ok) {
              const body = await response.json().catch(() => null);
              onError(body?.error?.message ?? "Import failed.");
              return;
            }
            onDone();
          } finally {
            setUploading(false);
            if (fileRef.current) fileRef.current.value = "";
          }
        }} />
        <button
          className="control h-7 text-[11px]"
          disabled={!target || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? "Importing…" : "Choose file…"}
        </button>
      </div>
      {mode === "transcript" && eligible.length === 0 ? (
        <p className="text-soft mt-1 text-[10px]">No recordings without segments available for transcript import.</p>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "READY"
      ? "var(--accent)"
      : status === "COMPLETE"
        ? "var(--codeswitch)"
        : status === "FAILED"
          ? "var(--loanword)"
          : "var(--text-secondary)";
  return (
    <span
      className="pill"
      style={{ background: `color-mix(in oklch, ${color} 14%, transparent)`, color }}
    >
      {status.toLowerCase()}
    </span>
  );
}

function DeleteProjectPanel({
  project,
  onDeleted,
  onError,
}: {
  project: ProjectRow;
  onDeleted: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="mt-4 border-t pt-4 hairline">
      <h3 className="mb-2 text-[13px] font-medium" style={{ color: "var(--loanword)" }}>
        Delete project
      </h3>
      {confirming ? (
        <>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--loanword)" }}>
            Delete &ldquo;{project.name}&rdquo;? {DELETE_PROJECT_CONFIRM_MESSAGE}
            {project.recordingCount > 0
              ? ` This project has ${project.recordingCount} recording(s).`
              : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="control"
              disabled={deleting}
              style={{ color: "var(--loanword)" }}
              onClick={async () => {
                setDeleting(true);
                const response = await fetch(`/api/projects/${project.id}`, {
                  method: "DELETE",
                });
                if (!response.ok) {
                  const body = await response.json().catch(() => null);
                  onError(body?.error?.message ?? "The project could not be deleted.");
                  setDeleting(false);
                  return;
                }
                onDeleted(project.id);
              }}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              className="control"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="control"
          style={{ color: "var(--loanword)" }}
          onClick={() => setConfirming(true)}
        >
          Delete project…
        </button>
      )}
    </div>
  );
}

function CreateProject({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [languages, setLanguages] = useState("bs-BA, de-CH, en-US");
  const [labels, setLabels] = useState("");

  if (!open) {
    return (
      <button className="control" onClick={() => setOpen(true)}>
        New project
      </button>
    );
  }

  return (
    <form
      className="glass glass-e1 flex flex-col gap-2 p-3"
      style={{ borderRadius: "var(--radius-control)" }}
      onSubmit={async (event) => {
        event.preventDefault();
        const customLabels = labels
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => {
            const [type, ...rest] = s.split(":");
            return { type: type.trim(), label: rest.join(":").trim() || type.trim() };
          });

        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            languageCodes: languages
              .split(",")
              .map((code) => code.trim())
              .filter(Boolean),
            customLabels,
          }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          onError(body?.error?.message ?? "The project could not be created.");
          return;
        }
        setOpen(false);
        setName("");
        setLabels("");
        onCreated();
      }}
    >
      <input
        className="field h-8 text-[13px]"
        placeholder="Project name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="field h-8 text-[13px]"
        placeholder="Languages: bs, de, en, hr… (Whisper 99)"
        value={languages}
        onChange={(event) => setLanguages(event.target.value)}
      />
      <input
        className="field h-8 text-[13px]"
        placeholder="Custom labels: calque:Calque, named_entity:Named entity"
        value={labels}
        onChange={(event) => setLabels(event.target.value)}
      />
      <div className="flex gap-2">
        <button className="control control-primary h-8">Create</button>
        <button
          type="button"
          className="control control-plain h-8"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddMember({
  projectId,
  users,
  onDone,
}: {
  projectId: string;
  users: { id: string; name: string; email: string }[];
  onDone: () => void;
}) {
  const [userId, setUserId] = useState("");
  if (users.length === 0) {
    return <p className="text-soft text-[12px]">Everyone is already a member.</p>;
  }
  return (
    <div className="flex gap-2">
      <label className="sr-only" htmlFor="add-member">
        Add member
      </label>
      <select
        id="add-member"
        className="field h-8 flex-1 text-[13px]"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
      >
        <option value="">Choose someone…</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name} · {user.email}
          </option>
        ))}
      </select>
      <button
        className="control h-8"
        disabled={!userId}
        onClick={async () => {
          await fetch(`/api/projects/${projectId}/members`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId }),
          });
          setUserId("");
          onDone();
        }}
      >
        Add
      </button>
    </div>
  );
}

interface SpeakerRow {
  id: string;
  name: string;
  mainLanguage: string | null;
  dominantLanguage: string | null;
  heritageLanguage: string | null;
  otherLanguages: string[];
  bilingualStatus: string | null;
  speakerRole: string | null;
  notes: string | null;
  recordingCount: number;
}

function SpeakersPanel({ projectId }: { projectId: string }) {
  const { data: speakers, refetch } = useQuery<SpeakerRow[]>({
    queryKey: ["speakers", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/speakers`);
      if (!response.ok) return [];
      const body = await response.json();
      return body.speakers ?? [];
    },
  });

  const [name, setName] = useState("");
  const [dominantLang, setDominantLang] = useState("");
  const [heritageLang, setHeritageLang] = useState("");
  const [otherLangs, setOtherLangs] = useState("");

  return (
    <div className="flex flex-col gap-3">
      {(speakers ?? []).map((s) => (
        <div key={s.id} className="flex items-center gap-2 border-b pb-2 hairline text-[13px]">
          <div className="flex-1">
            <span className="font-medium">{s.name}</span>
            {s.dominantLanguage ? (
              <span className="text-soft"> · Dominant: {s.dominantLanguage}</span>
            ) : s.mainLanguage ? (
              <span className="text-soft"> · Dominant: {s.mainLanguage}</span>
            ) : null}
            {s.heritageLanguage ? (
              <span className="text-soft"> · Heritage: {s.heritageLanguage}</span>
            ) : null}
            {s.otherLanguages.length > 0 ? <span className="text-soft"> · {s.otherLanguages.join(", ")}</span> : null}
            {s.bilingualStatus ? <span className="text-soft"> · {s.bilingualStatus}</span> : null}
            {s.speakerRole ? <span className="text-soft"> · {s.speakerRole}</span> : null}
            <span className="text-soft"> · {s.recordingCount} rec.</span>
          </div>
          <button
            className="control h-7 text-[11px]"
            style={{ color: "var(--loanword)" }}
            onClick={async () => {
              await fetch(`/api/projects/${projectId}/speakers?speakerId=${s.id}`, { method: "DELETE" });
              void refetch();
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await fetch(`/api/projects/${projectId}/speakers`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              mainLanguage: dominantLang || null,
              dominantLanguage: dominantLang || null,
              heritageLanguage: heritageLang || null,
              otherLanguages: otherLangs.split(",").map((l) => l.trim()).filter(Boolean),
            }),
          });
          setName(""); setDominantLang(""); setHeritageLang(""); setOtherLangs("");
          void refetch();
        }}
      >
        <input className="field h-8 w-[120px] text-[13px]" placeholder="Speaker ID" required value={name} onChange={(e) => setName(e.target.value)} />
        <input className="field h-8 w-[120px] text-[13px]" placeholder="Dominant" value={dominantLang} onChange={(e) => setDominantLang(e.target.value)} />
        <input className="field h-8 w-[120px] text-[13px]" placeholder="Heritage" value={heritageLang} onChange={(e) => setHeritageLang(e.target.value)} />
        <input className="field h-8 w-[160px] text-[13px]" placeholder="Other languages (de, en)" value={otherLangs} onChange={(e) => setOtherLangs(e.target.value)} />
        <button className="control control-primary h-8">Add speaker</button>
      </form>
    </div>
  );
}

function IaaPanel({
  recordings,
  users,
  onError,
}: {
  projectId: string;
  recordings: RecordingRow[];
  users: { id: string; name: string; email: string }[];
  onError: (message: string) => void;
}) {
  const [cloneSource, setCloneSource] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [recA, setRecA] = useState("");
  const [recB, setRecB] = useState("");
  const router = useRouter();

  const { data: iaaResult } = useQuery<{
    totalWords: number;
    agree: number;
    disagree: number;
    percentAgreement: number;
    cohensKappa: number;
    confusion: { pair: string; count: number }[];
  }>({
    queryKey: ["iaa", recA, recB],
    queryFn: async () => {
      const response = await fetch(`/api/admin/iaa?a=${recA}&b=${recB}`);
      if (!response.ok) throw new Error("Failed to compute IAA");
      return response.json();
    },
    enabled: !!recA && !!recB,
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-[12px] font-medium">Clone for second annotator</h3>
        <div className="flex flex-wrap gap-2">
          <select className="field h-8 w-auto text-[13px]" value={cloneSource} onChange={(e) => setCloneSource(e.target.value)}>
            <option value="">Select recording…</option>
            {recordings.filter((r) => r.status === "READY" || r.status === "COMPLETE").map((r) => (
              <option key={r.id} value={r.id}>{r.filename}</option>
            ))}
          </select>
          <select className="field h-8 w-auto text-[13px]" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">Assign to…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button
            className="control control-primary h-8"
            disabled={!cloneSource}
            onClick={async () => {
              const response = await fetch("/api/admin/clone", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ recordingId: cloneSource, assignToUserId: assignTo || undefined }),
              });
              if (!response.ok) {
                const body = await response.json().catch(() => null);
                onError(body?.error?.message ?? "Clone failed.");
                return;
              }
              router.refresh();
            }}
          >
            Clone
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[12px] font-medium">Compare annotations</h3>
        <div className="flex flex-wrap gap-2">
          <select className="field h-8 w-auto text-[13px]" value={recA} onChange={(e) => setRecA(e.target.value)}>
            <option value="">Recording A…</option>
            {recordings.map((r) => <option key={r.id} value={r.id}>{r.filename}</option>)}
          </select>
          <select className="field h-8 w-auto text-[13px]" value={recB} onChange={(e) => setRecB(e.target.value)}>
            <option value="">Recording B…</option>
            {recordings.map((r) => <option key={r.id} value={r.id}>{r.filename}</option>)}
          </select>
        </div>
        {iaaResult ? (
          <div className="mt-3 flex flex-col gap-1 text-[13px]">
            <Row label="Total words compared" value={iaaResult.totalWords} />
            <Row label="Agreement" value={`${iaaResult.percentAgreement}%`} />
            <Row label="Cohen's kappa" value={`${iaaResult.cohensKappa}%`} />
            <Row label="Agree" value={iaaResult.agree} />
            <Row label="Disagree" value={iaaResult.disagree} />
            {iaaResult.confusion.length > 0 ? (
              <div className="mt-2">
                <span className="text-soft text-[11px]">Top disagreements</span>
                {iaaResult.confusion.slice(0, 10).map((c) => (
                  <div key={c.pair} className="flex items-baseline gap-2 text-[12px]">
                    <span className="flex-1">{c.pair}</span>
                    <span className="timecode">{c.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GuidelinesEditor({ projectId }: { projectId: string }) {
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetch(`/api/projects/${projectId}/guidelines`)
      .then((r) => r.json())
      .then((body) => { setText(body.guidelines ?? ""); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [projectId]);

  if (!loaded) return <p className="text-soft text-[13px]">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      <textarea
        className="field min-h-[200px] p-3 text-[13px]"
        placeholder="Write annotation guidelines here. Annotators can see these on the Guidelines page."
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="control control-primary self-start"
        disabled={saving}
        onClick={async () => {
          setSaving(true);
          await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ guidelines: text || null }),
          });
          setSaving(false);
        }}
      >
        {saving ? "Saving…" : "Save guidelines"}
      </button>
    </div>
  );
}

