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

const MONTH_NAMES_EN = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_NAMES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** 1-based month number from a `YYYY-MM-DD` date, or NaN if malformed. */
function monthNumber(date: string): number {
  return Number.parseInt(date.split("-")[1] ?? "", 10);
}

/** English month name for a `YYYY-MM-DD` date, e.g. "June". Empty if invalid. */
export function monthNameEn(date: string): string {
  return MONTH_NAMES_EN[monthNumber(date) - 1] ?? "";
}

/** Portuguese month name for a `YYYY-MM-DD` date, e.g. "junho". */
export function monthNamePt(date: string): string {
  return MONTH_NAMES_PT[monthNumber(date) - 1] ?? "";
}

/**
 * Reformat a `YYYY-MM-DD` date to Brazilian `DD/MM/YYYY` for nota fiscal text
 * (spec §13). Returns the input unchanged if it is not a well-formed date.
 */
export function formatDateBr(date: string): string {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return `${day}/${month}/${year}`;
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
