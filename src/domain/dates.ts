/**
 * Date/time helpers. Timestamps are ISO strings; invoice/calendar dates are
 * `YYYY-MM-DD`. Keep formatting helpers (month names, etc.) here rather than in
 * the template language.
 */

/** Current instant as an ISO 8601 timestamp, e.g. 2026-06-21T02:14:08.123Z. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Today as `YYYY-MM-DD` in UTC. */
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the string is a well-formed, real `YYYY-MM-DD` date. */
export function isValidDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  // Reject rollovers like 2026-02-30 that Date silently normalizes.
  return date.toISOString().slice(0, 10) === value;
}
