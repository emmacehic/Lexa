import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/** Argon2id, per §3. Parameters are the OWASP second-choice profile. */
// Algorithm.Argon2id === 2 in @node-rs/argon2; the numeric literal avoids an
// ambient const enum, which `isolatedModules` forbids.
const ARGON2ID = 2;

const ARGON_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(
  digest: string,
  password: string,
): Promise<boolean> {
  try {
    return await argonVerify(digest, password, ARGON_OPTIONS);
  } catch {
    return false;
  }
}

/** Opaque, URL-safe secret for invite and magic links. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Only the hash is stored, so a database leak does not hand out live links. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
