# AGENTS.md

## Project Overview

Build a lightweight self-hosted invoice generator for a Brazilian PJ developer workflow. The app creates commercial invoices for foreign clients, generates editable nota fiscal/NFS-e description text, renders invoice PDFs, and later links NFS-e metadata/files. Keep the app simple, local-first, Docker Compose friendly, and low-RAM.

Read these docs for deeper context before broad architecture changes:

- `self_hosted_invoice_generator_spec.md`: product requirements and domain details.
- `invoice_app_architecture_plan.md`: implementation architecture and current decisions.

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
- PDF: server-side `@react-pdf/renderer`.
- Files: append-only local filesystem storage under `DATA_DIR`.
- Deploy: single Docker container via Docker Compose.

Avoid adding Chromium/Puppeteer, MinIO/S3, Postgres, Prisma, or a full SPA unless the user explicitly changes direction.

## Architecture Rules

- Keep business rules out of route handlers.
- Use feature folders under `src/features/` with `*.routes.tsx`, `*.service.ts`, `*.repository.ts`, and feature components.
- Put reusable pure domain logic in `src/domain/`.
- Put database schema/client/migrations support in `src/db/`.
- Keep React PDF components separate under `src/pdf/`; do not reuse web UI components inside PDFs.
- Store money as integer minor units plus currency, never floating point.
- Store invoice dates as `YYYY-MM-DD`; store timestamps as ISO strings.
- Enable SQLite foreign keys; prefer WAL mode for normal app use.
- Keep generated text editable. Templates are helpers, not authority.
- Client defaults are copied into invoices/items at creation time and must not mutate historical invoices.

## Domain Invariants

- `invoice_date` is the date shown on the PDF.
- `created_at` is the actual database/app creation timestamp.
- Invoice totals come from invoice item values.
- Per-client invoice numbering must be transactional and unique.
- Prefer commercial invoice status values `draft`, `sent`, `paid`, `void`; derive NFS-e linked state from related rows.
- Files are append-only by default: write temp file, hash, move atomically, insert metadata, supersede instead of overwrite.

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

The app may not be scaffolded yet. After `package.json` exists, prefer scripts from that file. Expected command shape:

- Install dependencies: `bun install`.
- Start dev server: `bun run dev`.
- Run tests: `bun test` or `bun run test`.
- Run type/lint/check scripts if present before finishing substantial changes.
- Run Drizzle migration scripts from `package.json` once they exist; do not invent database commands without checking scripts first.

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

- Do not overwrite official/generated/archive files.
- Do not trust uploaded filenames for stored paths.
- Validate all form inputs at route boundaries with Zod.
- Keep raw form payloads out of services; services should receive typed inputs.
- Use local filesystem storage, not S3/MinIO, for MVP.
- Preserve user data and existing changes. Never run destructive filesystem or git commands unless explicitly requested.

