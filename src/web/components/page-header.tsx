import type { Child } from "hono/jsx";

export type PageHeaderProps = {
  title: string;
  description?: string;
  /** Action slot rendered on the right (buttons, links). */
  actions?: Child;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p class="mt-1 text-sm text-base-content/60">{description}</p>
        ) : null}
      </div>
      {actions ? <div class="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
