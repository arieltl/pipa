# Self-Hosted Invoice App Architecture Plan

This plan turns `self_hosted_invoice_generator_spec.md` into an implementation-oriented architecture for a lightweight self-hosted invoice generator. The original spec remains the product source of truth; this document focuses on how to build it.

The architecture suggestions in the spec are good defaults, but not sacred. The guiding constraint is: keep the app boring, local, cheap to run, easy to inspect, and pleasant to maintain.

## Stack Decision

Use this stack for the MVP:

```text
Runtime: Bun
Server: Hono
UI: Hono server-rendered JSX + htmx
Small client-side behavior: Alpine.js only where it clearly reduces friction
CSS: Tailwind CSS v4
Component primitives: daisyUI, unless it starts fighting the invoice workflow
Database: SQLite
DB layer: Drizzle ORM + Drizzle Kit migrations
SQLite driver: bun:sqlite through drizzle-orm/bun-sqlite
Validation: Zod schemas, wired at route boundaries via @hono/zod-validator
PDF: renderer registry; @react-pdf/renderer always available, optional HTML/Liquid through Gotenberg
Files: local filesystem under DATA_DIR
Deployment: single app container by default; optional private Gotenberg container through a Compose override
```

Why this is still the right shape:

- Hono officially supports Bun, `bun run --hot`, static file serving, and server-side JSX rendering.
- Hono JSX is a good fit for htmx because route handlers can return complete pages or fragments.
- htmx 2.x is current and keeps the app mostly server-driven; responses should usually be HTML, not JSON.
- Tailwind CSS v4 and daisyUI are already close to the older CRM experiment and keep styling fast without building a custom design system.
- Drizzle currently has first-class Bun SQLite support, including the `drizzle-orm/bun-sqlite` adapter and Drizzle Kit migrations.
- `@react-pdf/renderer` supports Node/server rendering APIs; we should keep PDF components separate from web UI components.
- HTML templates use the same constrained Liquid document model as named client
  text generators. Gotenberg is optional and is never a fallback target.

Checked docs:

- Hono Bun docs: https://hono.dev/docs/getting-started/bun
- Hono JSX docs: https://hono.dev/docs/guides/jsx
- htmx docs: https://htmx.org/docs/
- Drizzle Bun SQLite docs: https://orm.drizzle.team/docs/get-started/bun-sqlite-new
- Drizzle Bun SQLite connection docs: https://orm.drizzle.team/docs/connect-bun-sqlite
- Tailwind CLI docs: https://tailwindcss.com/docs/installation/tailwind-cli
- daisyUI Bun docs: https://daisyui.com/docs/install/bun/
- Bun SQLite docs: https://bun.sh/docs/runtime/sqlite
- React PDF Node docs: https://react-pdf.org/node

## Inspiration From The Older CRM Project

The older project at `C:\Users\Ariel\Developer\CRM` has a useful shape:

```text
src/
  index.ts
  layout.tsx
  renderer.tsx
  home/
    home.pages.ts
    home.routes.ts
    pages/
  contact/
    contacts.routes.tsx
    contact.service.ts
    models/
    components/
  chat/
    chat.routes.tsx
    chat.service.ts
    models/
    pages/
    components/
assets/
  main.css
```

Things worth keeping:

- Feature folders are easy to navigate.
- Route modules own their own htmx fragments.
- A layout renderer wraps full page responses.
- A small htmx-aware renderer can skip the layout for `HX-Request: true`.
- Tailwind plus daisyUI works well for quick, readable UI.

Things to adjust:

- Use `src/index.tsx` if JSX appears in the entrypoint, matching current Hono JSX guidance.
- Keep demo delays and fake data out of this app.
- Vendor htmx and Alpine locally for production instead of depending on CDN scripts.
- Split feature routes from feature services, but add an explicit domain layer for invoice behavior that must stay stable.
- Add a real database layer from the start.

## Architectural Shape

Use a layered feature-first structure:

