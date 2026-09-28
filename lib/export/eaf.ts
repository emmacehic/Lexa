import {
  loadAnnotations,
  loadRecording,
  segmentSpanPages,
  tierNameFor,
  xmlEscape,
  type ExportAnnotation,
} from "./corpus";
import { CODE_SWITCH, LOANWORD } from "../labels";

/**
 * ELAN (§10.4). Three tiers — `transcript`, `loanword`, `code-switch` — plus
 * one tier for each custom label that actually occurs, because dropping them
 * would lose annotations on the way out (see DECISIONS.md).
 *
 * TIME_ORDER has to precede the tiers, so the time table is collected first.
 * Only numbers are held in memory; every annotation value is streamed.
 */
export async function* exportEaf(
  recordingId: string,
  options: { mediaUrl?: string } = {},
): AsyncGenerator<string> {
  const recording = await loadRecording(recordingId);
  const { all } = await loadAnnotations(recordingId);

  const times = new Set<number>();
  const add = (seconds: number) => times.add(Math.round(seconds * 1000));

  for await (const page of segmentSpanPages(recordingId)) {
    for (const segment of page) {
      add(segment.start);
      add(segment.end);
    }
  }
  for (const annotation of all) {
    add(annotation.start);
    add(annotation.end);
  }

  const sorted = [...times].sort((a, b) => a - b);
  const slotOf = new Map<number, string>();
  sorted.forEach((value, i) => slotOf.set(value, `ts${i + 1}`));
  const slot = (seconds: number) => slotOf.get(Math.round(seconds * 1000)) ?? "ts1";

  const stamp = new Date().toISOString();

  yield `<?xml version="1.0" encoding="UTF-8"?>\n`;
  yield `<ANNOTATION_DOCUMENT AUTHOR="Lexa" DATE="${stamp}" FORMAT="3.0" VERSION="3.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.mpi.nl/tools/elan/EAFv3.0.xsd">\n`;
  yield `  <HEADER MEDIA_FILE="" TIME_UNITS="milliseconds">\n`;
  yield `    <MEDIA_DESCRIPTOR MEDIA_URL="${xmlEscape(options.mediaUrl ?? recording.filename)}" MIME_TYPE="application/octet-stream" RELATIVE_MEDIA_URL="./${xmlEscape(recording.filename)}"/>\n`;
  yield `    <PROPERTY NAME="corpus">${xmlEscape(recording.projectName)}</PROPERTY>\n`;
  yield `  </HEADER>\n`;

  yield `  <TIME_ORDER>\n`;
  for (let i = 0; i < sorted.length; i += 500) {
    yield sorted
      .slice(i, i + 500)
      .map((value) => `    <TIME_SLOT TIME_SLOT_ID="${slotOf.get(value)}" TIME_VALUE="${value}"/>\n`)
      .join("");
  }
  yield `  </TIME_ORDER>\n`;

  // --- transcript tier ---------------------------------------------------
  let annotationId = 1;
  yield `  <TIER LINGUISTIC_TYPE_REF="lexa-transcript" TIER_ID="transcript">\n`;
  for await (const page of segmentSpanPages(recordingId)) {
    let chunk = "";
    for (const segment of page) {
      chunk +=
        `    <ANNOTATION>\n` +
        `      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a${annotationId++}" TIME_SLOT_REF1="${slot(segment.start)}" TIME_SLOT_REF2="${slot(segment.end)}">\n` +
        `        <ANNOTATION_VALUE>${xmlEscape(segment.text)}</ANNOTATION_VALUE>\n` +
        `      </ALIGNABLE_ANNOTATION>\n` +
        `    </ANNOTATION>\n`;
    }
    yield chunk;
  }
  yield `  </TIER>\n`;

  // --- label tiers -------------------------------------------------------
  const types = [
    LOANWORD,
    CODE_SWITCH,
    ...[...new Set(all.map((a) => a.type))].filter(
      (t) => t !== LOANWORD && t !== CODE_SWITCH,
    ),
  ];

  for (const type of types) {
    const tier = tierNameFor(type);
    yield `  <TIER LINGUISTIC_TYPE_REF="lexa-label" TIER_ID="${xmlEscape(tier)}">\n`;
    for (const a of all.filter((x) => x.type === type)) {
      yield renderLabel(a, slot, annotationId++);
    }
    yield `  </TIER>\n`;
  }

  yield `  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="lexa-transcript" TIME_ALIGNABLE="true"/>\n`;
  yield `  <LINGUISTIC_TYPE GRAPHIC_REFERENCES="false" LINGUISTIC_TYPE_ID="lexa-label" TIME_ALIGNABLE="true"/>\n`;
  yield `</ANNOTATION_DOCUMENT>\n`;
}

function renderLabel(
  annotation: ExportAnnotation,
  slot: (seconds: number) => string,
  id: number,
): string {
  const value = annotation.languageTag
    ? `${annotation.surface} [${annotation.languageTag}]`
    : annotation.surface;
  return (
    `    <ANNOTATION>\n` +
    `      <ALIGNABLE_ANNOTATION ANNOTATION_ID="a${id}" TIME_SLOT_REF1="${slot(annotation.start)}" TIME_SLOT_REF2="${slot(annotation.end)}">\n` +
    `        <ANNOTATION_VALUE>${xmlEscape(value)}</ANNOTATION_VALUE>\n` +
    `      </ALIGNABLE_ANNOTATION>\n` +
    `    </ANNOTATION>\n`
  );
}
