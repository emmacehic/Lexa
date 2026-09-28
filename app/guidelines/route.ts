import { readFileSync } from "node:fs";
import { join } from "node:path";

import { currentUser } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAV = `<div id="lexa-guidelines-nav" style="position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px;background:#fff;border-bottom:1px solid #dfe3e8;font-family:Arial,Helvetica,sans-serif;font-size:13px">
  <strong style="color:#0028A5">Annotation Guidelines</strong>
  <nav style="display:flex;gap:10px">
    <a href="/library" style="color:#0028A5;text-decoration:none;font-weight:600">Library</a>
    <a href="/workflow" style="color:#0028A5;text-decoration:none;font-weight:600">Project Workflow</a>
  </nav>
</div>`;

let cached: string | null = null;

function guidelinesHtml(): string {
  if (cached) return cached;
  const raw = readFileSync(
    join(process.cwd(), "public", "annotation-guidelines.html"),
    "utf8",
  );
  cached = raw.includes("<body>")
    ? raw.replace("<body>", `<body>${NAV}`)
    : `${NAV}${raw}`;
  return cached;
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return Response.redirect(new URL("/login", request.url));
  }

  return new Response(guidelinesHtml(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  });
}