```text
src/
  index.tsx
  app.ts

  config/
    env.ts
    paths.ts

  web/
    layout.tsx
    renderer.tsx
    components/
      buttons.tsx
      forms.tsx
      money.tsx
      status-badge.tsx

  features/
    dashboard/
      dashboard.routes.tsx
      dashboard.page.tsx

    clients/
      clients.routes.tsx
      clients.service.ts
      clients.repository.ts
      clients.schema.ts
      components/

    invoices/
      invoices.routes.tsx
      invoices.service.ts
      invoices.repository.ts
      invoices.schema.ts
      pages/
      components/

    numbering/
      numbering.service.ts
      numbering.repository.ts

    nfse/
      nfse.routes.tsx
      nfse.service.ts
      nfse.repository.ts
      components/

    files/
      files.routes.tsx
      files.service.ts
      files.repository.ts
      local-file-store.ts

    settings/
      settings.routes.tsx
      settings.service.ts
      settings.repository.ts

  domain/
    dates.ts
    filename-template.ts
    invoice-number.ts
    invoice-status.ts
    invoice-totals.ts
    money.ts
    template-engine.ts

  db/
    client.ts
    schema.ts
    migrate.ts

  pdf/
    invoice-pdf.tsx
    invoice-pdf-view-model.ts
    render-invoice-pdf.ts

  public/
    htmx.min.js
    alpine.min.js
```

At the project root:

```text
drizzle/
  migrations and snapshots
assets/
  main.css
drizzle.config.ts
package.json
tsconfig.json
Dockerfile
docker-compose.yml
```

This structure borrows the older CRM's feature-folder ergonomics while adding the missing pieces for persistence, files, PDF generation, and durable domain behavior.

## Request And Rendering Model

Use Hono as the only web server.

Full page requests:

```text
GET /invoices/123 -> route loads data -> c.render(<InvoiceDetailPage />)
```

htmx fragment requests:

```text
POST /invoices/123/items -> route validates form -> service mutates -> c.html(<InvoiceItemsPanel />)
```

The renderer should detect `HX-Request: true` and return only the fragment, following the older CRM pattern. Normal requests get the full layout.

Recommended route style:

- `*.routes.tsx` handles HTTP, validation, status codes, redirects, and fragment selection.
- `*.service.ts` handles workflow orchestration.
- `*.repository.ts` handles Drizzle queries.
- `domain/*.ts` handles pure rules and calculations.

Avoid returning JSON for normal UI flows. Use JSON only for future API endpoints or machine-facing utilities.

## Frontend Behavior

Use htmx for:

- Create/edit/delete item forms.
- Inline invoice status changes.
- Search/filter lists.
- Regenerating nota fiscal description text.
- Upload panels.
- Modal form submission.
- Refreshing totals after item changes.

Use Alpine only for:

- Dropdowns, menus, popovers, and simple disclosure widgets.
- Local disclosure state.
- Copy-to-clipboard feedback.
- Lightweight tabs or dropdown state where htmx would be awkward.
- Client-only preview toggles.

Do not use htmx for every tiny interaction. If the behavior is purely local and does not need fresh server data, Alpine is the better tool. htmx should be reserved for interactions where the server needs to validate, mutate, recalculate, persist, or return updated HTML.

Do not build a SPA. The app should still work as a mostly normal server-rendered app.

Production asset rule:

- Install or vendor htmx and Alpine locally.
- Serve them from `/public`.
- Avoid CDN runtime dependencies in the self-hosted Docker setup.

## htmx 4 Readiness

htmx 4 is still under construction, but its migration guide already shows enough direction that we should avoid htmx 2 patterns that will be painful to unwind later.

Migration reference: https://four.htmx.org/docs#migration

Use htmx in a style that is close to htmx 4 semantics:

