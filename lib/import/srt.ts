export interface ImportSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

/** Parse SRT or VTT into segments. */
export function parseSrtVtt(content: string): ImportSegment[] {
  const segments: ImportSegment[] = [];
  const isVtt = content.trimStart().startsWith("WEBVTT");
  const blocks = content.split(/\n\s*\n/).filter((b) => b.trim());

  let index = 0;
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (isVtt && index === 0 && lines[0]?.startsWith("WEBVTT")) continue;

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("-->")) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx < 0) continue;

    const timeLine = lines[timeLineIdx];
    const match = timeLine.match(
      /(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})/,
    );
    if (!match) continue;

    const toSeconds = (h: string | undefined, m: string, s: string, ms: string) =>
      (h ? parseInt(h) * 3600 : 0) + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;

    const start = toSeconds(match[1]?.replace(":", ""), match[2], match[3], match[4]);
    const end = toSeconds(match[5]?.replace(":", ""), match[6], match[7], match[8]);
    const text = lines
      .slice(timeLineIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (text) {
      segments.push({ index, start, end, text });
      index++;
    }
  }
  return segments;
}

/** Parse plain text into segments (one paragraph = one segment). */
export function parsePlainText(content: string, durationSec: number): ImportSegment[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return [];

  const segDuration = durationSec / paragraphs.length;
  return paragraphs.map((text, i) => ({
    index: i,
    start: i * segDuration,
    end: (i + 1) * segDuration,
    text,
  }));
}
