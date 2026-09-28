import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** Canonical annotation guidelines shipped with Lexa (`content/annotation-guidelines.md`). */
export function defaultAnnotationGuidelines(): string {
  if (cached) return cached;
  const path = join(process.cwd(), "content", "annotation-guidelines.md");
  cached = readFileSync(path, "utf8");
  return cached;
}

/** Call after replacing the canonical guidelines file (e.g. in seed). */
export function clearGuidelinesCache(): void {
  cached = null;
}