- Do not rely on implicit attribute inheritance. Prefer putting `hx-target`, `hx-swap`, `hx-include`, `hx-confirm`, and related attributes directly on the element that triggers the request. If inheritance is genuinely useful after htmx 4 lands, use explicit inherited attributes such as `hx-target:inherited` or the JSX-compatible meta-character equivalent.
- If we adopt htmx 4 beta or htmx 4 final in TSX, consider setting `htmx.config.metaCharacter = "-"` so JSX can use attributes like `hx-target-inherited` instead of colon-style names like `hx-target:inherited`.
- Design validation and error responses as swappable HTML fragments. htmx 4 swaps `4xx` and `5xx` responses by default, so a `422` form response should return markup that can safely replace the configured target.
- Avoid `hx-trigger` queue modifiers such as `queue:all`. Use `hx-sync` for request synchronization and queueing behavior.
- Avoid removed/deprecated attributes: `hx-vars`, `hx-params`, `hx-prompt`, `hx-ext`, `hx-disinherit`, `hx-inherit`, `hx-request`, and `hx-history`.
- Use `hx-vals` instead of `hx-vars` when extra request values are needed.
- Do not use `hx-disable` for "ignore this subtree" semantics. In htmx 4 that role becomes `hx-ignore`; keep any ignore/disable behavior isolated behind local helpers so the rename is easy.
- Do not write custom JavaScript against XHR-specific htmx events. htmx 4 uses `fetch()`, and XHR events are removed.
- Prefer native DOM APIs over htmx helper methods that are removed in htmx 4. Use `element.classList`, `element.closest`, `element.remove`, and `removeEventListener` directly.
- Avoid response headers removed in htmx 4, especially `HX-Trigger-After-Swap` and `HX-Trigger-After-Settle`; prefer `HX-Trigger` or local JavaScript hooks.
- Keep out-of-band swaps independent from the main swap. htmx 4 changes OOB ordering, so a fragment should not depend on OOB content being swapped first.
- Do not overuse htmx events. When event hooks are needed, isolate event names in one small client script so htmx 4 event renames are centralized.
- Add an eventual upgrade check script once htmx 4 is closer to final: `npx htmx.org@next upgrade-check -- ./src`.

For the MVP, use the stable htmx release unless htmx 4 has reached a comfortable final release by implementation time. The code style above should make either path easier.

## Styling

Use Tailwind CSS v4 with a mixed component strategy.

Useful component references:

- daisyUI: https://daisyui.com/
- HyperUI: https://www.hyperui.dev/
- Pines: https://devdojo.com/pines

Recommended hierarchy:

1. Use daisyUI mostly for simple low-level primitives: buttons, inputs, selects, checkboxes, toggles, badges, alerts, modals, tables, tabs, and basic layout affordances. daisyUI is helpful, but not critical to the app architecture.
2. Use copy-paste Tailwind component libraries such as HyperUI and Pines/Pinemix as inspiration for bigger composed components: application shells, invoice summary layouts, empty states, settings sections, dropdown menus, command/action menus, and polished form groups.
3. Treat copied components as starting points, not dependencies. Adapt them into local app components under `src/web/components` or feature `components/` folders instead of scattering pasted markup everywhere.
4. Use Alpine with copied interactive components when behavior is local. Pines-style components are especially relevant here because they commonly pair Alpine behavior with Tailwind markup.
5. It is fine to adapt copied HyperUI/Pines-style components to use daisyUI primitive classes where that improves consistency. Because they are copy-paste components, we can rewrite their button/input/badge pieces to match the app theme.
6. Avoid mixing multiple visual languages on the same screen. If a copied component comes in, normalize spacing, radius, colors, focus states, and typography to the app theme.

The practical default is: Tailwind as the base, daisyUI for repeated primitives, HyperUI/Pines-style examples for higher-level patterns, Alpine for local behavior, and local wrapper components once the same pattern appears twice.

Start with quiet operational UI rather than a marketing page:

- Dashboard as the first screen.
- Left navigation or compact top navigation.
- Dense invoice/client tables where useful.
- Clear action buttons for monthly workflow.
- Badges for `draft`, `sent`, `nfse_linked`, `paid`, `void`.

Suggested CSS entry:

```css
@import "tailwindcss";
@plugin "daisyui";
```

Use daisyUI for form controls, buttons, tables, modals, badges, and alerts. Keep custom CSS small and reserved for htmx indicators, layout fixes, and PDF-unrelated app polish.

## Database Plan

Use SQLite in `/data/app.db` for production and a local development file for dev.

Use Drizzle schema files and Drizzle Kit generated migrations. Do not rely on `push` beyond early throwaway prototyping.

Initial tables:

```text
issuer_settings
clients
numbering_profiles
invoice_number_sequences
invoices
invoice_items
nota_fiscal_links
files
invoice_files
```

Optional after MVP:

```text
expense_attachments
audit_events
saved_filters
```

Important SQLite choices:

