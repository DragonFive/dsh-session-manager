/**
 * Effective annotation defaults (display layer only).
 *
 * Every session counts as 待办 (todo) / 一般 (normal) until a human
 * annotation overrides it: the board groups, filters, quadrants, badges,
 * and quick edits all read these effective values. The sidecar stays
 * sparse — defaults are never written to disk; an annotation row only
 * appears once a human actually saves one.
 */

/** Must reference a status id of the (default) taxonomy. */
export const DEFAULT_STATUS_ID = "todo";

/** Must reference a priority id of the (default) taxonomy. */
export const DEFAULT_PRIORITY_ID = "normal";

function resolveDefaultId(fallbackId, entries) {
  if (entries?.some((entry) => entry?.id === fallbackId)) return fallbackId;
  return entries?.[0]?.id ?? fallbackId;
}

/**
 * The status a session effectively has: its own annotation's status when
 * annotated, otherwise the taxonomy's default (falls back to the first
 * status when a custom taxonomy dropped the default id).
 * @param {{ status?: string } | null} annotation
 * @param {{ statuses?: { id: string }[] } | null | undefined} taxonomy
 * @returns {string}
 */
export function effectiveStatusId(annotation, taxonomy) {
  if (annotation?.status !== undefined) return annotation.status;
  return resolveDefaultId(DEFAULT_STATUS_ID, taxonomy?.statuses);
}

/**
 * The priority a session effectively has (same rules as effectiveStatusId).
 * @param {{ priority?: string } | null} annotation
 * @param {{ priorities?: { id: string }[] } | null | undefined} taxonomy
 * @returns {string}
 */
export function effectivePriorityId(annotation, taxonomy) {
  if (annotation?.priority !== undefined) return annotation.priority;
  return resolveDefaultId(DEFAULT_PRIORITY_ID, taxonomy?.priorities);
}
