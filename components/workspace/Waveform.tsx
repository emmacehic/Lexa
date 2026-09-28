"use client";

import { useEffect, useRef } from "react";

import { usePlayback } from "./playback";

/**
 * The stored 400 peaks, drawn once to a canvas, with a playhead that moves on
 * the same rAF loop as everything else. Clicking seeks.
 */
export function Waveform({
  peaks,
  duration,
  height = 44,
}: {
  peaks: number[] | null;
  duration: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const playback = usePlayback();

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const width = wrap.clientWidth;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(dpr, dpr);
      context.clearRect(0, 0, width, height);

      const colour = getComputedStyle(canvas).getPropertyValue("color").trim();
      context.fillStyle = colour || "#888";

      const values = peaks ?? [];
      if (values.length === 0) {
        context.globalAlpha = 0.25;
        context.fillRect(0, height / 2 - 1, width, 2);
        return;
      }

      const bars = Math.min(values.length, Math.floor(width / 3));
      const step = values.length / bars;
      const barWidth = width / bars;
      context.globalAlpha = 0.32;
      for (let i = 0; i < bars; i++) {
        const from = Math.floor(i * step);
        const to = Math.max(from + 1, Math.floor((i + 1) * step));
        let max = 0;
        for (let j = from; j < to && j < values.length; j++) {
          if (values[j] > max) max = values[j];
        }
        const h = Math.max(2, (max / 100) * height);
        context.fillRect(i * barWidth, (height - h) / 2, Math.max(1, barWidth - 1), h);
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [peaks, height]);

  useEffect(() => {
    return playback.subscribeTime((time, mediaDuration) => {
      const head = headRef.current;
      const wrap = wrapRef.current;
      if (!head || !wrap) return;
      const total = mediaDuration || duration;
      if (!total) return;
      head.style.transform = `translateX(${(time / total) * wrap.clientWidth}px)`;
    });
  }, [playback, duration]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full cursor-pointer select-none"
      style={{ height, color: "var(--text)" }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        const total = playback.element?.duration || duration;
        playback.seek(Math.max(0, Math.min(1, ratio)) * total);
      }}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(playback.currentTime)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") playback.seekBy(-2);
        if (event.key === "ArrowRight") playback.seekBy(2);
      }}
    >
      <canvas ref={canvasRef} className="block" />
      <div
        ref={headRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-[2px] rounded-full"
        style={{ background: "var(--accent)" }}
      />
    </div>
  );
}