- Store money as integer minor units, not floating point.
- Store dates as ISO text: `YYYY-MM-DD` for invoice dates, ISO timestamps for audit timestamps.
- Enable foreign keys on connection.
- Prefer WAL mode for normal app use.
- Keep uniqueness constraints in the database, especially invoice numbers and sequence rows.

Recommended money fields:

```text
amount_minor integer not null
currency text not null
```

Do not store invoice totals as the only source of truth. Either calculate totals from items when reading, or store a cached `total_minor` that services update transactionally. For MVP, prefer calculating from `invoice_items`; add cached totals only if the UI gets annoying or queries become repetitive.

## Invoice Numbering

This is a domain service, not route code.

Inputs:

```text
client
numbering_profile
invoice_date
optional manual override
```

Transactional flow:

```text
BEGIN
  validate client and profile
  if manual override:
    validate uniqueness
    insert invoice
  else:
    find or create sequence row for client/profile/period
    generate invoice number from pattern
    insert invoice
    increment sequence
COMMIT
```

Recommended uniqueness:

```text
UNIQUE(invoice_number)
UNIQUE(client_id, invoice_number)
UNIQUE(client_id, numbering_profile_id, period_key)
```

The global uniqueness may technically duplicate the per-client uniqueness, but it prevents confusing PDFs and filenames later.

## Template Engine

Build a tiny interpolation helper:

```text
renderTemplate(template, context, options)
```

Rules:

- Allow only known `{{path.to.value}}` variables.
- Do not execute JavaScript.
- Return unresolved variables as visible markers in draft contexts.
- Return validation errors in settings screens.
- Sanitize separately for filename output.

Use the small interpolation helper for:

- Fixed monthly item names.
- PDF filenames.

Use constrained Liquid for named customer text generators (including the NFS-e
description purpose) and HTML PDF templates. Both consume immutable invoice
party snapshots through the shared document model.

Keep formatting helpers outside the template language. For example, expose `invoice.dateMonthNamePt` as a context value instead of allowing helper calls in templates.

## PDF Generation

Keep PDF code isolated under `src/pdf`.

Do not reuse web UI components inside PDF components. React PDF has its own primitives and styling model.

Flow:

```text
route/service loads invoice aggregate and selected immutable template revision
-> map invoice snapshots to shared InvoiceDocumentModel
-> dispatch through renderer registry
     -> @react-pdf/renderer
     -> HTML/Liquid then Gotenberg
-> return download response or archive file
```

Use a stable view model:

```ts
type InvoicePDFViewModel = {
  issuer: IssuerView
  client: ClientView
  invoice: InvoiceView
  items: InvoiceItemView[]
  total: MoneyView
  notaFiscal?: NotaFiscalView
}
```

Archive behavior:

- Regenerated PDFs are temporary responses by default.
- Archived PDFs are written once, hashed, recorded, and never overwritten.
- If a new archive is created, supersede the old file record instead of replacing the file.

## File Storage

Use one local filesystem root:

```text
DATA_DIR=/data
DB_PATH=/data/app.db
FILES_DIR=/data/files
TMP_DIR=/tmp
```

Recommended layout:

```text
/data
  app.db
  files/
    archived/
      invoices/
        2026/
    nfse/
      2026/
    attachments/
      expenses/
  tmp/
```

File write rule:

```text
write temp file
calculate sha256
choose final append-only path
atomic move into place
insert file metadata row
link file to invoice/nfse row
```

Do not use user-provided filenames as stored paths. Store original filenames only as metadata.

## Validation

Use Zod at route boundaries with `@hono/zod-validator`, as the older CRM already did.

Use domain validation where rules are not HTTP-specific:

- invoice number pattern validity
- template variable validity
- legal invoice status transitions
- filename safety
- money parsing and formatting

The route layer should convert form strings into typed service inputs. Services should never receive raw unchecked form payloads.

## Status Model

Start with simple statuses:

```text
draft
sent
nfse_linked
paid
void
```

Question to revisit: should `nfse_linked` be a status or a derived flag?

Recommendation: make invoice commercial lifecycle a status, and show NFS-e as linked/unlinked metadata.

Better initial statuses:

```text
draft
sent
paid
void
```

Then derive:

