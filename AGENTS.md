# AGENTS.md

## Project Overview

Invoice is a lightweight, self-hosted web app for freelancers and small service businesses with low-volume, repeatable invoicing. It creates commercial invoice PDFs, editable generated text, and configurable supporting records/files. Its Brazilian origins are context, not a restriction on the product: explain country-specific terminology in public docs and prefer general workflows.

Read these docs for deeper context before broad architecture changes:

- `docs/design.md`: current architecture and tradeoffs.
- `docs/user-guide.md` and `pdf_template_author_reference.md`: current workflows and template contracts.
- `docs/self-hosting.md` and `docs/desktop.md`: supported deployment and local-use boundaries.
- `docs/roadmap.md`: maintainer-approved future direction, not an implementation checklist.

Historical specs/plans and release decision notes live in gitignored `.personal/` when present. They are local maintainer documents, not public dependencies or proof of current behavior. Do not force-add them, link to them from public docs, or add new roadmap commitments without maintainer approval.

## Maintaining This File

- Keep this file concise and project-specific. Do not add generic framework best practices the agent can infer from docs or the codebase.
- Prefer pointers to existing files over copying long explanations here.
- Add recurring agent mistakes, non-obvious project decisions, and exact commands once they become durable.
- Periodically prune stale guidance. A bloated or outdated agent file is worse than a short one.
- If guidance becomes long, task-specific, or path-specific, move it to a scoped rule/skill/doc and link to it here only if agents need the pointer often.

## Core Stack

- Runtime/server: Bun + Hono.
- UI: server-rendered Hono JSX + htmx.
- Local UI behavior: Alpine.js for dropdowns, tabs, popovers, disclosure widgets, copy feedback, and other client-only state.
- Styling: Tailwind CSS v4.
- Components: daisyUI only for simple primitives; use HyperUI and Pines/Pinemix as copy-paste inspiration for larger composed components.
- Database: SQLite with Drizzle ORM and Drizzle Kit migrations.
- SQLite driver: `bun:sqlite` through `drizzle-orm/bun-sqlite`.
- Validation: Zod schemas at route boundaries via `@hono/zod-validator`; keep raw payloads out of services.
- PDF: built-in `@react-pdf/renderer`; optional Liquid HTML templates through private Gotenberg.
- Files: append-only local filesystem storage under `DATA_DIR`.
- Deploy: prebuilt GHCR image through `compose.yml`; `docker-compose.yml` is the optional source-build alternative. `compose.gotenberg.yml` adds the renderer service.

Keep Chromium in optional Gotenberg, not inside the application. Avoid adding Puppeteer, MinIO/S3, Postgres, Prisma, or a full SPA unless the user explicitly changes direction.

## Architecture Rules

- Keep business rules out of route handlers.
- Use feature folders under `src/features/` with `*.routes.tsx`, `*.service.ts`, `*.repository.ts`, and feature components.
- Put reusable pure domain logic in `src/domain/`.
- Put database schema/client/migrations support in `src/db/`.
- Keep React PDF components separate under `src/pdf/`; do not reuse web UI components inside PDFs.
- The global JSX runtime is `hono/jsx`. React PDF TSX components must start with `/** @jsxImportSource react */`; do not apply React's runtime to web UI components.
- Store money as integer minor units plus currency, never floating point.
- Store invoice dates as `YYYY-MM-DD`; store timestamps as ISO strings.
- Enable SQLite foreign keys; prefer WAL mode for normal app use.
- Keep generated text editable. Templates are helpers, not authority.
- Client defaults are copied into invoices/items at creation time and must not mutate historical invoices.
- PDF revisions and invoice presentation snapshots preserve historical documents. A renderer failure must not silently select another engine or advance invoice status.
- Text generators already have saved editable invoice fields. A separate generator-to-record linking feature was explicitly declined; do not implement old target/apply proposals.

## Domain Invariants

- `invoice_date` is the date shown on the PDF.
- `created_at` is the actual database/app creation timestamp.
- Invoice totals come from invoice item values.
- Per-client invoice numbering must be transactional and unique.
- Invoice status lifecycle (`src/domain/invoice-status.ts`): `draft → issued → sent → paid`, plus `void`. PDF-archived and NFS-e-linked stay derived facts (related rows), not statuses.
- The `draft ↔ issued` barrier has side effects (issuing archives the PDF and locks the document; reverting unlocks it), so it only crosses via the dedicated `issueInvoice`/`revertToDraft` actions — never the generic status control. The other statuses interchange freely.
- The invoice document (line items + meta) is editable only while `draft`; enforce with `isDocumentEditable` in the service, not just the UI. Notes, generated text, and supporting records stay editable in any status.
- Files are append-only by default: write temp file, hash, move atomically, insert metadata, supersede instead of overwrite.
- Missing required record attachments show an incomplete warning, not an invoice-issuance gate. Legacy NFS-e compatibility data must not be removed without a separately verified migration.
- Dashboard outstanding totals include draft, issued, and sent invoice item totals; exclude paid/void. Aggregate items per invoice before grouping clients, preserving invoice counts and preventing cross-client leakage.

