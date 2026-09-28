export interface TranscriptSearchHit {
  segmentId: string;
  wordId: string;
}

export interface SearchableSegment {
  id: string;
  words: { id: string; text: string }[];
}

/** NFC + Unicode lower-case. Does not strip diacritics or rewrite forms. */
export function foldSearchText(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

/**
 * Find words that contain the query (substring), or consecutive words that
 * contain a multi-word phrase. Order follows the transcript.
 */
export function findTranscriptMatches(
  segments: SearchableSegment[],
  query: string,
): TranscriptSearchHit[] {
  const needle = foldSearchText(query).trim();
  if (!needle) return [];

  const hits: TranscriptSearchHit[] = [];
  const phrase = needle.includes(" ");

  for (const segment of segments) {
    if (phrase) {
      hits.push(...phraseHits(segment, needle));
      continue;
    }
    for (const word of segment.words) {
      if (foldSearchText(word.text).includes(needle)) {
        hits.push({ segmentId: segment.id, wordId: word.id });
      }
    }
  }
  return hits;
}

function phraseHits(
  segment: SearchableSegment,
  needle: string,
): TranscriptSearchHit[] {
  if (segment.words.length === 0) return [];

  const folded = segment.words.map((word) => foldSearchText(word.text));
  const ranges: { start: number; end: number }[] = [];
  let pos = 0;
  for (let i = 0; i < folded.length; i++) {
    const start = pos;
    const end = start + folded[i].length;
    ranges.push({ start, end });
    pos = end + (i < folded.length - 1 ? 1 : 0);
  }

  const haystack = folded.join(" ");
  const seen = new Set<string>();
  const hits: TranscriptSearchHit[] = [];
  let from = 0;

  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const until = at + needle.length;
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i];
      if (range.start < until && range.end > at) {
        const word = segment.words[i];
        if (!seen.has(word.id)) {
          seen.add(word.id);
          hits.push({ segmentId: segment.id, wordId: word.id });
        }
      }
    }
    from = at + 1;
  }

  return hits;
}