```text
nfse_linked = exists(nota_fiscal_links where invoice_id = ...)
```

This avoids awkward combinations like `paid` plus `nfse_linked`.

## MVP Pages

Build these first:

```text
GET  /                         dashboard
GET  /clients                  client list
GET  /clients/new              new client form
POST /clients                  create client
GET  /clients/:id              client detail/settings
POST /clients/:id              update client

GET  /invoices                 invoice list
GET  /invoices/new             create invoice form
POST /invoices                 create invoice transactionally
GET  /invoices/:id             invoice detail
POST /invoices/:id/items       add item
POST /invoices/:id/items/:itemId update item
POST /invoices/:id/items/:itemId/delete delete item
POST /invoices/:id/nfse-description/regenerate regenerate description
POST /invoices/:id/status      update status
GET  /invoices/:id/pdf         download regenerated PDF
POST /invoices/:id/pdf/archive archive current PDF

POST /invoices/:id/nfse        create/update NFS-e link
POST /invoices/:id/nfse/files  upload PDF/XML

GET  /settings/issuer          issuer settings
POST /settings/issuer          update issuer settings
```

Use normal `POST` routes for form operations. If we later need method override for `PATCH` or `DELETE`, add it deliberately.

## Implementation Phases

Phase 1: foundation

- Create Bun/Hono/TSX app.
- Add Tailwind v4 and daisyUI build.
- Add local htmx and Alpine assets.
- Add layout and htmx fragment renderer.
- Add env/path config.
- Add Docker Compose skeleton.

Phase 2: persistence

- Add Drizzle schema and migrations.
- Add SQLite connection with foreign keys and WAL.
- Add issuer settings and clients CRUD.
- Add basic repository/service pattern.

Phase 3: invoice core

- Add numbering profiles and sequence allocation.
- Add create invoice workflow.
- Copy client defaults into invoice items.
- Add item CRUD and total calculation.
- Add invoice detail page.

Phase 4: templates and NFS-e helper

- Add safe template engine.
- Add fixed monthly item rendering.
- Add editable nota fiscal description.
- Add copy/regenerate flow.
- Add PDF filename template sanitization.

Phase 5: PDF and files

- Add React PDF invoice renderer.
- Add download route.
- Add local file store.
- Add archive PDF flow with file hash.
- Add NFS-e link and PDF/XML upload.

Phase 6: hardening

- Add Docker hardening.
- Add backup notes.
- Add basic auth or reverse-proxy auth guidance if exposed beyond LAN.
- Add tests for numbering, templates, money, status transitions, and file path safety.

## Testing Strategy

Use `bun:test`.

High-value tests:

- Template interpolation accepts known variables and rejects/flags unknown variables.
- Filename sanitization prevents path traversal and invalid characters.
- Money parsing stores integer minor units.
- Invoice totals sum line items correctly.
- Number sequences reset by period and stay unique.
- Manual invoice numbers cannot collide.
- Client default changes do not mutate old invoice items.
- Status transitions reject invalid moves.

For route tests, call Hono `app.fetch()` directly with test requests.

## Open Decisions

Authentication:

- For a private LAN/self-hosted app, reverse-proxy basic auth may be enough.
- If exposed publicly, add app-level auth before storing real client data.

Component library:

- daisyUI is a good default because the older CRM already used it.
- If invoice forms feel too generic, keep daisyUI primitives but add small local components.

Invoice status:

- Prefer `draft/sent/paid/void` and derive NFS-e linked state.

PDF archive:

- MVP can download regenerated PDFs first.
- Archiving should arrive before the app becomes the official record of sent PDFs.

Data export:

- Not required for first build, but SQLite plus local files should make backup/export simple.

## Near-Term Build Checklist

1. Scaffold the Bun/Hono app in this folder.
2. Add Tailwind v4, daisyUI, htmx, Alpine, Drizzle, Drizzle Kit, Zod, React PDF.
3. Build the layout and htmx renderer from the CRM pattern.
4. Add the Drizzle schema and first migration.
5. Implement client settings.
6. Implement invoice creation with transactional numbering.
7. Implement invoice detail with htmx item editing.
8. Implement template rendering for item names, NFS-e descriptions, and filenames.
9. Implement PDF download.
10. Implement file archive and NFS-e linking.
