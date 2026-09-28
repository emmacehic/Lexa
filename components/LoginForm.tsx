"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { LanguagePicker } from "@/components/LanguagePicker";
import { LanguageFlag } from "@/components/LanguageFlag";
import {
  PROFICIENCY_LEVELS,
  type ProficiencyLevel,
} from "@/lib/user-languages";
import { whisperLanguageByCode } from "@/lib/whisper-languages";

type View = "login" | "register" | "link-sent";

export function LoginForm() {
  const router = useRouter();
  const [view, setView] = useState<View>("login");
  const [loginMode, setLoginMode] = useState<"password" | "link">("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [languageProficiency, setLanguageProficiency] = useState<
    Record<string, ProficiencyLevel | "">
  >({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setError(null);
    setPassword("");
  }

  /* -------------------------------------------------------------- */
  /* Login                                                          */
  /* -------------------------------------------------------------- */

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setBusy(false);
    if (result?.error) {
      setError("That name and password do not match an account.");
      return;
    }
    router.replace("/library");
    router.refresh();
  }

  async function submitLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/auth/magic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(
        body?.error?.message ??
          "The sign-in link could not be sent. Ask your project admin to check the SMTP settings.",
      );
      return;
    }
    setView("link-sent");
  }

  /* -------------------------------------------------------------- */
  /* Register                                                       */
  /* -------------------------------------------------------------- */

  async function submitRegister(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        password,
        languages: languages.map((code) => ({
          code,
          proficiency: languageProficiency[code],
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? "Registration failed.");
      setBusy(false);
      return;
    }

    const signInResult = await signIn("credentials", {
      email: name.trim(),
      password,
      redirect: false,
    });
    setBusy(false);

    if (signInResult?.error) {
      setError("Account created, but auto-login failed. Please sign in.");
      setView("login");
      return;
    }
    router.replace("/library");
    router.refresh();
  }

  /* -------------------------------------------------------------- */
  /* Render                                                         */
  /* -------------------------------------------------------------- */

  return (
    <div
      className="glass glass-e2 w-full max-w-[420px] p-7"
      style={{ borderRadius: "var(--radius-panel)" }}
    >
      <h1 className="brand-mark mb-1">Lexa</h1>
      <p className="text-soft mb-6 text-[13px]">
        Transcription, loanword, and code-switching annotation. Created by Emma Cehic
      </p>

      {view === "link-sent" ? (
        <div>
          <p className="text-[14px]">
            If that address has an account, a sign-in link is on its way. It works
            once and expires in 15 minutes.
          </p>
          <button
            type="button"
            className="control control-plain mt-5 px-0"
            onClick={() => {
              setView("login");
              setLoginMode("password");
              reset();
            }}
          >
            Back to sign in
          </button>
        </div>
      ) : view === "login" ? (
        <form
          key={loginMode}
          onSubmit={loginMode === "password" ? submitPassword : submitLink}
          className="flex flex-col gap-3"
        >
          <label className="sr-only" htmlFor="login-id">
            {loginMode === "password" ? "Name" : "Email"}
          </label>
          <input
            id="login-id"
            className="field"
            type={loginMode === "password" ? "text" : "email"}
            autoComplete="username"
            placeholder={loginMode === "password" ? "Name" : "Email"}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {loginMode === "password" && (
            <>
              <label className="sr-only" htmlFor="password">Password</label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}

          {error && (
            <p role="alert" className="text-[13px]" style={{ color: "var(--loanword)" }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            className="control control-primary mt-2 h-9 w-full"
            disabled={busy}
          >
            {busy ? "One moment…" : loginMode === "password" ? "Sign in" : "Send the link"}
          </button>

          <button
            type="button"
            className="control control-plain h-8 w-full text-[13px]"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => {
              reset();
              setLoginMode(loginMode === "password" ? "link" : "password");
            }}
          >
            {loginMode === "password" ? "Send me a link instead" : "Use a password"}
          </button>

          <div className="mt-2 flex items-center gap-3" style={{ borderTop: "1px solid var(--hairline)", paddingTop: 12 }}>
            <span className="text-soft text-[13px]">No account yet?</span>
            <button
              type="button"
              className="control h-8 flex-1 text-[13px]"
              onClick={() => { reset(); setView("register"); }}
            >
              Create account
            </button>
          </div>
        </form>
      ) : (
        <RegisterForm
          name={name}
          setName={setName}
          password={password}
          setPassword={setPassword}
          languages={languages}
          onLanguagesChange={(codes) => {
            setLanguages(codes);
            setLanguageProficiency((prev) => {
              const next: Record<string, ProficiencyLevel | ""> = {};
              for (const code of codes) {
                next[code] = prev[code] ?? "";
              }
              return next;
            });
          }}
          languageProficiency={languageProficiency}
          setLanguageProficiency={setLanguageProficiency}
          error={error}
          busy={busy}
          onSubmit={submitRegister}
          onBack={() => { reset(); setView("login"); }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Register form                                                      */
/* ------------------------------------------------------------------ */

function RegisterForm({
  name,
  setName,
  password,
  setPassword,
  languages,
  onLanguagesChange,
  languageProficiency,
  setLanguageProficiency,
  error,
  busy,
  onSubmit,
  onBack,
}: {
  name: string;
  setName: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  languages: string[];
  onLanguagesChange: (codes: string[]) => void;
  languageProficiency: Record<string, ProficiencyLevel | "">;
  setLanguageProficiency: (
    value:
      | Record<string, ProficiencyLevel | "">
      | ((prev: Record<string, ProficiencyLevel | "">) => Record<string, ProficiencyLevel | "">),
  ) => void;
  error: string | null;
  busy: boolean;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
}) {
  const languagesComplete =
    languages.length === 0 ||
    languages.every((code) => Boolean(languageProficiency[code]));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <p className="text-[14px] font-medium">Create account</p>

      <input
        className="field"
        placeholder="Name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <input
        className="field"
        type="password"
        autoComplete="new-password"
        placeholder="Password (min. 10 characters)"
        required
        minLength={10}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <div>
        <p className="text-soft mb-1.5 text-[12px]">Languages you speak</p>
        <LanguagePicker selected={languages} onChange={onLanguagesChange} />
      </div>

      {languages.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-soft text-[12px]">Proficiency for each language</p>
          {languages.map((code) => {
            const lang = whisperLanguageByCode(code);
            const selected = languageProficiency[code] ?? "";
            return (
              <div
                key={code}
                className="flex flex-col gap-1.5 p-2"
                style={{
                  border: "1px solid var(--hairline)",
                  borderRadius: "var(--radius-control)",
                }}
              >
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <LanguageFlag tag={code} size={14} />
                  <span>{lang?.name ?? code}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PROFICIENCY_LEVELS.map((level) => (
                    <button
                      type="button"
                      key={level}
                      className="control h-7 px-2 text-[11px]"
                      style={
                        selected === level
                          ? {
                              background: "color-mix(in oklch, var(--accent) 16%, transparent)",
                              borderColor: "var(--accent)",
                            }
                          : undefined
                      }
                      onClick={() =>
                        setLanguageProficiency((prev) => ({
                          ...prev,
                          [code]: prev[code] === level ? "" : level,
                        }))
                      }
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {error && (
        <p role="alert" className="text-[13px]" style={{ color: "var(--loanword)" }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        className="control control-primary mt-2 h-9 w-full"
        disabled={busy || !languagesComplete}
      >
        {busy ? "Creating account…" : "Create account"}
      </button>

      <button
        type="button"
        className="control control-plain h-8 w-full text-[13px]"
        style={{ color: "var(--text-secondary)" }}
        onClick={onBack}
      >
        Already have an account? Sign in
      </button>
    </form>
  );
}
