import { handle, json } from "@/lib/api";
import { assertRecordingAccess, requireUser } from "@/lib/authz";
import {
  loadAnnotations,
  loadRecording,
  segmentPages,
} from "@/lib/export/corpus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the full corpus data (segments + annotations) as JSON for the
 * client-side preview table. Paged loading on the server, single JSON
 * response — the dataset is bounded by one recording so this is fine.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await params;
    await assertRecordingAccess(id, user);

    const recording = await loadRecording(id);
    const { all: annotations, bySegment } = await loadAnnotations(id);

    const segmentIndexById = new Map<string, number>();

    interface CorpusSegment {
      index: number;
      start: number;
      end: number;
      text: string;
      speakerTag: string | null;
      isReviewed: boolean;
      annotationTypes: string[];
    }

    const segments: CorpusSegment[] = [];

    for await (const page of segmentPages(id)) {
      for (const s of page) {
        segmentIndexById.set(s.id, s.index);
        const anns = bySegment.get(s.id) ?? [];
        segments.push({
          index: s.index,
          start: s.start,
          end: s.end,
          text: s.text,
          speakerTag: s.speakerTag,
          isReviewed: s.isReviewed,
          annotationTypes: [...new Set(anns.map((a) => a.type))],
        });
      }
    }

    return json({
      recording: {
        id: recording.id,
        filename: recording.filename,
        durationSec: recording.durationSec,
        languages: recording.languages,
        projectName: recording.projectName,
        speakerName: recording.speakerName,
        speaker: recording.speaker,
        sourceUrl: recording.sourceUrl,
        sourceContext: recording.sourceContext,
      },
      segments,
      annotations: annotations.map((a) => ({
        id: a.id,
        type: a.type,
        surface: a.surface,
        start: a.start,
        end: a.end,
        languageTag: a.languageTag,
        nativeAlternative: a.nativeAlternative,
        pronunciation: a.pronunciation,
        confidence: a.confidence,
        note: a.note,
        status: a.status,
        annotatedBy: a.annotatedBy,
        annotatedAt: a.annotatedAt,
        segmentIndex: a.segmentId
          ? (segmentIndexById.get(a.segmentId) ?? null)
          : null,
      })),
    });
  });
}
