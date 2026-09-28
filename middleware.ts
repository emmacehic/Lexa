import { NextResponse, type NextRequest } from "next/server";

/**
 * Content-Security-Policy with a per-request nonce (§13). Next picks the nonce
 * up from the header and stamps it onto its own scripts, so `script-src` never
 * needs `unsafe-inline`.
 *
 * `style-src` does keep `unsafe-inline`: the workspace positions the
 * active-word underline and the waveform with inline style attributes, which
 * CSP treats as inline styles. Scripts — the part that matters for injection —
 * are nonce-only.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";

  let mediaOrigin = "";
  try {
    if (process.env.SUPABASE_URL) {
      mediaOrigin = new URL(process.env.SUPABASE_URL).origin;
    }
  } catch {
    mediaOrigin = "";
  }

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `media-src 'self' blob: ${mediaOrigin || "https:"}`,
    `connect-src 'self' ${mediaOrigin}${dev ? " ws: http://localhost:*" : ""}`,
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|api/uploads/).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
