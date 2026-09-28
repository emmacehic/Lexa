"use client";

/**
 * The 40 px waveform thumbnail on a library row. Peaks are the 400 buckets
 * stored on the recording; nothing is computed in the browser.
 */
export function WaveformThumb({
  peaks,
  height = 40,
  bars = 96,
  className,
}: {
  peaks: number[] | null;
  height?: number;
  bars?: number;
  className?: string;
}) {
  if (!peaks || peaks.length === 0) {
    return (
      <div
        className={className}
        style={{ height, width: "100%", opacity: 0.25 }}
        aria-hidden="true"
      >
        <div
          style={{
            height: 2,
            marginTop: height / 2 - 1,
            background: "var(--text-secondary)",
            borderRadius: 2,
          }}
        />
      </div>
    );
  }

  const step = peaks.length / bars;
  const values: number[] = [];
  for (let i = 0; i < bars; i++) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let max = 0;
    for (let j = from; j < to && j < peaks.length; j++) {
      if (peaks[j] > max) max = peaks[j];
    }
    values.push(max);
  }

  return (
    <div
      className={className}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        height,
        width: "100%",
      }}
      aria-hidden="true"
    >
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: "1 1 0",
            height: `${Math.max(6, (v / 100) * height)}px`,
            borderRadius: 1,
            background: "color-mix(in oklch, var(--text) 22%, transparent)",
          }}
        />
      ))}
    </div>
  );
}
