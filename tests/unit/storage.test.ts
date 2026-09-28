import { afterEach, describe, expect, it, vi } from "vitest";

describe("plannedStorageLocation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("routes small files to Supabase in hybrid mode", async () => {
    vi.stubEnv("STORAGE_BACKEND", "hybrid");
    vi.stubEnv("HYBRID_SUPABASE_MAX_BYTES", "104857600");
    const { plannedStorageLocation } = await import("@/lib/storage");
    expect(plannedStorageLocation(60 * 1024 * 1024)).toBe("SUPABASE");
    expect(plannedStorageLocation(200 * 1024 * 1024)).toBe("LOCAL");
  });

  it("uses a single backend when not hybrid", async () => {
    vi.stubEnv("STORAGE_BACKEND", "local");
    const { plannedStorageLocation } = await import("@/lib/storage");
    expect(plannedStorageLocation(1024)).toBe("LOCAL");

    vi.resetModules();
    vi.stubEnv("STORAGE_BACKEND", "supabase");
    const mod = await import("@/lib/storage");
    expect(mod.plannedStorageLocation(200 * 1024 * 1024)).toBe("SUPABASE");
  });
});

describe("canFallbackToLocal", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("allows fallback in hybrid mode", async () => {
    vi.stubEnv("STORAGE_BACKEND", "hybrid");
    const { canFallbackToLocal } = await import("@/lib/storage");
    expect(canFallbackToLocal()).toBe(true);
  });

  it("allows fallback in supabase mode when LOCAL_MEDIA_PATH is set", async () => {
    vi.stubEnv("STORAGE_BACKEND", "supabase");
    vi.stubEnv("LOCAL_MEDIA_PATH", "D:\\lexa-recordings");
    const { canFallbackToLocal } = await import("@/lib/storage");
    expect(canFallbackToLocal()).toBe(true);
  });
});

describe("localUploadModeForSize", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("picks direct for medium files and tus for very large ones", async () => {
    const { localUploadModeForSize } = await import("@/lib/storage");
    expect(localUploadModeForSize(60 * 1024 * 1024)).toBe("direct");
    expect(localUploadModeForSize(600 * 1024 * 1024)).toBe("tus");
  });
});
