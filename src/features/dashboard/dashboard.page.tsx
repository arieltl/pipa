import { PageHeader } from "../../web/components/page-header.tsx";

/**
 * Dashboard landing page. For now it confirms the foundation is wired up and
 * outlines the monthly workflow; recent-invoice cards arrive with the invoice
 * core (Phase 3).
 */
export function DashboardPage() {
  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Your monthly invoicing workflow at a glance."
        actions={
          <a href="/invoices/new" class="btn btn-primary btn-sm">
            New invoice
          </a>
        }
      />

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <WorkflowCard
          step="1"
          title="Create an invoice"
          body="Pick a client and the invoice date shown on the PDF. The number is allocated per client."
        />
        <WorkflowCard
          step="2"
          title="Review line items"
          body="The fixed monthly service item is added by default and stays editable per invoice."
        />
        <WorkflowCard
          step="3"
          title="Generate nota fiscal text"
          body="Produce copyable NFS-e description text from the client template, then tweak as needed."
        />
        <WorkflowCard
          step="4"
          title="Download the PDF"
          body="Render the commercial invoice PDF and send it to your client."
        />
        <WorkflowCard
          step="5"
          title="Link the nota fiscal"
          body="After issuing the NFS-e, link its number, verification URL, and PDF/XML files."
        />
        <WorkflowCard
          step="6"
          title="Track status"
          body="Move invoices through draft, sent, and paid as the month progresses."
        />
      </div>

      <div class="mt-8 rounded-lg border border-dashed border-base-300 bg-base-100 p-8 text-center">
        <p class="text-sm text-base-content/60">
          No invoices yet. Recent invoices will appear here once the invoice
          core is built.
        </p>
      </div>
    </div>
  );
}

function WorkflowCard({
  step,
  title,
  body,
}: {
  step: string;
  title: string;
  body: string;
}) {
  return (
    <div class="rounded-lg border border-base-300 bg-base-100 p-4">
      <div class="flex items-center gap-2">
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {step}
        </span>
        <h2 class="text-sm font-semibold">{title}</h2>
      </div>
      <p class="mt-2 text-sm text-base-content/60">{body}</p>
    </div>
  );
}
