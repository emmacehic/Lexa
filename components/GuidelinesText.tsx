/**
 * Renders plain-text annotation guidelines (not Markdown).
 * The canonical document is website-ready prose with numbered sections and bullets.
 */

import type { ReactNode } from "react";

type Block =
  | { kind: "title"; text: string }
  | { kind: "section"; title: string; body: string }
  | { kind: "subsection"; title: string; body: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbered"; items: string[] }
  | { kind: "example"; label: string; lines: string[] };

const SUBSECTION_TITLES = new Set([
  "Loanword",
  "Code-switch",
  "Unclear",
  "Words that do not need annotation",
  "Source language",
  "Recipient or main language",
  "Native alternative",
  "Pronunciation",
  "Confidence",
  "Note or comments",
  "Proper names",
  "Abbreviations",
  "Adapted loanwords",
  "Quotations",
  "Fillers and discourse markers",
  "Dialectal and regional forms",
  "Technical and international vocabulary",
]);

function isSectionTitle(line: string): boolean {
  return /^\d+\.\s/.test(line);
}

function isSubsectionTitle(line: string): boolean {
  return (
    SUBSECTION_TITLES.has(line) ||
    line.endsWith("?") ||
    /^Annotation \d+:$/.test(line) ||
    line === "Transcript:" ||
    line === "Example:"
  );
}

function parseBlocks(text: string): Block[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\n+/);
  const blocks: Block[] = [];

  for (const paragraph of paragraphs) {
    const lines = paragraph.split("\n");
    const first = lines[0]?.trim() ?? "";
    if (!first) continue;

    if (blocks.length === 0 && !isSectionTitle(first)) {
      blocks.push({ kind: "title", text: first });
      const rest = lines.slice(1).join("\n").trim();
      if (rest) blocks.push(...parseBlocks(rest));
      continue;
    }

    if (isSectionTitle(first)) {
      blocks.push({
        kind: "section",
        title: first,
        body: lines.slice(1).join("\n").trim(),
      });
      continue;
    }

    if (isSubsectionTitle(first)) {
      const bodyLines = lines.slice(1);
      const exampleLines = bodyLines.filter((l) => l.startsWith("  ") && l.trim());
      const prose = bodyLines.filter((l) => !l.startsWith("  ")).join("\n").trim();

      if (first === "Example:" || first === "Transcript:") {
        blocks.push({
          kind: "example",
          label: first,
          lines: exampleLines.map((l) => l.trim()),
        });
        if (prose) blocks.push(...parseBlocks(prose));
        continue;
      }

      blocks.push({ kind: "subsection", title: first, body: bodyLines.join("\n").trim() });
      continue;
    }

    if (lines.every((l) => !l.trim() || l.trim().startsWith("•"))) {
      blocks.push({
        kind: "bullets",
        items: lines
          .map((l) => l.trim())
          .filter((l) => l.startsWith("•"))
          .map((l) => l.replace(/^•\s*/, "")),
      });
      continue;
    }

    if (lines.every((l) => !l.trim() || /^\d+\.\s/.test(l.trim()))) {
      blocks.push({
        kind: "numbered",
        items: lines
          .map((l) => l.trim())
          .filter((l) => /^\d+\.\s/.test(l))
          .map((l) => l.replace(/^\d+\.\s*/, "")),
      });
      continue;
    }

    if (lines.some((l) => l.startsWith("  ") && l.trim())) {
      const exampleIdx = lines.findIndex((l) => l.startsWith("  ") && l.trim());
      const before = lines.slice(0, exampleIdx).join("\n").trim();
      const example = lines
        .slice(exampleIdx)
        .filter((l) => l.startsWith("  "))
        .map((l) => l.trim());
      const afterStart = lines.findIndex(
        (l, i) => i > exampleIdx && l.trim() && !l.startsWith("  "),
      );
      const after =
        afterStart >= 0 ? lines.slice(afterStart).join("\n").trim() : "";

      if (before) blocks.push({ kind: "paragraph", text: before });
      blocks.push({ kind: "example", label: "Example", lines: example });
      if (after) blocks.push(...parseBlocks(after));
      continue;
    }

    blocks.push({ kind: "paragraph", text: paragraph.trim() });
  }

  return blocks;
}

function renderBody(body: string): ReactNode {
  if (!body.trim()) return null;
  return parseBlocks(body).map((block, index) => (
    <BlockView key={`body-${index}`} block={block} />
  ));
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "title":
      return (
        <h2 className="mb-5 text-[18px] font-semibold tracking-tight">{block.text}</h2>
      );
    case "section":
      return (
        <section className="mt-8 first:mt-0">
          <h3 className="mb-3 text-[15px] font-semibold text-[var(--text-primary)]">
            {block.title}
          </h3>
          <div className="flex flex-col gap-3">{renderBody(block.body)}</div>
        </section>
      );
    case "subsection":
      return (
        <div className="mt-4">
          <h4 className="mb-2 text-[14px] font-medium">{block.title}</h4>
          <div className="flex flex-col gap-3">{renderBody(block.body)}</div>
        </div>
      );
    case "paragraph":
      return <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{block.text}</p>;
    case "bullets":
      return (
        <ul className="my-1 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "numbered":
      return (
        <ol className="my-1 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      );
    case "example":
      return (
        <div className="my-2">
          {block.label !== "Example" ? (
            <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-soft">
              {block.label.replace(":", "")}
            </p>
          ) : null}
          <blockquote
            className="rounded-panel glass-inset px-3 py-2 text-[13px] italic leading-relaxed"
            style={{ borderLeft: "3px solid var(--accent)" }}
          >
            {block.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </blockquote>
        </div>
      );
  }
}

export function GuidelinesText({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return <article className="guidelines-text">{blocks.map((block, i) => <BlockView key={i} block={block} />)}</article>;
}

/** Group projects that share identical guideline text (avoids triple display). */
export function groupGuidelines(
  projects: { name: string; guidelines: string | null }[],
  fallback: string,
): { text: string; projectNames: string[] }[] {
  const groups = new Map<string, string[]>();

  for (const project of projects) {
    const text = (project.guidelines?.trim() || fallback).trim();
    const names = groups.get(text) ?? [];
    names.push(project.name);
    groups.set(text, names);
  }

  return [...groups.entries()].map(([text, projectNames]) => ({ text, projectNames }));
}
