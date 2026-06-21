import type { Child } from "hono/jsx";

export type PageHeaderProps = {
  title: string;
  description?: string;
  /** Action slot rendered on the right (buttons, links). */
  actions?: Child;
};

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-base-300/70 pb-5">
      <div class="max-w-2xl">
        <h1 class="text-3xl font-semibold tracking-tight text-base-content">
          {title}
        </h1>
        {description ? (
          <p class="mt-2 text-sm leading-6 text-base-content/62">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div class="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
