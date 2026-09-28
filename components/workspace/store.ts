"use client";

import { create } from "zustand";

import type {
  AnnotationDTO,
  OpsResultDTO,
  RecordingDTO,
  SegmentDTO,
  TranscriptDTO,
} from "@/lib/dto";
import { CORRECTION } from "@/lib/labels";

export type SaveState = "saved" | "saving" | "offline";

export interface Selection {
  segmentId: string;
  wordIds: string[];
  /** linguistic annotation (loanword / code-switch / unclear) on the selection */
  annotationId: string | null;
  /** spelling correction on the selection — independent of annotationId */
  correctionId: string | null;
}

export interface WorkspaceState {
  recording: RecordingDTO;
  order: string[];
  segmentsById: Record<string, SegmentDTO>;
  annotationsById: Record<string, AnnotationDTO>;

  /** the only playback state in the store — everything else is DOM-local */
  activeSegmentId: string | null;

  editingSegmentId: string | null;
  selection: Selection | null;
  saveState: SaveState;
  pendingCount: number;
  follow: boolean;
  loopSegmentId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  announcement: string;
  /** the later segment of an attempted cross-segment span (§9.1) */
  spanWarning: string | null;
  /** the annotation waiting to be re-attached from the review tray (§9.4) */
  reattaching: string | null;
  /** set by keyboard shortcuts to trigger the annotation wizard in the toolbar */
  pendingWizardType: string | null;
  /** legend list → scroll the transcript to this annotation */
  focusRequest: { annotationId: string; nonce: number } | null;

  setActiveSegment: (id: string | null) => void;
  setEditing: (id: string | null) => void;
  setSelection: (selection: Selection | null) => void;
  setSaveState: (state: SaveState, pending?: number) => void;
  setFollow: (follow: boolean) => void;
  setLoopSegment: (id: string | null) => void;
  setError: (message: string | null) => void;
  announce: (message: string) => void;
  setSpanWarning: (segmentId: string | null) => void;
  setReattaching: (annotationId: string | null) => void;
  setPendingWizardType: (type: string | null) => void;
  requestFocusAnnotation: (annotationId: string) => void;
  clearFocusRequest: () => void;

  applyResult: (result: OpsResultDTO) => void;
  replaceAll: (transcript: TranscriptDTO) => void;

  /** optimistic helpers — the server result overwrites them when it lands */
  patchSegmentText: (segmentId: string, text: string) => void;
  patchSegmentReviewed: (segmentId: string, isReviewed: boolean) => void;
  attachOptimisticAnnotation: (annotation: AnnotationDTO) => void;
  removeAnnotationLocally: (annotationId: string) => void;
}

function index(transcript: TranscriptDTO) {
  const segmentsById: Record<string, SegmentDTO> = {};
  for (const segment of transcript.segments) segmentsById[segment.id] = segment;
  const annotationsById: Record<string, AnnotationDTO> = {};
  for (const annotation of transcript.annotations) {
    annotationsById[annotation.id] = annotation;
  }
  return {
    order: transcript.segments.map((s) => s.id),
    segmentsById,
    annotationsById,
  };
}

