"use client";

import type { Op } from "@/lib/ops";
import type { OpsResultDTO } from "@/lib/dto";
import type { WorkspaceStore } from "./store";

/**
 * Persistence (§9.5).
 *
 * Mutations are applied locally first, queued, debounced 800 ms and sent as a
 * single ordered batch. If the network is gone the batch goes to IndexedDB and
 * is replayed on reconnect — the annotator is never blocked on a request.
 */

const DEBOUNCE_MS = 800;
const DB_NAME = "lexa-offline";
const STORE_NAME = "ops";

interface StoredBatch {
  id: string;
  recordingId: string;
  ops: Op[];
  queuedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = fn(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export class OpsQueue {
  private pending: Op[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private listeners = new Set<(result: OpsResultDTO) => void>();

  constructor(
    private readonly recordingId: string,
    private readonly store: WorkspaceStore,
  ) {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => void this.replayOffline());
      window.addEventListener("beforeunload", (event) => {
        if (this.pending.length > 0 || this.inFlight) {
          event.preventDefault();
        }
      });
      void this.replayOffline();
    }
  }

  onResult(listener: (result: OpsResultDTO) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(op: Op): void {
    this.pending.push(op);
    this.store.getState().setSaveState("saving", this.pending.length);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  /** Send immediately — used for undo/redo and before leaving the workspace. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) return;
    const batch = this.pending;
    if (batch.length === 0) {
      if (this.store.getState().saveState !== "offline") {
        this.store.getState().setSaveState("saved", 0);
      }
      return;
    }
    this.pending = [];
    this.inFlight = true;

    try {
      const result = await this.send(batch);
      this.store.getState().applyResult(result);
      this.listeners.forEach((listener) => listener(result));
      this.store
        .getState()
        .setSaveState(this.pending.length > 0 ? "saving" : "saved", this.pending.length);
    } catch (error) {
      if (isNetworkError(error)) {
        await this.storeOffline(batch);
        this.store.getState().setSaveState("offline", batch.length);
      } else {
        // A rejected operation is a real conflict: put the server's word back
        // in front of the annotator rather than pretending it saved.
        this.store
          .getState()
          .setError(error instanceof Error ? error.message : "That change was rejected.");
        this.store.getState().setSaveState("saved", 0);
        await this.reload();
      }
    } finally {
      this.inFlight = false;
      if (this.pending.length > 0) {
        this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
      }
    }
  }

  /**
   * Send a single operation immediately and hand back the result, so a
   * discrete action can react to a conflict (a timing that would overlap a
   * neighbour) instead of failing silently.
   */
  async sendNow(ops: Op[]): Promise<OpsResultDTO> {
    await this.flush();
    const result = await this.send(ops);
    this.store.getState().applyResult(result);
    this.listeners.forEach((listener) => listener(result));
    this.store.getState().setSaveState("saved", 0);
    return result;
  }

  private async send(ops: Op[]): Promise<OpsResultDTO> {
    const response = await fetch(`/api/recordings/${this.recordingId}/ops`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message ?? `The server refused the change (${response.status}).`);
    }
    return response.json();
  }

  async history(direction: "undo" | "redo"): Promise<void> {
    await this.flush();
    const response = await fetch(`/api/recordings/${this.recordingId}/history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (result?.nothingToDo) return;
    this.store.getState().applyResult(result as OpsResultDTO);
    this.listeners.forEach((listener) => listener(result as OpsResultDTO));
  }

  private async reload(): Promise<void> {
    const response = await fetch(`/api/recordings/${this.recordingId}`);
    if (!response.ok) return;
    this.store.getState().replaceAll(await response.json());
  }

  private async storeOffline(ops: Op[]): Promise<void> {
    const batch: StoredBatch = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      recordingId: this.recordingId,
      ops,
      queuedAt: Date.now(),
    };
    await withStore("readwrite", (store) => store.put(batch));
  }

  private async replayOffline(): Promise<void> {
    const all = (await withStore<StoredBatch[]>("readonly", (store) =>
      store.getAll() as IDBRequest<StoredBatch[]>,
    )) as StoredBatch[] | null;
    if (!all || all.length === 0) return;

    const mine = all
      .filter((batch) => batch.recordingId === this.recordingId)
      .sort((a, b) => a.queuedAt - b.queuedAt);
    if (mine.length === 0) return;

    for (const batch of mine) {
      try {
        const result = await this.send(batch.ops);
        this.store.getState().applyResult(result);
        this.listeners.forEach((listener) => listener(result));
        await withStore("readwrite", (store) => store.delete(batch.id));
      } catch (error) {
        if (isNetworkError(error)) return;
        // The server rejected a queued change; drop it and re-sync so the
        // annotator sees the truth rather than a phantom edit.
        await withStore("readwrite", (store) => store.delete(batch.id));
        await this.reload();
      }
    }
    this.store.getState().setSaveState("saved", 0);
  }
}

function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  return error instanceof TypeError;
}
