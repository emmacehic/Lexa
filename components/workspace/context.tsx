"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";

import type { TranscriptDTO } from "@/lib/dto";
import { createWorkspaceStore, type WorkspaceState, type WorkspaceStore } from "./store";
import { OpsQueue } from "./ops-queue";

interface WorkspaceContextValue {
  store: WorkspaceStore;
  queue: OpsQueue;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({
  transcript,
  children,
}: {
  transcript: TranscriptDTO;
  children: ReactNode;
}) {
  const ref = useRef<WorkspaceContextValue | null>(null);
  if (ref.current === null) {
    const store = createWorkspaceStore(transcript);
    ref.current = { store, queue: new OpsQueue(transcript.recording.id, store) };
  }
  return (
    <WorkspaceContext.Provider value={ref.current}>
      {children}
    </WorkspaceContext.Provider>
  );
}

function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a WorkspaceProvider");
  return value;
}

/** Subscribe to a slice. Components only re-render for what they select. */
export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  const { store } = useWorkspaceContext();
  return useStore(store, selector);
}

export function useWorkspaceStore(): WorkspaceStore {
  return useWorkspaceContext().store;
}

export function useOpsQueue(): OpsQueue {
  return useWorkspaceContext().queue;
}
