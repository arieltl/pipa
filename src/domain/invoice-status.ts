/**
 * Invoice commercial-status lifecycle.
 *
 * States: draft → issued → sent → paid, plus void. The `draft ↔ issued`
 * barrier is special: crossing it has side effects (archiving the PDF and
 * locking/unlocking document editing), so it only happens through the dedicated
 * "Issue" / "Revert to draft" actions — never the generic status control. The
 * remaining states (issued/sent/paid/void) interchange freely for power users.
 *
 * "PDF archived" and "NFS-e linked" remain derived facts (related rows), not
 * statuses (architecture plan).
 */
export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "sent",
  "paid",
  "void",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses that contribute to an amount still expected from a client. */
export const OUTSTANDING_INVOICE_STATUSES = [
  "draft",
  "issued",
  "sent",
] as const satisfies readonly InvoiceStatus[];

/** The loose cluster whose members interchange via the manual status control. */
const MANUAL_STATUSES: InvoiceStatus[] = ["issued", "sent", "paid", "void"];

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

/** The invoice document (line items + meta) is only editable while drafting. */
export function isDocumentEditable(status: string): boolean {
  return status === "draft";
}

/** Whether an invoice contributes to outstanding client balances. */
export function isOutstandingInvoice(status: string): boolean {
  return (OUTSTANDING_INVOICE_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a manual status change is allowed via the generic status control.
 * Excludes anything touching `draft`: issuing and reverting are dedicated
 * actions because they have side effects.
 */
export function canManuallyTransition(from: string, to: string): boolean {
  if (from === to) return false;
  return (
    (MANUAL_STATUSES as string[]).includes(from) &&
    (MANUAL_STATUSES as string[]).includes(to)
  );
}

/** Statuses the manual control offers for the current state (incl. current). */
export function manualStatusOptions(from: string): InvoiceStatus[] {
  return MANUAL_STATUSES.filter((s) => s === from || canManuallyTransition(from, s));
}
