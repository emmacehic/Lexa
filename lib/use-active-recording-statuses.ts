"use client";

import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import type { LibraryRow } from "@/lib/recordings";
import {
  isActiveTranscriptionStatus,
  type RecordingStatusSnapshot,
} from "@/lib/transcription-status";

export function useActiveRecordingStatuses(
  rows: LibraryRow[],
  onRefresh: () => void,
): Map<string, RecordingStatusSnapshot> {
  const activeIds = useMemo(
    () => rows.filter((r) => isActiveTranscriptionStatus(r.status)).map((r) => r.id),
    [rows],
  );

  const queries = useQueries({
    queries: activeIds.map((id) => ({
      queryKey: ["recording-status", id],
      queryFn: async (): Promise<RecordingStatusSnapshot> => {
        const response = await fetch(`/api/recordings/${id}/status`);
        if (!response.ok) throw new Error("status unavailable");
        return response.json();
      },
      refetchInterval: (query: { state: { data?: RecordingStatusSnapshot } }) => {
        const status = query.state.data?.status;
        return status === "READY" || status === "COMPLETE" || status === "FAILED"
          ? false
          : 2000;
      },
    })),
  });

  const liveById = useMemo(() => {
    const map = new Map<string, RecordingStatusSnapshot>();
    activeIds.forEach((id, index) => {
      const data = queries[index]?.data;
      if (data) map.set(id, data);
    });
    return map;
  }, [activeIds, queries]);

  useEffect(() => {
    const needsRefresh = activeIds.some((id, index) => {
      const live = queries[index]?.data;
      const row = rows.find((r) => r.id === id);
      if (!live || !row) return false;
      if (
        (live.status === "READY" || live.status === "COMPLETE") &&
        row.status !== live.status
      ) {
        return true;
      }
      return live.status === "FAILED" && row.status !== "FAILED";
    });
    if (needsRefresh) onRefresh();
  }, [activeIds, queries, rows, onRefresh]);

  return liveById;
}