## UI And htmx

- Use htmx for server-backed validation, mutation, persistence, recalculation, and HTML fragment replacement.
- Use Alpine for purely local behavior. Do not use htmx for every tiny interaction.
- Full page requests should render through the shared layout. htmx requests should return fragments.
- Validation and error responses should be swappable HTML fragments, especially `422` form responses.
- Avoid relying on implicit htmx attribute inheritance. Prefer explicit `hx-target`, `hx-swap`, `hx-include`, and `hx-confirm` on the triggering element.
- Avoid htmx 2 patterns that complicate htmx 4 migration: no `hx-vars`, `hx-params`, `hx-ext`, `hx-disinherit`, `hx-inherit`, `hx-request`, or `hx-history`.
- Use `hx-vals` instead of `hx-vars`.
- Use `hx-sync` instead of `hx-trigger` queue modifiers.
- Keep out-of-band swaps independent from the main swap.
- Centralize custom htmx event hooks in a small client script if event hooks are needed.

## Styling And Components

- Start with quiet operational UI: dashboard, dense tables where useful, clear workflow actions, and compact settings forms.
- Use daisyUI for repeated primitives such as buttons, inputs, selects, badges, tables, modals, tabs, and alerts.
- Use HyperUI and Pines/Pinemix examples for larger patterns, then adapt them into local TSX components.
- Normalize copied components to the app theme: spacing, radius, colors, focus states, typography, and Alpine behavior.
- Once a UI pattern appears twice, wrap it in a local component under `src/web/components` or the relevant feature `components/` folder.

## Commands

Use scripts from `package.json`; CI uses Bun 1.3.14.

- Install dependencies: `bun install --frozen-lockfile`.
- Start dev server: `bun run dev`.
- Build assets and run tests: `bun run test`. After assets are built, `bun run test:unit` runs the suite alone. Typecheck: `bun run typecheck`.
- Build the Linux x64 executable: `bun run build:binary`. Do not claim native Windows/macOS builds or downloadable release binaries that the workflow does not publish.
- Apply migrations: `bun run db:migrate` (also runs at app startup). Generate schema migrations: `bun run db:generate`; review and test them, never substitute `drizzle-kit push`.
- Demo data: `bun run scripts/seed-demo.ts` uses isolated `data/docs-demo/`. See `docs/demo.md`; never replace the user's database for screenshots. Test isolation is configured in `bunfig.toml` / `test/preload.ts`.

## Testing Priorities

Use `bun:test` for domain and route tests.

High-value coverage:

- Template interpolation and unknown-variable handling.
- Filename sanitization and path traversal prevention.
- Money parsing/formatting as integer minor units.
- Invoice total calculation.
- Per-client sequence allocation and manual number collision checks.
- Client default changes do not alter existing invoices/items.
- File storage append-only and supersede behavior.
- htmx form validation fragments for failed submissions.

## Security And Data Safety

- No built-in authentication is intentional for beta; it is on the future roadmap. Direct Bun/executable startup binds `127.0.0.1` by default; `--host` overrides `INVOICE_HOST`. Docker must listen on `0.0.0.0` internally; Compose publishes to host loopback by default via `INVOICE_BIND_ADDRESS`. Do not confuse the container listener with the host-published interface.
- Keep `.personal/`, real databases, uploads, and secrets out of Git and Docker build contexts. Screenshots must use reviewed fictional demo data.
- Use explicit DATA_DIR, DB_PATH, FILES_DIR, and TMP_DIR overrides for isolated runs; inherited `.env` values must not redirect tests/demos into user data.
- HTTP bodies are capped at 20 MiB and supporting-record attachments at 10 MiB. Declared MIME validation is not content inspection or malware scanning. Cross-site request rejection is not authentication.
- Do not overwrite official/generated/archive files.
- Do not trust uploaded filenames for stored paths.
- Validate all form inputs at route boundaries with Zod.
- Keep raw form payloads out of services; services should receive typed inputs.
- Use local filesystem storage, not S3/MinIO, for MVP.
- Preserve user data and existing changes. Never run destructive filesystem or git commands unless explicitly requested.
- Do not push release tags, dispatch the publishing workflow, or create even draft GitHub releases without explicit release authorization. The maintainer changes repository visibility manually. Ordinary branch CI is non-publishing.
