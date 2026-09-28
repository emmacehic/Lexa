import { srtTime, vttTime } from "../time";
import { segmentSpanPages } from "./corpus";

/** §10.3 — the corrected transcript as subtitles. */
export async function* exportVtt(recordingId: string): AsyncGenerator<string> {
  yield "WEBVTT\n\n";
  let cue = 1;
  for await (const page of segmentSpanPages(recordingId)) {
    let chunk = "";
    for (const segment of page) {
      chunk += `${cue}\n${vttTime(segment.start)} --> ${vttTime(segment.end)}\n${segment.text}\n\n`;
      cue++;
    }
    yield chunk;
  }
}

export async function* exportSrt(recordingId: string): AsyncGenerator<string> {
  let cue = 1;
  for await (const page of segmentSpanPages(recordingId)) {
    let chunk = "";
    for (const segment of page) {
      chunk += `${cue}\n${srtTime(segment.start)} --> ${srtTime(segment.end)}\n${segment.text}\n\n`;
      cue++;
    }
    yield chunk;
  }
}