export function createWorkspaceStore(transcript: TranscriptDTO) {
  return create<WorkspaceState>((set, get) => ({
    recording: transcript.recording,
    ...index(transcript),

    activeSegmentId: transcript.segments[0]?.id ?? null,
    editingSegmentId: null,
    selection: null,
    saveState: "saved",
    pendingCount: 0,
    follow: true,
    loopSegmentId: null,
    canUndo: transcript.canUndo,
    canRedo: transcript.canRedo,
    error: null,
    announcement: "",
    spanWarning: null,
    reattaching: null,
    pendingWizardType: null,
    focusRequest: null,

    setActiveSegment: (id) => {
      if (get().activeSegmentId !== id) set({ activeSegmentId: id });
    },
    setEditing: (id) => set({ editingSegmentId: id, selection: null }),
    setSelection: (selection) => set({ selection, spanWarning: null }),
    setSaveState: (state, pending) =>
      set((current) => ({
        saveState: state,
        pendingCount: pending ?? current.pendingCount,
      })),
    setFollow: (follow) => set({ follow }),
    setLoopSegment: (id) => set({ loopSegmentId: id }),
    setError: (message) => set({ error: message }),
    announce: (message) => set({ announcement: message }),
    setSpanWarning: (segmentId) => set({ spanWarning: segmentId }),
    setReattaching: (annotationId) => set({ reattaching: annotationId }),
    setPendingWizardType: (type) => set({ pendingWizardType: type }),
    requestFocusAnnotation: (annotationId) =>
      set({
        focusRequest: {
          annotationId,
          nonce: (get().focusRequest?.nonce ?? 0) + 1,
        },
      }),
    clearFocusRequest: () => set({ focusRequest: null }),

    replaceAll: (next) =>
      set({
        recording: next.recording,
        ...index(next),
        canUndo: next.canUndo,
        canRedo: next.canRedo,
      }),

    applyResult: (result) =>
      set((state) => {
        const segmentsById = { ...state.segmentsById };
        const annotationsById = { ...state.annotationsById };

        for (const id of result.removedSegmentIds) delete segmentsById[id];
        for (const segment of result.segments) segmentsById[segment.id] = segment;
        for (const id of result.removedAnnotationIds) delete annotationsById[id];
        for (const annotation of result.annotations) {
          annotationsById[annotation.id] = annotation;
        }
        for (const temp of Object.keys(result.tempIds)) delete annotationsById[temp];

        const order = Object.values(segmentsById)
          .sort((a, b) => a.index - b.index)
          .map((s) => s.id);

        const activeSegmentId =
          state.activeSegmentId && segmentsById[state.activeSegmentId]
            ? state.activeSegmentId
            : (order[0] ?? null);

        let selection = state.selection;
        if (selection) {
          const annotationId = remapTempId(
            selection.annotationId,
            result.tempIds,
            result.removedAnnotationIds,
          );
          const correctionId = remapTempId(
            selection.correctionId,
            result.tempIds,
            result.removedAnnotationIds,
          );
          selection = { ...selection, annotationId, correctionId };
        }

        return {
          segmentsById,
          annotationsById,
          order,
          activeSegmentId,
          selection,
          canUndo: result.canUndo,
          canRedo: result.canRedo,
        };
      }),

    patchSegmentText: (segmentId, text) =>
      set((state) => {
        const segment = state.segmentsById[segmentId];
        if (!segment) return {};
        return {
          segmentsById: { ...state.segmentsById, [segmentId]: { ...segment, text } },
        };
      }),

    patchSegmentReviewed: (segmentId, isReviewed) =>
      set((state) => {
        const segment = state.segmentsById[segmentId];
        if (!segment) return {};
        return {
          segmentsById: {
            ...state.segmentsById,
            [segmentId]: { ...segment, isReviewed },
          },
        };
      }),

    attachOptimisticAnnotation: (annotation) =>
      set((state) => {
        const segmentId = annotation.segmentId;
        const segment = segmentId ? state.segmentsById[segmentId] : null;
        const segmentsById = { ...state.segmentsById };
        if (segment) {
          segmentsById[segment.id] = {
            ...segment,
            words: segment.words.map((w) =>
              annotation.wordIds.includes(w.id)
                ? annotation.type === CORRECTION
                  ? { ...w, correctionId: annotation.id }
                  : { ...w, annotationId: annotation.id }
                : w,
            ),
          };
        }
        return {
          segmentsById,
          annotationsById: { ...state.annotationsById, [annotation.id]: annotation },
        };
      }),

    removeAnnotationLocally: (annotationId) =>
      set((state) => {
        const annotationsById = { ...state.annotationsById };
        delete annotationsById[annotationId];
        const segmentsById = { ...state.segmentsById };
        for (const id of Object.keys(segmentsById)) {
          const segment = segmentsById[id];
          if (
            segment.words.some(
              (w) => w.annotationId === annotationId || w.correctionId === annotationId,
            )
          ) {
            segmentsById[id] = {
              ...segment,
              words: segment.words.map((w) => ({
                ...w,
                annotationId: w.annotationId === annotationId ? null : w.annotationId,
                correctionId: w.correctionId === annotationId ? null : w.correctionId,
              })),
            };
          }
        }
        return { segmentsById, annotationsById };
      }),
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

function remapTempId(
  id: string | null,
  tempIds: Record<string, string>,
  removed: string[],
): string | null {
  if (!id) return null;
  if (removed.includes(id)) return null;
  return tempIds[id] ?? id;
}
