import type { InvoiceStatus } from "../../domain/invoice-status.ts";

/**
 * Commercial invoice status badge. Status values follow the lifecycle in
 * `domain/invoice-status.ts`: draft / issued / sent / paid / void. NFS-e linked
 * state is derived metadata, not a status, so it is rendered separately.
 */
export type { InvoiceStatus };

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "app-status-draft",
  issued: "app-status-issued",
  sent: "app-status-sent",
  paid: "app-status-paid",
  void: "app-status-void",
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  paid: "Paid",
  void: "Void",
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span class={`app-status ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
