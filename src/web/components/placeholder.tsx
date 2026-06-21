import { PageHeader } from "./page-header.tsx";

/**
 * Temporary stub for sections that arrive in later build phases. Keeps the
 * primary navigation coherent without 404s while the foundation is in place.
 */
export function Placeholder({
  title,
  phase,
}: {
  title: string;
  phase: string;
}) {
  return (
    <div>
      <PageHeader title={title} />
      <div class="rounded-lg border border-dashed border-base-300 bg-base-100 p-10 text-center">
        <p class="text-sm text-base-content/60">
          This section arrives in {phase}.
        </p>
      </div>
    </div>
  );
}
