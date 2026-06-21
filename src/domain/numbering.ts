/**
 * Per-client invoice number generation.
 *
 * Two concerns live here, both pure so they can be unit-tested without a DB:
 * - {@link periodKeyFor}: maps a reset period + invoice date to the bucket key
 *   the sequence is counted within (see spec §11 "Internal period keys").
 * - {@link renderNumberPattern}: interpolates a numbering pattern's `{TOKEN}`
 *   placeholders (single-brace; distinct from the `{{var}}` text templates that
 *   arrive in Phase 4).
 *
 * The actual sequence allocation (read/increment under a transaction) lives in
 * the invoices repository; this module only computes keys and strings.
 */

export type ResetPeriod = "never" | "yearly" | "monthly" | "daily";

const RESET_PERIODS: readonly ResetPeriod[] = [
  "never",
  "yearly",
  "monthly",
  "daily",
];

export function isResetPeriod(value: string): value is ResetPeriod {
  return (RESET_PERIODS as readonly string[]).includes(value);
}

/**
 * The bucket a sequence counts within. Derived from the invoice date (the date
 * shown on the PDF) so the period in the number matches the reset period:
 *   never   -> "all"
 *   yearly  -> "2026"
 *   monthly -> "2026-06"
 *   daily   -> "2026-06-20"
 * `invoiceDate` must be a valid `YYYY-MM-DD` string.
 */
export function periodKeyFor(period: ResetPeriod, invoiceDate: string): string {
  const [year, month, day] = invoiceDate.split("-");
  switch (period) {
    case "yearly":
      return year ?? invoiceDate;
    case "monthly":
      return `${year}-${month}`;
    case "daily":
      return `${year}-${month}-${day}`;
    case "never":
      return "all";
  }
}

export type NumberTokenContext = {
  clientCode: string;
  /** Invoice date as `YYYY-MM-DD`; supplies all date tokens. */
  invoiceDate: string;
  /** 1-based sequence number within the period. */
  seq: number;
};

/**
 * Interpolate a numbering pattern. Supported tokens (spec §11):
 *   {CLIENT_CODE} {YYYY} {YY} {MM} {DD} {YYYYMM} {SEQ} {SEQ:0N}
 * `{SEQ:0N}` zero-pads the sequence to N digits. Unknown tokens are left
 * verbatim (braces and all) so a typo is visible rather than silently dropped.
 */
export function renderNumberPattern(
  pattern: string,
  ctx: NumberTokenContext,
): string {
  const [year = "", month = "", day = ""] = ctx.invoiceDate.split("-");
  return pattern.replace(/\{([^}]+)\}/g, (whole, token: string) => {
    const seqMatch = /^SEQ(?::0?(\d+))?$/.exec(token);
    if (seqMatch) {
      const width = seqMatch[1] ? Number.parseInt(seqMatch[1], 10) : 0;
      return String(ctx.seq).padStart(width, "0");
    }
    switch (token) {
      case "CLIENT_CODE":
        return ctx.clientCode;
      case "YYYY":
        return year;
      case "YY":
        return year.slice(-2);
      case "MM":
        return month;
      case "DD":
        return day;
      case "YYYYMM":
        return `${year}${month}`;
      default:
        return whole;
    }
  });
}
