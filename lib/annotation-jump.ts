import type { AnnotationDTO } from "./dto";

/**
 * Annotations of one type that still sit on words, in recording order.
 * Orphans (no segment / no words) belong in the review tray, not this list.
 */
export function jumpableAnnotations(
  annotations: Iterable<AnnotationDTO>,
  type: string,
): AnnotationDTO[] {
  return [...annotations]
    .filter(
      (annotation) =>
        annotation.type === type &&
        annotation.status === "ACTIVE" &&
        annotation.segmentId !== null &&
        annotation.wordIds.length > 0,
    )
    .sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return a.surface.localeCompare(b.surface, "und");
    });
}
