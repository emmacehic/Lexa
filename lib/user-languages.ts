export const PROFICIENCY_LEVELS = [
  "native",
  "fluent",
  "intermediate",
  "beginner",
] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];

export interface UserLanguageEntry {
  code: string;
  proficiency: ProficiencyLevel;
}

export function isProficiencyLevel(value: string): value is ProficiencyLevel {
  return (PROFICIENCY_LEVELS as readonly string[]).includes(value);
}

export function parseUserLanguageProficiency(
  value: unknown,
): UserLanguageEntry[] {
  if (!Array.isArray(value)) return [];
  const out: UserLanguageEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const code = "code" in item ? String(item.code) : "";
    const proficiency =
      "proficiency" in item ? String(item.proficiency) : "";
    if (!code || !isProficiencyLevel(proficiency)) continue;
    out.push({ code, proficiency });
  }
  return out;
}
