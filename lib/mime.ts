/**
 * Container detection by magic bytes (§13). The file extension is never
 * trusted; the sniffed container decides whether an upload is accepted and
 * whether it is treated as audio or video.
 */

export type Container =
  | "mp3"
  | "wav"
  | "m4a"
  | "flac"
  | "ogg"
  | "aac"
  | "aiff"
  | "opus"
  | "3gp"
  | "mp4"
  | "mov"
  | "webm"
  | "mkv";

export interface Sniffed {
  container: Container;
  mimeType: string;
  kind: "AUDIO" | "VIDEO";
}

export const ACCEPTED_EXTENSIONS = [
  "mp3",
  "wav",
  "m4a",
  "flac",
  "ogg",
  "aac",
  "aiff",
  "aif",
  "opus",
  "3gp",
  "weba",
  "mp4",
  "mov",
  "webm",
  "mkv",
] as const;

export const ACCEPTED_DESCRIPTION =
  "mp3, wav, m4a, flac, ogg, aac, aiff, opus, 3gp, weba, mp4, mov, webm or mkv";

/** File-picker filter: wildcards so phones show both audio and video, plus explicit extensions. */
export const FILE_ACCEPT = [
  "audio/*",
  "video/*",
  ...ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`),
].join(",");

/** 10 GB / 4 hours (§6.1; raised from 2 GB for pilot field recordings — see DECISIONS.md) */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
export const MAX_UPLOAD_GB = 10;
export const MAX_DURATION_SECONDS = 4 * 60 * 60;

/** Local disk: one POST below this size (faster than tus through a tunnel). */
export const LOCAL_DIRECT_UPLOAD_MAX_BYTES = 512 * 1024 * 1024;
/** Files at or below this size upload to Supabase when STORAGE_BACKEND=hybrid. */
export const HYBRID_SUPABASE_MAX_BYTES = 100 * 1024 * 1024;

/** Enough bytes for every signature below, including the EBML DocType. */
export const SNIFF_BYTES = 4096;

function ascii(buf: Buffer, from: number, length: number): string {
  return buf.subarray(from, from + length).toString("latin1");
}

function ebmlKind(head: string): "AUDIO" | "VIDEO" {
  if (/V_(VP8|VP9|AV1|MPEG4|MS|THEORA)/.test(head)) return "VIDEO";
  if (/A_(OPUS|VORBIS|MPEG|FLAC|PCM)/.test(head)) return "AUDIO";
  return "VIDEO";
}

/** True when the stored bytes are a web page (login wall, 404, tunnel error). */
export function sniffLooksLikeHtml(buf: Buffer): boolean {
  const start = buf.subarray(0, 80).toString("latin1").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html") || start.startsWith("<head");
}

export function unrecognizedMediaMessage(head: Buffer): string {
  if (sniffLooksLikeHtml(head)) {
    return "The file that arrived is a web page, not a recording. That usually means a login, download, or error page was saved as .mp3. Upload the original audio or video file.";
  }
  return `The uploaded bytes are not a media file Lexa can read. It accepts ${ACCEPTED_DESCRIPTION}.`;
}

export function sniffContainer(buf: Buffer): Sniffed | null {
  if (buf.length < 12) return null;

  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 4) === "WAVE") {
    return { container: "wav", mimeType: "audio/wav", kind: "AUDIO" };
  }
  if (ascii(buf, 0, 4) === "FORM") {
    const formType = ascii(buf, 8, 4);
    if (formType === "AIFF" || formType === "AIFC") {
      return { container: "aiff", mimeType: "audio/aiff", kind: "AUDIO" };
    }
  }
  if (ascii(buf, 0, 4) === "fLaC") {
    return { container: "flac", mimeType: "audio/flac", kind: "AUDIO" };
  }
  if (ascii(buf, 0, 4) === "OggS") {
    return { container: "ogg", mimeType: "audio/ogg", kind: "AUDIO" };
  }
  if (ascii(buf, 0, 3) === "ID3") {
    return { container: "mp3", mimeType: "audio/mpeg", kind: "AUDIO" };
  }

  // EBML — Matroska or WebM
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    const head = buf.subarray(0, Math.min(buf.length, 1024)).toString("latin1");
    if (head.includes("webm")) {
      const kind = ebmlKind(head);
      return {
        container: "webm",
        mimeType: kind === "AUDIO" ? "audio/webm" : "video/webm",
        kind,
      };
    }
    const kind = ebmlKind(head);
    return {
      container: "mkv",
      mimeType: kind === "AUDIO" ? "audio/x-matroska" : "video/x-matroska",
      kind,
    };
  }

  // ISO base media — mp4 / m4a / mov / 3gp
  if (ascii(buf, 4, 4) === "ftyp") {
    const brand = ascii(buf, 8, 4).trim().toLowerCase();
    if (brand.startsWith("m4a") || brand === "m4b" || brand === "f4a") {
      return { container: "m4a", mimeType: "audio/mp4", kind: "AUDIO" };
    }
    if (brand.startsWith("3gp") || brand === "3g2a") {
      return { container: "3gp", mimeType: "audio/3gpp", kind: "AUDIO" };
    }
    if (brand === "qt") {
      return { container: "mov", mimeType: "video/quicktime", kind: "VIDEO" };
    }
    return { container: "mp4", mimeType: "video/mp4", kind: "VIDEO" };
  }

  // ADTS AAC
  if (buf[0] === 0xff && (buf[1] === 0xf1 || buf[1] === 0xf9)) {
    return { container: "aac", mimeType: "audio/aac", kind: "AUDIO" };
  }

  // Bare MPEG audio frame (mp3 without an ID3 header)
  for (let i = 0; i < Math.min(buf.length - 1, 1024); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const layer = (buf[i + 1] >> 1) & 0x03;
      if (layer !== 0) {
        return { container: "mp3", mimeType: "audio/mpeg", kind: "AUDIO" };
      }
    }
  }

  return null;
}

export function describeGiven(filename: string, declaredMime: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()! : "no extension";
  return `${filename} (.${ext}, declared as ${declaredMime || "an unknown type"})`;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

/** Best-effort kind from the filename before bytes are sniffed. */
export function inferMediaKind(filename: string): "AUDIO" | "VIDEO" {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  return VIDEO_EXTENSIONS.has(ext) ? "VIDEO" : "AUDIO";
}
