import { CODE_SWITCH, LOANWORD } from "../labels";
import {
  loadAnnotations,
  loadRecording,
  segmentSpanPages,
  tierNameFor,
  type ExportAnnotation,
} from "./corpus";

/**
 * Praat TextGrid (§10, fifth option). Interval tiers must tile the whole
 * recording, so the silences between segments become empty intervals — and
 * Praat wants the interval count before the intervals themselves, which is
 * why each tier is counted before it is written.
 */

interface Interval {
  xmin: number;
  xmax: number;
  text: string;
}

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}

function num(value: number): string {
  return value.toFixed(6);
}

async function transcriptIntervals(
  recordingId: string,
  duration: number,
): Promise<Interval[]> {
  const intervals: Interval[] = [];
  let cursor = 0;
  for await (const page of segmentSpanPages(recordingId)) {
    for (const segment of page) {
      if (segment.start > cursor + 0.0005) {
        intervals.push({ xmin: cursor, xmax: segment.start, text: "" });
      }
      const start = Math.max(cursor, segment.start);
      const end = Math.max(start, segment.end);
      intervals.push({ xmin: start, xmax: end, text: segment.text });
      cursor = end;
    }
  }
  if (cursor < duration - 0.0005) {
    intervals.push({ xmin: cursor, xmax: duration, text: "" });
  }
  if (intervals.length === 0) {
    intervals.push({ xmin: 0, xmax: Math.max(duration, 0.001), text: "" });
  }
  return intervals;
}

function labelIntervals(
  annotations: ExportAnnotation[],
  duration: number,
): Interval[] {
  const sorted = [...annotations].sort((a, b) => a.start - b.start);
  const intervals: Interval[] = [];
  let cursor = 0;
  for (const a of sorted) {
    if (a.start > cursor + 0.0005) {
      intervals.push({ xmin: cursor, xmax: a.start, text: "" });
    }
    const start = Math.max(cursor, a.start);
    const end = Math.max(start, a.end);
    intervals.push({
      xmin: start,
      xmax: end,
      text: a.languageTag ? `${a.surface} [${a.languageTag}]` : a.surface,
    });
    cursor = end;
  }
  if (cursor < duration - 0.0005 || intervals.length === 0) {
    intervals.push({ xmin: cursor, xmax: Math.max(duration, cursor + 0.001), text: "" });
  }
  return intervals;
}

export async function* exportTextGrid(recordingId: string): AsyncGenerator<string> {
  const recording = await loadRecording(recordingId);
  const { all } = await loadAnnotations(recordingId);
  const duration = Math.max(recording.durationSec, 0.001);

  const extraTypes = [...new Set(all.map((a) => a.type))].filter(
    (t) => t !== LOANWORD && t !== CODE_SWITCH,
  );

  const tiers: { name: string; intervals: Interval[] }[] = [
    { name: "transcript", intervals: await transcriptIntervals(recordingId, duration) },
    {
      name: "loanword",
      intervals: labelIntervals(all.filter((a) => a.type === LOANWORD), duration),
    },
    {
      name: "code-switch",
      intervals: labelIntervals(all.filter((a) => a.type === CODE_SWITCH), duration),
    },
    ...extraTypes.map((type) => ({
      name: tierNameFor(type),
      intervals: labelIntervals(all.filter((a) => a.type === type), duration),
    })),
  ];

  yield `File type = "ooTextFile"\nObject class = "TextGrid"\n\n`;
  yield `xmin = ${num(0)} \nxmax = ${num(duration)} \ntiers? <exists> \nsize = ${tiers.length} \nitem []: \n`;

  for (const [i, tier] of tiers.entries()) {
    yield `    item [${i + 1}]:\n`;
    yield `        class = "IntervalTier" \n`;
    yield `        name = ${quote(tier.name)} \n`;
    yield `        xmin = ${num(0)} \n`;
    yield `        xmax = ${num(duration)} \n`;
    yield `        intervals: size = ${tier.intervals.length} \n`;

    let chunk = "";
    for (const [j, interval] of tier.intervals.entries()) {
      chunk +=
        `        intervals [${j + 1}]:\n` +
        `            xmin = ${num(interval.xmin)} \n` +
        `            xmax = ${num(Math.min(interval.xmax, duration))} \n` +
        `            text = ${quote(interval.text)} \n`;
      if (chunk.length > 32_000) {
        yield chunk;
        chunk = "";
      }
    }
    if (chunk) yield chunk;
  }
}
