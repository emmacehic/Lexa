"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Exchanges a single-use magic-link token for a session. */
export function MagicLinkConsumer({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setError("That link is missing its token.");
      return;
    }
    void (async () => {
      const result = await signIn("magic", { token, redirect: false });
      if (cancelled) return;
      if (result?.error) {
        setError("That link has already been used or has expired.");
        return;
      }
      router.replace("/library");
      router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <div
      className="glass glass-e2 w-full max-w-[380px] p-7"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      <h1 className="mb-2">Lexa</h1>
      {error ? (
        <>
          <p className="text-[14px]">{error}</p>
          <a className="control mt-5 inline-flex" href="/login">
            Ask for a new link
          </a>
        </>
      ) : (
        <p className="text-soft text-[14px]">Signing you in…</p>
      )}
    </div>
  );
}
