/**
 * Money is stored as integer minor units (e.g. pence) plus a currency code.
 * Never use floating point for amounts. Parsing/formatting lives here so the
 * rest of the app deals only in integers.
 */

/** Minor-unit fraction digits per currency. Default is 2. */
const FRACTION_DIGITS: Record<string, number> = {
  GBP: 2,
  USD: 2,
  EUR: 2,
  BRL: 2,
  JPY: 0,
};

/** Currencies offered in the UI. */
export const SUPPORTED_CURRENCIES = ["GBP", "USD", "EUR", "BRL"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function fractionDigits(currency: string): number {
  return FRACTION_DIGITS[currency.toUpperCase()] ?? 2;
}

/**
 * Parse a user-entered amount into integer minor units.
 * Accepts thousands separators and an optional decimal part, e.g.
 *   "4000", "4,000.00", "4000.5", "0.30".
 * Returns null when the input is not a valid amount. An empty/whitespace
 * string also returns null (callers treat that as "no value").
 */
export function parseMoneyToMinor(
  input: string,
  currency: string,
): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Strip thousands separators; reject anything that isn't digits + one dot.
  const normalized = trimmed.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const digits = fractionDigits(currency);
  const [whole = "", frac = ""] = normalized.split(".");
  if (frac.length > digits) return null; // more precision than the currency has

  const paddedFrac = frac.padEnd(digits, "0");
  const combined = digits === 0 ? whole : `${whole}${paddedFrac}`;
  const minor = Number.parseInt(combined, 10);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * Plain decimal string for editing inputs (no symbol, no grouping), e.g.
 *   minorToDecimalString(400050, "GBP") -> "4000.50".
 * Integer-safe (no float division).
 */
export function minorToDecimalString(minor: number, currency: string): string {
  const digits = fractionDigits(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  if (digits === 0) return `${negative ? "-" : ""}${abs}`;
  const padded = String(abs).padStart(digits + 1, "0");
  const whole = padded.slice(0, -digits);
  const frac = padded.slice(-digits);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Format integer minor units as a localized currency string, e.g.
 *   formatMoney(415000, "GBP") -> "£4,150.00".
 * Falls back to a plain grouped number + code for unknown currencies.
 */
export function formatMoney(
  minor: number,
  currency: string,
  locale = "en-GB",
): string {
  const digits = fractionDigits(currency);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value)} ${currency}`;
  }
}
