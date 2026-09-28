import ExcelJS from "exceljs";

import { prisma } from "../prisma";

export interface ImportedAnnotation {
  sampleId: string;
  form: string;
  label: string;
  sourceLanguage: string;
  nativeAlternative: string;
  pronunciation: string;
  confidence: string;
  comments: string;
}

/**
 * Import annotations from an XLSX annotation sheet into a recording
 * that already has segments. Matches annotations to segments via sample_id
 * and finds the annotated form within the segment text.
 */
export async function importXlsxAnnotations(
  recordingId: string,
  userId: string,
  buffer: Buffer,
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const annSheet = wb.getWorksheet("Annotations");
  if (!annSheet) {
    return { imported: 0, skipped: 0, errors: ["No 'Annotations' sheet found in the workbook."] };
  }

  const headers: string[] = [];
  annSheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").toLowerCase().trim();
  });

  const col = (name: string) => headers.indexOf(name) + 1 || 0;
  const sampleIdCol = col("sample_id");
  const formCol = col("form");
  const labelCol = col("label");
  const sourceLangCol = col("source_language");
  const nativeAltCol = col("native_alternative");
  const pronCol = col("pronunciation");
  const confCol = col("confidence");
  const commentsCol = col("comments");

  if (!sampleIdCol || !formCol || !labelCol) {
    return { imported: 0, skipped: 0, errors: ["Missing required columns: sample_id, form, label."] };
  }

  const rows: ImportedAnnotation[] = [];
  annSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sampleId = String(row.getCell(sampleIdCol).value ?? "").trim();
    const form = String(row.getCell(formCol).value ?? "").trim();
    const label = String(row.getCell(labelCol).value ?? "").trim();
    if (!sampleId || !form || !label) return;
    rows.push({
      sampleId,
      form,
      label,
      sourceLanguage: sourceLangCol ? String(row.getCell(sourceLangCol).value ?? "").trim() : "",
      nativeAlternative: nativeAltCol ? String(row.getCell(nativeAltCol).value ?? "").trim() : "",
      pronunciation: pronCol ? String(row.getCell(pronCol).value ?? "").trim() : "",
      confidence: confCol ? String(row.getCell(confCol).value ?? "").trim() : "",
      comments: commentsCol ? String(row.getCell(commentsCol).value ?? "").trim() : "",
    });
  });

  const segments = await prisma.segment.findMany({
    where: { recordingId },
    include: { words: { orderBy: { index: "asc" } } },
    orderBy: { index: "asc" },
  });

  const segmentByLabel = new Map<string, typeof segments[number]>();
  for (const seg of segments) {
    segmentByLabel.set(`S${String(seg.index + 1).padStart(3, "0")}`, seg);
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const normalizeLabel = (raw: string): string => {
    const lower = raw.toLowerCase().replace(/[-\s]+/g, "_");
    if (lower === "loanword") return "loanword";
    if (lower === "code_switch" || lower === "codeswitch" || lower === "code-switch") return "code_switch";
    if (lower === "unclear") return "unclear";
    return lower;
  };

  const validPronunciation = new Set(["local", "foreign", "mixed/unclear"]);
  const validConfidence = new Set(["high", "medium", "low"]);

  for (const row of rows) {
    const segment = segmentByLabel.get(row.sampleId);
    if (!segment) {
      errors.push(`Segment "${row.sampleId}" not found, skipping annotation for "${row.form}".`);
      skipped++;
      continue;
    }

    const formLower = row.form.toLowerCase();
    const matchingWords = [];
    for (let i = 0; i < segment.words.length; i++) {
      let combined = "";
      const wordGroup = [];
      for (let j = i; j < segment.words.length; j++) {
        if (combined) combined += " ";
        combined += segment.words[j].text;
        wordGroup.push(segment.words[j]);
        if (combined.toLowerCase() === formLower) break;
        if (combined.length > formLower.length + 10) break;
      }
      if (combined.toLowerCase() === formLower) {
        matchingWords.push(...wordGroup);
        break;
      }
    }

    if (matchingWords.length === 0) {
      errors.push(`Could not find "${row.form}" in segment ${row.sampleId}, skipping.`);
      skipped++;
      continue;
    }

    const alreadyAnnotated = matchingWords.some((w) => w.annotationId !== null);
    if (alreadyAnnotated) {
      errors.push(`"${row.form}" in ${row.sampleId} is already annotated, skipping.`);
      skipped++;
      continue;
    }

    const type = normalizeLabel(row.label);
    const annotation = await prisma.annotation.create({
      data: {
        recordingId,
        type,
        surface: matchingWords.map((w) => w.text).join(" "),
        start: matchingWords[0].start,
        end: matchingWords[matchingWords.length - 1].end,
        languageTag: row.sourceLanguage || null,
        nativeAlternative: row.nativeAlternative || null,
        pronunciation: validPronunciation.has(row.pronunciation) ? row.pronunciation : null,
        confidence: validConfidence.has(row.confidence) ? row.confidence : null,
        note: row.comments || null,
        status: "ACTIVE",
        createdById: userId,
      },
    });

    await prisma.word.updateMany({
      where: { id: { in: matchingWords.map((w) => w.id) } },
      data: { annotationId: annotation.id },
    });

    imported++;
  }

  return { imported, skipped, errors };
}
