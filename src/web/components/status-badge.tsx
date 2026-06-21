/**
 * Commercial invoice status badge. Status values follow the architecture plan:
 * draft / sent / paid / void. NFS-e linked state is derived metadata, not a
 * status, so it is rendered separately where needed.
 */
export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

const STATUS_CLASS: Record<InvoiceStatus, string> = {
  draft: "app-status-draft",
  sent: "app-status-sent",
  paid: "app-status-paid",
  void: "app-status-void",
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
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
