"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

interface InviteInfo {
  projectName: string;
  email: string | null;
  role: "ADMIN" | "CONTRIBUTOR";
}

/** Registration exists only behind an invitation (§3). */
export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/invites/${encodeURIComponent(token)}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error?.message ?? "That invitation link is not valid.");
        return;
      }
      setInfo(body);
      if (body.email) setEmail(body.email);
    })();
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setBusy(false);
      setError(body?.error?.message ?? "The account could not be created.");
      return;
    }
    await signIn("credentials", { email, password, redirect: false });
    router.replace("/library");
    router.refresh();
  }

  return (
    <div
      className="glass glass-e2 w-full max-w-[400px] p-7"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      <h1 className="mb-1">Join {info?.projectName ?? "Lexa"}</h1>
      <p className="text-soft mb-6 text-[13px]">
        {info
          ? `You have been invited as a ${info.role === "ADMIN" ? "project admin" : "contributor"}.`
          : "Checking the invitation…"}
      </p>

      {info ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            className="field"
            placeholder="Your name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="field"
            type="email"
            placeholder="Email"
            autoComplete="username"
            required
            readOnly={Boolean(info.email)}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="field"
            type="password"
            placeholder="Password — at least 10 characters"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-[13px]" style={{ color: "var(--loanword)" }}>
              {error}
            </p>
          ) : null}
          <button className="control control-primary mt-2 h-9 w-full" disabled={busy}>
            {busy ? "Creating your account…" : "Create account"}
          </button>
        </form>
      ) : error ? (
        <p role="alert" className="text-[14px]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
