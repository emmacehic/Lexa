"use client";

import { useEffect, useRef, useState } from "react";

import { formatTimecode } from "@/lib/time";
import { Waveform } from "./Waveform";
import { useWorkspace } from "./context";
import { SPEEDS, usePlayback } from "./playback";

/**
 * The player column: the picture (for video), the waveform, and a transport.
 * It is sticky — it never scrolls with the transcript (§8.1).
 */
export function Player() {
  const recording = useWorkspace((s) => s.recording);
  const playback = usePlayback();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      const response = await fetch(`/api/recordings/${recording.id}/media`);
      const body = await response.json().catch(() => null);
      if (cancelled) return;
      if (!response.ok) {
        setError(body?.error?.message ?? "The media could not be loaded.");
        return;
      }
      setError(null);
      setSource(body.url);
      // Signed URLs last 60 minutes; refresh a little before they lapse.
      timer = setTimeout(load, Math.max(60_000, (body.expiresIn - 120) * 1000));
    };

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [recording.id]);

  useEffect(() => {
    playback.attach(mediaRef.current);
    return () => playback.detach();
  }, [playback]);

  useEffect(() => {
    return playback.subscribeTime((time, _duration, isPlaying) => {
      if (timeRef.current) timeRef.current.textContent = formatTimecode(time);
      setPlaying((current) => (current === isPlaying ? current : isPlaying));
    });
  }, [playback]);

  useEffect(() => {
    return playback.subscribeRate((r) => setRate(r));
  }, [playback]);

  return (
    <div
      className="glass glass-e2 flex flex-col gap-3 p-3"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      {error ? (
        <p className="text-[13px]" style={{ color: "var(--loanword)" }}>
          {error}
        </p>
      ) : null}

      {/* Design pass: the audio-only variant used to carry a framed box
          repeating the filename. The header already names the recording and
          the waveform is the picture, so the box is gone. */}
      {recording.kind === "VIDEO" ? (
        <div
          className="glass-inset overflow-hidden"
          style={{ borderRadius: "var(--radius-row)", aspectRatio: "16 / 9" }}
        >
          <video
            ref={mediaRef}
            src={source ?? undefined}
            className="h-full w-full"
            playsInline
            preload="metadata"
          />
        </div>
      ) : (
        <video
          ref={mediaRef}
          src={source ?? undefined}
          className="hidden"
          playsInline
          preload="metadata"
        />
      )}

      <Waveform peaks={recording.waveformPeaks} duration={recording.durationSec} />

      <div className="flex items-center gap-2">
        <button
          className="control h-8 w-8 p-0"
          aria-label="Back 2 seconds"
          onClick={() => playback.seekBy(-2)}
        >
          ◀◀
        </button>
        <button
          className="control control-primary h-9 w-9 p-0"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => playback.toggle()}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          className="control h-8 w-8 p-0"
          aria-label="Forward 2 seconds"
          onClick={() => playback.seekBy(2)}
        >
          ▶▶
        </button>

        <span ref={timeRef} className="timecode ml-1">
          {formatTimecode(0)}
        </span>

        <span className="flex-1" />

        <label className="sr-only" htmlFor="speed">
          Playback speed
        </label>
        <select
          id="speed"
          className="field mono h-8 w-[74px] px-2 text-[12px]"
          value={rate}
          onChange={(event) => {
            const next = Number(event.target.value);
            setRate(next);
            playback.setRate(next);
          }}
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
