/** Safe Content-Disposition for the original recording filename. */
export function contentDispositionAttachment(filename: string): string {
  const trimmed = filename.trim() || "recording";
  const ascii = trimmed.replace(/[^\w.\-() ]+/g, "_").slice(0, 180) || "recording";
  const encoded = encodeURIComponent(trimmed);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
