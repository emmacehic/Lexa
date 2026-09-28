"use client";

import { createContext, useContext } from "react";

/**
 * Playback sync (§8.2).
 *
 * One requestAnimationFrame loop reads `media.currentTime`, binary-searches
 * the segment index with the previous index cached (so the common case is a
 * neighbour check, not a search), and pushes the result to subscribers. React
 * state is touched only when the active segment id actually changes.
 */

export interface PlaybackSegment {
  id: string;
  start: number;
  end: number;
  words: { id: string; start: number; end: number }[];
}

export const SPEEDS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

type TimeListener = (time: number, duration: number, playing: boolean) => void;
type WordListener = (segmentId: string | null, wordId: string | null) => void;
type SegmentListener = (segmentId: string | null) => void;

export class PlaybackEngine {
  private media: HTMLMediaElement | null = null;
  private frame = 0;
  private segments: PlaybackSegment[] = [];
  private cachedIndex = 0;
  private cachedWordIndex = 0;

  private currentSegmentId: string | null = null;
  private currentWordId: string | null = null;

  private timeListeners = new Set<TimeListener>();
  private wordListeners = new Set<WordListener>();
  private segmentListeners = new Set<SegmentListener>();
  private rateListeners = new Set<(rate: number) => void>();

  /** ⌥-click plays one segment and stops at its end (§8.2). */
  loopSegmentId: string | null = null;

  attach(media: HTMLMediaElement | null): void {
    this.media = media;
    if (media && this.frame === 0) this.tick();
  }

  detach(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.media = null;
  }

  setSegments(segments: PlaybackSegment[]): void {
    this.segments = segments;
    this.cachedIndex = Math.min(this.cachedIndex, Math.max(0, segments.length - 1));
  }

  subscribeTime(listener: TimeListener): () => void {
    this.timeListeners.add(listener);
    return () => this.timeListeners.delete(listener);
  }

  subscribeWord(listener: WordListener): () => void {
    this.wordListeners.add(listener);
    return () => this.wordListeners.delete(listener);
  }

  subscribeSegment(listener: SegmentListener): () => void {
    this.segmentListeners.add(listener);
    return () => this.segmentListeners.delete(listener);
  }

  get element(): HTMLMediaElement | null {
    return this.media;
  }

  get currentTime(): number {
    return this.media?.currentTime ?? 0;
  }

  get paused(): boolean {
    return this.media?.paused ?? true;
  }

  play(): void {
    void this.media?.play().catch(() => undefined);
  }

  pause(): void {
    this.media?.pause();
  }

  toggle(): void {
    if (!this.media) return;
    if (this.media.paused) this.play();
    else this.pause();
  }

  seek(time: number): void {
    if (!this.media) return;
    const duration = Number.isFinite(this.media.duration) ? this.media.duration : time;
    this.media.currentTime = Math.max(0, Math.min(time, duration));
    this.emit(true);
  }

  seekBy(delta: number): void {
    this.seek(this.currentTime + delta);
  }

  setRate(rate: number): void {
    if (this.media) this.media.playbackRate = rate;
    for (const fn of this.rateListeners) fn(rate);
  }

  subscribeRate(fn: (rate: number) => void): () => void {
    this.rateListeners.add(fn);
    return () => this.rateListeners.delete(fn);
  }

  get rate(): number {
    return this.media?.playbackRate ?? 1;
  }

  /** Seek into a segment and keep whatever play state we were in (§8.2). */
  seekToSegment(segment: PlaybackSegment, options: { only?: boolean } = {}): void {
    this.loopSegmentId = options.only ? segment.id : null;
    this.seek(segment.start + 0.02);
    if (options.only) this.play();
  }

  private tick = (): void => {
    this.frame = requestAnimationFrame(this.tick);
    this.emit(false);
  };

  private emit(force: boolean): void {
    const media = this.media;
    if (!media) return;
    const time = media.currentTime;

    if (this.loopSegmentId) {
      const segment = this.segments.find((s) => s.id === this.loopSegmentId);
      if (segment && time >= segment.end) {
        media.pause();
        media.currentTime = segment.end;
        this.loopSegmentId = null;
      }
    }

    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    for (const listener of this.timeListeners) listener(time, duration, !media.paused);

    const index = this.findSegment(time);
    const segment = index >= 0 ? this.segments[index] : null;
    const segmentId = segment?.id ?? null;

    if (segmentId !== this.currentSegmentId || force) {
      this.currentSegmentId = segmentId;
      this.cachedWordIndex = 0;
      for (const listener of this.segmentListeners) listener(segmentId);
    }

    const wordId = segment ? this.findWord(segment, time) : null;
    if (wordId !== this.currentWordId || force) {
      this.currentWordId = wordId;
      for (const listener of this.wordListeners) listener(segmentId, wordId);
    }
  }

  /** O(1) in the common case: check the cached index and its neighbours first. */
  private findSegment(time: number): number {
    const segments = this.segments;
    if (segments.length === 0) return -1;

    const near = [this.cachedIndex, this.cachedIndex + 1, this.cachedIndex - 1];
    for (const i of near) {
      if (i >= 0 && i < segments.length && covers(segments[i], time)) {
        this.cachedIndex = i;
        return i;
      }
    }

    let low = 0;
    let high = segments.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (time < segments[mid].start) high = mid - 1;
      else if (time > segments[mid].end) low = mid + 1;
      else {
        this.cachedIndex = mid;
        return mid;
      }
    }

    // Between two segments — hold the one just before the playhead.
    const fallback = Math.max(0, Math.min(segments.length - 1, high));
    this.cachedIndex = fallback;
    return segments[fallback].end <= time || segments[fallback].start >= time
      ? fallback
      : fallback;
  }

  private findWord(segment: PlaybackSegment, time: number): string | null {
    const words = segment.words;
    if (words.length === 0) return null;

    let i = Math.min(this.cachedWordIndex, words.length - 1);
    if (words[i].start > time) i = 0;
    while (i < words.length - 1 && words[i].end < time) i++;
    this.cachedWordIndex = i;

    const word = words[i];
    return time >= word.start - 0.001 && time <= word.end + 0.05 ? word.id : null;
  }
}

function covers(segment: PlaybackSegment, time: number): boolean {
  return time >= segment.start && time <= segment.end;
}

export const PlaybackContext = createContext<PlaybackEngine | null>(null);

export function usePlayback(): PlaybackEngine {
  const engine = useContext(PlaybackContext);
  if (!engine) throw new Error("usePlayback must be used inside the workspace");
  return engine;
}
