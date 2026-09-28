import { requireEnv } from "./env";
import { storageBackend } from "./storage";

/**
 * Supabase now issues two key shapes:
 * - Legacy JWTs (`eyJ…`) — required by the Storage tus `/upload/resumable` API
 * - New secret keys (`sb_secret_…`) — accepted by supabase-js and the object API,
 *   rejected by tus with "Invalid Compact JWS"
 */

export function isJwtKey(key: string): boolean {
  return key.startsWith("eyJ");
}

export function storageAuthHeaders(): Record<string, string> {
  const { SUPABASE_SERVICE_ROLE_KEY } = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
  };
}

export function usesLegacyJwt(): boolean {
  if (storageBackend() !== "supabase") return false;
  const { SUPABASE_SERVICE_ROLE_KEY } = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return isJwtKey(SUPABASE_SERVICE_ROLE_KEY);
}
