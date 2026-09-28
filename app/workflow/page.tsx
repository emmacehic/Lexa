import { redirect } from "next/navigation";
import Link from "next/link";

import { SignOutButton } from "@/components/SignOutButton";
import { currentUser } from "@/lib/authz";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    number: "1",
    title: "Upload",
    description:
      "Upload an audio or video recording. Files under 100 MB are sent to cloud storage for speed; larger files use the local server. A fallback ensures uploads always succeed.",
  },
  {
    number: "2",
    title: "Audio Extraction",
    description:
      "The server extracts the audio track and normalises it to FLAC. A waveform is generated for the workspace visualisation.",
  },
  {
    number: "3",
    title: "Transcription (Whisper)",
    description:
      "The normalised audio is sent to a local Whisper server for speech-to-text. Word-level timestamps are returned so every word is time-aligned with the recording.",
  },
  {
    number: "4",
    title: "Segmentation",
    description:
      "The timestamped words are grouped into segments (utterances) based on pauses and speaker turns. Segments, words, and timings are persisted to the database.",
  },
  {
    number: "5",
    title: "Annotation",
    description:
      "Contributors open the transcript in the workspace and annotate loanwords and code-switching spans. Each annotation is anchored to specific words with their timestamps preserved.",
  },
  {
    number: "6",
    title: "Export",
    description:
      "The annotated corpus can be exported in multiple formats: structured JSON, CSV, WebVTT, SubRip, ELAN (.eaf), Praat TextGrid, or XLSX. The canonical format is JSON with full segment, word, and annotation data.",
  },
] as const;

export default async function WorkflowPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-[880px] px-5 pb-24 pt-10">
      <header className="mb-8 flex items-center justify-between">
        <h1>Project Workflow</h1>
        <div className="flex items-center gap-2">
          <Link className="control" href="/library">
            Library
          </Link>
          <Link className="control" href="/guidelines">
            Annotation Guidelines
          </Link>
          <SignOutButton />
        </div>
      </header>

      <p className="text-soft mb-8 text-[14px] leading-relaxed">
        Overview of the transcription and annotation pipeline used in this
        project.
      </p>

      <ol className="flex flex-col gap-5">
        {STEPS.map((step) => (
          <li
            key={step.number}
            className="glass glass-e1 flex gap-5 p-6"
            style={{ borderRadius: "var(--radius-panel)" }}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
              style={{
                background: "var(--accent)",
                color: "#fff",
              }}
            >
              {step.number}
            </span>
            <div className="min-w-0">
              <h2 className="mb-1 text-[15px] font-semibold">{step.title}</h2>
              <p className="text-soft text-[13px] leading-relaxed">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <footer className="text-soft mt-10 text-[12px]">
        Lexa · Created by Emma Cehic
      </footer>
    </main>
  );
}
