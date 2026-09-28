import { z } from "zod";

/**
 * Environment access.
 *
 * Nothing here throws at import time — a missing credential must surface as a
 * precise, named setup error at the point of use (§1.2), not as a blank crash
 * on boot. `requireEnv` produces that error.
 */

export class SetupError extends Error {
  readonly variables: string[];
  readonly hint: string;

  constructor(variables: string[], hint: string) {
    super(
      `Missing configuration: ${variables.join(", ")}. ${hint}`,
    );
    this.name = "SetupError";
    this.variables = variables;
    this.hint = hint;
  }
}

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(1).optional(),
  AUTH_URL: z.string().url().default("http://localhost:3000"),
  REDIS_URL: z.string().min(1).optional(),
  STORAGE_BACKEND: z.enum(["supabase", "local", "hybrid"]).default("supabase"),
  LOCAL_MEDIA_PATH: z.string().min(1).optional(),
  HYBRID_SUPABASE_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(100 * 1024 * 1024),
  SUPABASE_URL: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_BUCKET: z.string().min(1).default("recordings"),
  GCP_PROJECT_ID: z.string().min(1).optional(),
  GCP_LOCATION: z.string().min(1).default("europe-west4"),
  GCP_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  GCS_STAGING_BUCKET: z.string().min(1).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OLLAMA_URL: z.string().min(1).default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3.5:latest"),
  WHISPER_SERVER_URL: z.string().min(1).default("http://localhost:9000"),
  WHISPER_MODEL: z.string().min(1).default("base"),
  WHISPER_API_KEY: z.string().min(1).optional(),
  SMTP_URL: z.string().min(1).optional(),
  SMTP_FROM: z.string().min(1).optional(),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@lexa.local"),
  SEED_ADMIN_PASSWORD: z.string().min(1).optional(),
  SEED_ADMIN_NAME: z.string().min(1).default("Admin"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (!cached) {
    const parsed = serverSchema.safeParse(process.env);
    if (!parsed.success) {
      const bad = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new SetupError(
        [bad],
        "Check .env.local against .env.example — the value is present but malformed.",
      );
    }
    cached = parsed.data;
  }
  return cached;
}

type RequiredKey = keyof ServerEnv;

const HINTS: Partial<Record<RequiredKey, string>> = {
  DATABASE_URL:
    "Create a Postgres database (Neon or Supabase) and paste its connection string into .env.local.",
  AUTH_SECRET: "Generate one with `openssl rand -base64 32`.",
  REDIS_URL:
    "Create a Redis instance (Upstash free tier is enough) and paste its rediss:// URL into .env.local.",
  STORAGE_BACKEND:
    "Use `local` for disk-only, `supabase` for cloud-only, or `hybrid` for small files on Supabase and large files on disk.",
  LOCAL_MEDIA_PATH:
    "Required when STORAGE_BACKEND=local — an absolute folder path, e.g. D:\\lexa-recordings.",
  SUPABASE_URL: "Copy it from your Supabase project settings → API.",
  SUPABASE_SERVICE_ROLE_KEY:
    "Copy the service role key from Supabase → project settings → API. It must never reach the browser.",
  GCP_PROJECT_ID: "Your Google Cloud project id, from the console's project picker.",
  GCP_SERVICE_ACCOUNT_JSON:
    "Create a service account with roles/speech.client and roles/storage.objectAdmin, download its JSON key and paste it on one line.",
  GCS_STAGING_BUCKET:
    "Create a Cloud Storage bucket in the same region as GCP_LOCATION for staging the normalized audio.",
  GEMINI_API_KEY: "Create a key at aistudio.google.com and paste it into .env.local.",
  SMTP_URL:
    "Magic-link sign-in needs an SMTP URL, e.g. smtp://user:pass@smtp.example.com:587.",
};

/**
 * Read variables that must be present, or throw a SetupError naming exactly
 * which ones are missing and how to obtain them.
 */
export function requireEnv<K extends RequiredKey>(
  ...keys: K[]
): { [P in K]: NonNullable<ServerEnv[P]> } {
  const e = env();
  const missing = keys.filter((k) => {
    const v = e[k];
    return v === undefined || v === null || v === "";
  });
  if (missing.length > 0) {
    const hint = missing
      .map((k) => HINTS[k])
      .filter(Boolean)
      .join(" ");
    throw new SetupError(
      missing as string[],
      hint || "Add it to .env.local — see .env.example.",
    );
  }
  const out = {} as { [P in K]: NonNullable<ServerEnv[P]> };
  for (const k of keys) {
    out[k] = e[k] as NonNullable<ServerEnv[K]>;
  }
  return out;
}

export function isConfigured(...keys: RequiredKey[]): boolean {
  try {
    requireEnv(...keys);
    return true;
  } catch {
    return false;
  }
}
