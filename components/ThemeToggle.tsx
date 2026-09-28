"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const KEY = "lexa.theme";

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Light / dark only — no system option. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const next = storedTheme();
    setTheme(next);
    applyTheme(next);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(KEY, next);
    applyTheme(next);
  };

  const dark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-switch"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      onClick={toggle}
    >
      <span className="theme-switch-track" aria-hidden>
        <svg className="theme-switch-icon theme-switch-sun" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="2.4" fill="currentColor" />
          <path
            d="M8 1.6v1.4M8 13v1.4M1.6 8h1.4M13 8h1.4M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <svg className="theme-switch-icon theme-switch-moon" viewBox="0 0 16 16" fill="none">
          <path
            d="M13.2 9.4A5.2 5.2 0 0 1 6.6 2.8 5.3 5.3 0 1 0 13.2 9.4Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="theme-switch-knob" aria-hidden />
    </button>
  );
}
