# PDF Templating and Generalized Party Fields Plan

## 1. Purpose

This plan evolves the invoice application in four related areas:

1. Make issuer and customer information suitable for users in different countries and payment systems.
2. Make invoice PDFs selectable from reusable templates and renderable by either the existing React PDF engine or an optional HTML/Gotenberg engine.
3. Generalize the client-specific NFS-e description helper into named text generators that can produce editable plain text from invoice data.
4. Generalize NFS-e metadata and file linking into customer-configurable invoice record types with typed information fields and attachments.

The work must preserve the application's local-first, self-hosted character. React PDF remains available without any external service. Gotenberg is an optional second container and HTML templates are only selectable when it is configured.

This document refines the current decisions in `self_hosted_invoice_generator_spec.md` and `invoice_app_architecture_plan.md`. Those documents currently describe React PDF as the only PDF engine and explicitly exclude Gotenberg; update them when this plan is implemented.

## 2. Goals

- Keep only application behavior and stable identity fields as first-class issuer/customer columns.
- Offer guided, predefined document fields with sensible labels, sections, input controls, and optional format warnings.
- Retain a fully custom field escape hatch.
- Organize document fields into `identity`, `contact`, `address`, `payment`, and `other` sections.
- Snapshot the issuer, customer, payment, and template choices used by an invoice so later settings changes do not silently change its document.
- Store PDF templates as reusable, revisioned entities independent of customers.
- Allow an issuer/global default template, a customer default, and a draft invoice override.
- Keep the existing React PDF renderer as a code-defined engine.
- Add HTML + Liquid templates rendered through Gotenberg.
- Use the same Liquid format for built-in and user-created HTML templates.
- Allow template lists and selectors to filter by engine.
- Prevent selection and rendering of HTML templates unless Gotenberg is configured.
- Preserve append-only PDF archive behavior and the existing issue/revert lifecycle.
- Allow each customer to define multiple named text generators, with NFS-e description as a built-in purpose rather than a hard-coded one-off template field.
- Allow each customer to define reusable invoice record types for saving structured information and attachments; NFS-e is a built-in purpose, not a dedicated table, route, or storage workflow.
- Allow a text generator to optionally target a field in an invoice record without making generated text dependent on that record type.
- Use the same Liquid context and syntax for HTML PDF templates and text generators, with output-specific escaping.

## 3. Non-goals

- Executing user-provided JSX, TypeScript, or JavaScript.
- Making React PDF layout source editable at runtime.
- Replacing the existing interpolation engine used for filenames and recurring item names.
- Introducing a full SPA or browser-side PDF generation.
- Supporting arbitrary remote assets in HTML templates in the first version.
- Building a marketplace or remote template download system.
- Automatically converting an HTML template into a React PDF template or vice versa.
- Renaming the existing `clients` domain/table/routes to `customers` as part of this work.
- Querying or reporting across individual custom-field values in the first version.
- Building workflow automation, government API submission, or arbitrary executable behavior for configurable invoice records.
- Silently falling back between PDF engines.

## 4. Terminology

- **Party:** either the issuer or the customer represented on an invoice.
- **Field definition:** a code-defined suggestion such as email, CNPJ, IBAN, or PIX, including its default section and input behavior.
- **Party field:** an actual stored field/value belonging to an issuer, customer, or invoice snapshot.
- **Field set:** a collection of suggested fields for a common country or workflow, such as Brazilian business or international bank transfer.
- **PDF template:** reusable template identity shown in template lists and selectors.
- **Template revision:** immutable renderable version of a PDF template.
- **Text generator:** a customer-scoped named Liquid template that produces editable plain text for an invoice; NFS-e description is one supported purpose.
- **Invoice record type:** a customer-scoped definition of information and attachments that may be saved against an invoice; NFS-e linkage is one supported purpose.
- **Invoice record:** one saved instance of an invoice record type, containing snapshotted type/field definitions, entered values, and attachment references.
- **Record field definition:** a customer-configured typed metadata field such as number, issue date, verification code, URL, status, or notes.
- **Engine:** `react-pdf` or `gotenberg-html`.
- **Configured Gotenberg:** `GOTENBERG_URL` contains a valid nonempty HTTP(S) URL. Health is reported separately.
- **Available engine:** the engine is configured and presently capable of rendering. React PDF is always configured; Gotenberg may be configured but temporarily unhealthy.

The codebase may continue using `client` internally. UI copy can use “customer” later without requiring a database rename.

## 5. Domain Decisions

### 5.1 First-class issuer fields

Keep these as first-class columns because the application uses them directly:

- `id`
- `name`: stable application/display identity
- `defaultCurrency`
- `defaultPdfFilenameTemplate`
- default PDF template reference
- timestamps

Migrate these current fields to generalized party fields:

- `legalName`
- `cnpj`
- `address`
- `email`
- `bankBeneficiary`
- `bankBeneficiaryAddress`
- `bankAccountNumber`
- `bankIban`
- `bankSwiftCode`
- `bankName`
- `bankAddress`
- `bankDetails`
- `pixKey`

### 5.2 First-class customer fields

Keep these as first-class columns because they drive application behavior:

- `id`
- `name`: stable application/display identity
- `code`
- `defaultCurrency`
- `isDefault`
- `defaultFixedMonthlyValue`
- `defaultFixedMonthlyItemNameTemplate`
- `defaultPdfFilenameTemplate`
- `numberingProfileId`
- default PDF template reference
- timestamps

Migrate these current fields to generalized party fields:

- `legalName`
- `address`
- `country`
- `email`

Migrate `defaultNfseDescriptionTemplate` to the customer's initial `nfse_description` text generator. It is behavioral configuration rather than a party field.

### 5.3 Field sections

Every party field belongs to exactly one section:

```ts
type PartyFieldSection =
  | "identity"
  | "contact"
  | "address"
  | "payment"
  | "other";
```

Sections provide default form grouping and allow portable templates to iterate over semantically related fields without knowing country-specific keys.

### 5.4 Party field shape

Store party fields as ordered arrays. The initial implementation should use validated JSON text columns because fields are displayed and snapshotted as a unit and do not require cross-customer querying.

```ts
type PartyField = {
  key: string;
  definitionKey: string | null;
  label: string;
  value: string;
  section: PartyFieldSection;
  visibility: "document" | "internal";
  position: number;
};
```

Rules:

- `key` is stable within its party and unique case-insensitively.
- Keys use `lower_snake_case`, with a conservative maximum length.
- `definitionKey` refers to an optional code-defined field definition.
- Labels are stored with the instance, so application upgrades cannot silently relabel existing documents.
- Empty fields may be retained while editing settings but are omitted from invoice snapshots and template output unless explicitly needed.
- Only `document` fields enter the invoice document model, making them available to templates; the selected template still decides whether and where to render them.
- `internal` fields remain available to the application UI but never enter any PDF or text-generator template context. Visibility is therefore a template-access boundary, not a direct show/hide layout control.
- Reordering changes `position`; renderers sort deterministically by section and position.
- Changing a predefined field's label does not detach it from its definition.
- A fully custom field has `definitionKey: null` and user-selected label, key, section, and text/multiline input kind.

Use shared Zod schemas for parsing JSON from the database and validating form payloads. Invalid stored JSON must fail visibly rather than being silently discarded.

### 5.5 Predefined field definitions

Definitions live in code under `src/domain/party-fields/`, not in SQLite:

```ts
type PartyFieldDefinition = {
  key: string;
  defaultLabel: string;
  section: PartyFieldSection;
  inputKind:
    | "text"
    | "multiline"
    | "email"
    | "phone"
    | "url"
    | "country"
    | "tax-id"
    | "bank-account";
  validation?: {
    mode: "none" | "warning" | "strict";
    format?: string;
  };
  aliases?: string[];
};
```

Initial definition catalog:

| Definition key | Default label | Section | Input/validation |
| --- | --- | --- | --- |
| `legal_name` | Legal name | identity | text |
| `tax_id` | Tax ID | identity | text |
| `br_cnpj` | CNPJ | identity | tax-id, warning |
| `br_cpf` | CPF | identity | tax-id, warning |
| `vat_number` | VAT number | identity | text |
| `company_registration` | Company registration | identity | text |
| `email` | Email | contact | email, strict syntactic validation |
| `phone` | Phone | contact | phone, no strict country validation |
| `website` | Website | contact | URL, strict syntactic validation |
| `address` | Address | address | multiline |
| `country` | Country | address | country/text |
| `payment_beneficiary` | Beneficiary | payment | text |
| `beneficiary_address` | Beneficiary address | payment | multiline |
| `bank_name` | Bank name | payment | text |
| `bank_address` | Bank address | payment | multiline |
| `account_number` | Account number | payment | bank-account |
| `iban` | IBAN | payment | bank-account, warning |
| `swift_bic` | SWIFT / BIC | payment | bank-account, warning |
| `routing_number` | Routing number | payment | bank-account, warning |
| `sort_code` | Sort code | payment | bank-account, warning |
| `pix` | PIX | payment | text, warning where safely detectable |
| `payment_instructions` | Payment instructions | payment | multiline |

Definitions provide suggestions and assistance, not a closed schema. Additional definitions can be added without migrations because instances retain their stored key, label, and section.

### 5.6 Validation behavior

- Reject unsafe/invalid storage shapes, duplicate keys, invalid keys, excessive lengths, and malformed email/URL syntax.
- For country-specific identifiers and bank formats, prefer nonblocking warnings.
- Never silently normalize a value. Offer normalization as an explicit action if implemented.
- A warning must identify the field and permit “save anyway.”
- Imported/migrated values are preserved exactly apart from trimming surrounding form whitespace where current forms already do so.
- Validation operates at route boundaries; services receive typed party fields plus any acknowledged warnings.

### 5.7 Field sets

Field sets also live in code and add missing suggested fields without classifying or locking a party.

Initial candidates:

- Generic business
- Minimal customer
- Brazilian business
- UK business
- EU VAT business
- US business
- International bank transfer
- Brazilian payment / PIX
- UK bank transfer
- US ACH / wire

Applying a field set:

- Adds only keys not already present.
- Never overwrites labels, values, sections, visibility, or ordering.
- May add empty values for the user to fill.
- Can be repeated safely.
- Does not persist a permanent “party type.”

## 6. Invoice Snapshots

### 6.1 Problem

The current PDF view model loads issuer and customer rows live. Editing current settings can therefore change a regenerated historical invoice. Archived PDFs remain immutable, but draft previews and live regeneration do not preserve the original party data.

### 6.2 Snapshot model

Add validated JSON snapshots to invoices:

```ts
type InvoicePartySnapshot = {
  name: string;
  code?: string;
  fields: PartyField[]; // document-visible, nonempty values only
};
```

Recommended columns:

- `invoices.issuer_snapshot_json`
- `invoices.client_snapshot_json`
- `invoices.pdf_template_revision_id`

Payment fields are included in the issuer snapshot under the `payment` section; a separate payment snapshot column is unnecessary unless payment profiles become a later feature.

### 6.3 Snapshot rules

- New invoices copy current issuer/customer document fields at creation.
- Templates and PDF renderers consume snapshots, not live settings.
- Draft invoices provide an explicit “Refresh party details” action.
- Refresh replaces both party snapshots atomically from current settings after confirmation.
- Refresh is rejected by the service unless `isDocumentEditable(status)` is true.
- Issuing locks snapshots and the selected template revision through the existing document-edit barrier.
- Reverting to draft unlocks them but does not refresh or change them automatically.
- Notes and generalized supporting invoice records retain their current lifecycle rules and remain independent of the invoice document-edit lock.
- Invoice number, customer relationship, and other domain records remain normal columns; snapshots are document presentation state, not replacements for relationships.

### 6.4 Existing invoices

Backfill snapshots from the current related issuer/customer values during migration. These are best-effort reconstructed snapshots because historical values were not previously stored. Do not regenerate or overwrite archived files.

## 7. Template Domain Model

### 7.1 Reusable entities

Templates are independent reusable entities. Customers reference defaults; templates do not belong to customers.

Suggested schema:

```text
pdf_templates
  id integer primary key
  stable_key text unique nullable
  name text not null
  engine text not null                  -- react-pdf | gotenberg-html
  source_kind text not null             -- builtin | user
  current_revision_id integer nullable
  archived_at text nullable
  created_at text not null
  updated_at text not null

pdf_template_revisions
  id integer primary key
  template_id integer not null
  revision integer not null
  renderer_key text nullable            -- react-pdf only
  source text nullable                  -- complete HTML + Liquid document
  configuration_json text not null
  content_sha256 text not null
  created_at text not null

UNIQUE(pdf_template_revisions.template_id, revision)
```

Foreign-key details may require creating the tables before adding `current_revision_id`, or resolving the current revision by query instead of a circular reference. Prefer the simplest Drizzle/SQLite migration that retains referential integrity.

Add:

- `issuer_settings.default_pdf_template_id`
- `clients.default_pdf_template_id`
- `invoices.pdf_template_revision_id`

Defaults reference template identity so they follow its current revision for future invoices. An invoice references the resolved immutable revision.

### 7.2 Revision rules

- Revisions are immutable.
- Editing a user HTML template creates the next revision transactionally.
- Template name and archive state may change without creating a render revision.
- Engine cannot change after template creation; create a new template instead.
- React PDF revisions contain a registered `rendererKey`, never executable stored source.
- HTML revisions contain a complete HTML + Liquid source document.
- `configurationJson` stores engine-relevant page options such as paper size, margins, orientation, and print backgrounds. Validate it with an engine-specific Zod schema.
- Archiving a template removes it from normal selection but does not break invoices or defaults already referencing it. A default pointing to an archived template should be flagged for replacement.

### 7.3 Built-in templates

- Built-in React PDF templates are registered code renderers.
- Built-in HTML templates are ordinary HTML + Liquid source files in the repository.
- Include built-in sources in both Docker and compiled-binary runtime assets.
- Register built-ins idempotently in SQLite using a stable key plus content hash.
- A changed built-in source creates a new immutable revision rather than mutating the previous row.
- Users may duplicate a built-in HTML template into an editable user template.
- Built-in HTML and user HTML use the same parser, document model, and Gotenberg renderer.
- Do not add JSX-only HTML templates.

### 7.4 Template resolution

Resolve once when creating an invoice:

```text
explicit create-form choice
  -> customer default template
  -> issuer default template
  -> built-in React PDF default
```

Store the resolved revision ID on the invoice. A draft may select a different active revision explicitly. The service rejects template changes for noneditable invoices.

If a customer or issuer default points to an unavailable engine:

- Do not silently choose another engine.
- Show the invalid/unavailable default in settings.
- Invoice creation must require an available selection or report a clear error.

## 8. Renderer-Neutral Document Model

Replace the PDF-specific view model with a renderer-neutral model assembled from invoice snapshots:

```ts
type DocumentField = {
  key: string;
  label: string;
  value: string;
};

type DocumentParty = {
  name: string;
  code?: string;
  fields: DocumentField[];
  field: Record<string, DocumentField>;
  sections: Record<PartyFieldSection, DocumentField[]>;
};

type InvoiceDocumentModel = {
  issuer: DocumentParty;
  customer: DocumentParty;
  invoice: {
    number: string;
    dateIso: string;
    dateDisplay: string;
    dateYear: string;
    dateMonth: string;
    currency: string;
    notes: string | null;
  };
  items: Array<{
    name: string;
    valueMinor: number;
    valueDisplay: string;
  }>;
  total: {
    minor: number;
    decimal: string;
    display: string;
  };
  records: Array<{
    typeKey: string;
    typeName: string;
    purpose: string;
    field: Record<string, { label: string; value: string }>;
  }>;
};
```

Notes:

- Provide arrays for generic iteration and maps for specifically designed templates.
- Use `customer` in the Liquid contract even if database code continues using `client`.
- Construct plain objects only; do not pass Drizzle rows, repositories, services, or class instances into Liquid.
- Centralize formatting in the model builder. Templates should not contain money arithmetic or business date logic.
- React PDF consumes the same model, eliminating engine-specific data loading.
- Supporting records are projected generically and exclude attachment bytes/private storage paths. Templates may choose records by stable type key or purpose; the built-in template may provide NFS-e-specific presentation without introducing a dedicated model property.

## 9. PDF Renderer Boundary

Introduce an explicit renderer registry:

```ts
type PdfEngine = "react-pdf" | "gotenberg-html";

type PdfRenderRequest = {
  template: PdfTemplateRevision;
  document: InvoiceDocumentModel;
  traceId: string;
};

interface PdfRenderer {
  readonly engine: PdfEngine;
  render(request: PdfRenderRequest): Promise<Buffer>;
}
```

Suggested layout:

```text
src/pdf/
  document-model.ts
  renderer.ts
  renderer-registry.ts
  react-pdf/
    render.tsx
    templates/
      classic.tsx
  html/
    liquid-engine.ts
    gotenberg-client.ts
    render.ts
    templates/
      classic.liquid
```

`renderInvoicePdf` and `archiveInvoicePdf` resolve the invoice's revision and dispatch through the registry. Routes and file storage remain engine-agnostic.

No automatic fallback is allowed. A fallback could archive a visually different official document.

## 10. HTML + Liquid Templates

### 10.1 Scope

- HTML templates are complete documents, including `<!doctype html>`, `<html>`, `<head>`, print CSS, and `<body>`.
- Use Liquid syntax for interpolation, loops, and conditionals.
- Built-in and user HTML templates use identical syntax and rendering.
- The operator is trusted in this self-hosted system. Safeguards primarily prevent accidental broken markup or runaway rendering, not hostile multi-tenant execution.

Example:

```liquid
<h1>Invoice {{ invoice.number }}</h1>

{% for field in customer.sections.identity %}
  <div><span>{{ field.label }}</span> {{ field.value }}</div>
{% endfor %}

{% for item in items %}
  <div>{{ item.name }} — {{ item.valueDisplay }}</div>
{% endfor %}
```

Settle exact Liquid property casing when implementing the document model and document it in a template reference page. Prefer idiomatic lower camel case consistently with TypeScript unless Liquid ergonomics prove materially better otherwise.

### 10.2 Liquid engine policy

Use `liquidjs` with:

- HTML escaping by default.
- Strict filters.
- Strict variables for normal outputs.
- Lenient missing values in `if`, `unless`, and `default` usage so optional sections are ergonomic.
- Own-property-only access.
- Conservative source length, parse, render, and memory limits to catch accidental runaway templates.
- No direct filesystem lookup.
- Partials/includes, if introduced, resolved only from an explicit in-memory map of stored/approved revisions.
- A small documented custom-filter allowlist only when the document model cannot reasonably provide the value.

Template authors are the self-hosted operator, but invoice/customer values still need escaping by default to produce valid, predictable HTML.

### 10.3 Template validation

On save:

- Parse Liquid syntax.
- Reject unknown tags and filters.
- Perform static variable analysis where practical and warn about unknown top-level paths.
- Require a complete HTML document for the first version.
- Enforce source-size limits.
- Render with representative sample data to catch runtime errors.
- Create the immutable revision only after validation succeeds or after the user explicitly accepts nonfatal warnings.

### 10.4 Assets

First version:

- Prefer self-contained CSS in the HTML document.
- Permit small images as managed template assets or data URLs; choose one path during implementation based on UI complexity.
- Do not fetch arbitrary remote assets.

When managed assets are added:

- Store them append-only under `DATA_DIR` through the existing file service pattern.
- Reference them by generated safe filenames.
- Send `index.html` and assets together in Gotenberg multipart form data.
- Never trust uploaded filenames for stored paths.

## 11. Gotenberg Integration

### 11.1 Configuration

Add environment configuration:

```text
GOTENBERG_URL=
GOTENBERG_TIMEOUT_MS=15000
```

Rules:

- Empty `GOTENBERG_URL` means not configured.
- Validate a configured value as an HTTP(S) URL at startup/config access.
- Normalize trailing slashes in one configuration helper.
- Do not infer configuration from health.
- Do not persist the URL in SQLite in the first version; it is deployment configuration.

### 11.2 Rendering

The client posts multipart form data to:

```text
/forms/chromium/convert/html
```

Include:

- Required file named `index.html`.
- Managed template assets, if supported.
- Page and print options from validated revision configuration.
- `printBackground=true` for templates that require it.
- A trace ID/header for correlating application and Gotenberg errors.

Validate:

- HTTP success status.
- PDF content type where provided.
- `%PDF-` signature before returning or archiving bytes.
- Response size against a reasonable maximum.

Map timeout, connection, 4xx validation, 5xx availability, invalid-response, and invalid-PDF failures into distinct application errors with actionable UI messages.

### 11.3 Health and availability

- Use Gotenberg `/health` for status display and an on-demand connection check.
- Do not require a health call before every render; the render request remains authoritative.
- Cache UI health briefly if needed to avoid repeated calls.
- A configured but unhealthy service is different from an unconfigured service.

### 11.4 Docker Compose

- Keep the invoice service usable alone.
- Add Gotenberg as an optional Compose profile or provide a clearly documented Compose variant.
- When enabled, configure `GOTENBERG_URL=http://gotenberg:3000` on the invoice service.
- Do not expose the Gotenberg port to the host by default.
- Add a container health check.
- Document the additional RAM/CPU cost and that React PDF remains the lightweight option.

## 12. Engine Availability and Template Selection

### 12.1 Filtering

Every template list or selector supports these engine filters:

- All
- React PDF
- HTML / Gotenberg

Use explicit query/form state such as `?engine=react-pdf` or `?engine=gotenberg-html` for server-rendered lists. Alpine may handle purely local filtering only when the entire small list is already present.

Each template row/card displays:

- Name
- Engine badge
- Built-in/user badge
- Current revision
- Active/archived state
- Availability state where relevant

### 12.2 Selection rules

- React PDF templates are always selectable.
- HTML templates are selectable only when Gotenberg is configured.
- Enforce this in services as well as UI controls.
- When unconfigured, HTML templates remain visible, editable, duplicable, importable, and exportable, but selection, preview, live rendering, issuing with that template, and archiving are disabled.
- When configured but unhealthy, show an unavailable warning and disable current preview/render/archive actions. Do not discard defaults or selections.
- Do not delete or mutate HTML templates when configuration is removed.
- Do not silently replace an unavailable HTML default with React PDF.

### 12.3 Existing invoice behavior

- Archived PDFs remain downloadable regardless of current engine configuration.
- A draft assigned an HTML revision while Gotenberg is unavailable shows a blocking render warning and offers selection of another available template.
- A non-draft invoice retains its locked revision. Live regeneration reports the missing/unavailable engine clearly; the archived PDF remains authoritative.
- Issuing requires successful rendering and archiving through the selected engine, as it does today.

## 13. UI Plan

### 13.1 Party field editor

Create a reusable server-rendered component used by issuer and customer forms:

```text
src/web/components/party-field-editor.tsx
```

Behavior:

- Group fields by section.
- Reorder within sections.
- Add from searchable suggested-field menu.
- Apply a field set.
- Add a fully custom field.
- Edit label, value, section, and visibility.
- Show input controls based on definition/input kind.
- Show nonblocking format warnings with a save-anyway path.
- Prevent duplicate keys and make key editing an advanced/custom-field action.
- Use Alpine for local add/remove/reorder/disclosure behavior.
- Use htmx for server validation, field-set application if server state is needed, and persistence.
- Preserve submitted rows on `422` responses.

### 13.2 Template management

Add a template feature folder:

```text
src/features/pdf-templates/
  pdf-templates.routes.tsx
  pdf-templates.service.ts
  pdf-templates.repository.ts
  pdf-templates.schema.ts
  pdf-templates.pages.tsx
  components/
```

Pages/actions:

- List templates with engine filters.
- View template metadata and revision history.
- Create an HTML template.
- Duplicate a built-in or user HTML template.
- Edit HTML source to create a revision.
- Preview an HTML template against a selected invoice when Gotenberg is configured.
- Archive/unarchive template identity.
- Import/export HTML template source; package assets later.
- View React PDF template metadata without exposing source editing.

Potential routes:

```text
GET  /settings/pdf-templates
GET  /settings/pdf-templates/new
POST /settings/pdf-templates
GET  /settings/pdf-templates/:id
GET  /settings/pdf-templates/:id/edit
POST /settings/pdf-templates/:id/revisions
POST /settings/pdf-templates/:id/duplicate
POST /settings/pdf-templates/:id/archive
POST /settings/pdf-templates/:id/preview
GET  /settings/pdf-engines
POST /settings/pdf-engines/gotenberg/check
```

### 13.3 Issuer/customer defaults

- Add a default PDF template selector to issuer settings.
- Add a default PDF template selector to customer settings.
- Include engine filters in selector popovers/pages.
- Disable HTML options if Gotenberg is unconfigured and explain why.
- Flag archived or currently unavailable defaults instead of hiding them.
- Link to template and engine settings.

### 13.4 Invoice composer/detail

- Resolve and display the effective template during invoice creation.
- Permit an explicit template selection before creation.
- On draft detail, permit changing the selected revision.
- Display template name, engine, and revision beside PDF actions.
- Add “Refresh party details” for drafts with a confirmation explaining snapshot replacement.
- Surface configuration/health errors next to preview/download/archive actions.
- Keep archived-PDF actions independent of current renderer availability.

### 13.5 Customer text generators

- Add a text-generator section to the customer workspace with ordered active and archived generators.
- Provide create/edit/archive actions for generator name, stable key, purpose, and Liquid source, with variable reference and sample validation feedback.
- On invoice detail, show every active generator by name with Generate, Edit result, Save, Copy, and explicit Regenerate actions.
- Integrate the active `nfse-description` purpose into the existing nota fiscal description panel rather than showing a duplicate generic panel.
- If a generator targets an invoice-record field, offer an explicit action to copy its editable result into that field; generation must never silently create or mutate a record.
- Preserve submitted Liquid source on `422` and distinguish syntax errors from nonfatal unknown-path warnings.
- Use htmx for validation, generation, persistence, and fragment swaps; use Alpine only for local copy feedback and disclosure state.

Potential routes:

```text
GET  /clients/:id/text-generators/new
POST /clients/:id/text-generators
GET  /clients/:id/text-generators/:generatorId/edit
POST /clients/:id/text-generators/:generatorId
POST /clients/:id/text-generators/:generatorId/archive
POST /invoices/:id/generated-texts/:generatorKey/generate
POST /invoices/:id/generated-texts/:generatorKey/save
POST /invoices/:id/generated-texts/:generatorKey/regenerate
```

### 13.6 Customer invoice record types and invoice records

- Add a customer workspace section for active and archived invoice record types.
- Let users configure the type name, stable key, optional built-in purpose, ordered metadata fields, multiplicity, and allowed attachment categories.
- On invoice detail, show applicable record types and allow creating, editing, archiving, and attaching files to record instances.
- Render built-in-purpose records, including NFS-e, through the same generalized components. A purpose may influence default labels and placement, but not persistence or file handling.
- Keep attachments append-only: replacement creates a new stored file and supersedes the previous reference rather than overwriting bytes.
- Preserve submitted values on `422` and validate URLs, dates, field keys, file categories, MIME types, and size limits at route boundaries.

Potential routes:

```text
GET  /clients/:id/invoice-record-types/new
POST /clients/:id/invoice-record-types
GET  /clients/:id/invoice-record-types/:typeId/edit
POST /clients/:id/invoice-record-types/:typeId
POST /clients/:id/invoice-record-types/:typeId/archive
POST /invoices/:id/records
POST /invoices/:id/records/:recordId
POST /invoices/:id/records/:recordId/attachments
POST /invoices/:id/records/:recordId/attachments/:attachmentId/supersede
```

## 14. Customer Text Generators and Template Compatibility

### 14.1 Generalized text-generator model

Replace the single customer `defaultNfseDescriptionTemplate` concept with customer-scoped named text generators. A customer may have any number of generators, for example:

- NFS-e service description
- Invoice email body
- Payment reference
- Timesheet or purchase-order note
- A fully custom administrative text

Suggested schema:

```text
client_text_generators
  id integer primary key
  client_id integer not null
  key text not null                     -- lower_snake_case, unique per client
  name text not null
  purpose text not null                 -- nfse-description | custom
  source text not null                  -- Liquid plain-text template
  position integer not null
  archived_at text nullable
  created_at text not null
  updated_at text not null

invoice_generated_texts
  id integer primary key
  invoice_id integer not null
  generator_id integer nullable         -- set null if generator is later removed
  generator_key text not null           -- snapshot for historical meaning
  generator_name text not null          -- snapshot for historical display
  source_snapshot text not null         -- exact Liquid source used
  content text not null                 -- final user-editable result
  created_at text not null
  updated_at text not null

UNIQUE(client_text_generators.client_id, client_text_generators.key)
UNIQUE(invoice_generated_texts.invoice_id, invoice_generated_texts.generator_key)
```

Rules:

- `nfse-description` is a recognized purpose with dedicated placement in the existing NFS-e workflow, not a special template column.
- A customer may have at most one active `nfse-description` generator; all other generators use `custom`.
- Custom generator keys are stable, case-insensitively unique, and use the same conservative `lower_snake_case` convention as party fields.
- Generators are customer-specific because the wording commonly depends on customer contracts and local invoicing requirements.
- Generator output is always editable before saving or copying. Templates assist; they are not authoritative.
- Saving output snapshots the generator key, name, and source alongside the edited content. Later generator edits never mutate saved invoice text.
- Regeneration is explicit and warns before replacing an already edited saved result.
- Archived generators cannot generate new output but do not remove saved invoice text.
- Text generation does not require Gotenberg and remains available in lightweight deployments.

### 14.2 Liquid policy for plain text

Text generators use `liquidjs` and the same `InvoiceDocumentModel` property names, strict-variable policy, own-property-only access, source limits, parser, and documented tag/filter allowlist as HTML PDF templates. This gives users one expressive template language for invoice-derived documents and allows conditions and iteration over generalized party fields.

Output handling differs by target:

- HTML PDF rendering HTML-escapes interpolated invoice/customer values by default.
- Plain-text generation does not HTML-escape values; it returns literal Unicode text suitable for editing and copying.
- Text generators cannot emit or invoke includes, filesystem content, remote resources, HTML rendering, or PDF actions.
- Apply separate conservative source and rendered-output size limits for plain text.

The Liquid context comes only from the invoice's stored party snapshots and invoice data. It must not read current issuer/customer party fields during invoice-specific generation. This preserves historical party details while still allowing an explicit draft “Refresh party details” action.

### 14.3 Existing template-engine compatibility and migration

The current `src/domain/template-engine.ts` remains the small interpolation engine only for:

- Fixed monthly item names
- PDF filenames

Those templates remain unchanged because they benefit from a deliberately small known-variable grammar and filename-specific safety. Update `src/features/invoices/invoice-template-context.ts` so deprecated first-class party values resolve from generalized current fields for create-form defaults and from invoice snapshots for invoice-specific filename generation.

During migration, convert each nonempty `clients.default_nfse_description_template` value into that customer's active `nfse_description` generator. Existing `{{ invoice.number }}`-style expressions are valid Liquid syntax, but migration must parse and sample-render every converted source before cutover. If a legacy expression is not valid under the Liquid contract, retain the original column/value, flag the customer for manual correction, and do not silently alter its meaning.

Existing `invoices.nfse_description` values migrate to `invoice_generated_texts` as saved editable output under the `nfse_description` key. Keep compatibility reads until the data migration is verified, then remove the legacy customer and invoice columns during the legacy-column-removal phase.

### 14.4 Generalized invoice information and attachments

Do not add further NFS-e-specific metadata or attachment behavior. Replace the dedicated linkage concept with customer-scoped invoice record types and generalized invoice records.

Suggested schema:

```text
client_invoice_record_types
  id integer primary key
  client_id integer not null
  key text not null                         -- lower_snake_case, unique per client
  name text not null
  purpose text not null                    -- nfse | custom
  field_definitions_json text not null     -- ordered, validated definitions
  attachment_definitions_json text not null -- ordered accepted categories/rules
  allow_multiple integer not null default 0
  position integer not null
  archived_at text nullable
  created_at text not null
  updated_at text not null

invoice_records
  id integer primary key
  invoice_id integer not null
  record_type_id integer nullable
  record_type_key text not null             -- historical snapshot
  record_type_name text not null            -- historical snapshot
  purpose text not null                     -- historical snapshot
  definitions_snapshot_json text not null
  values_json text not null
  created_at text not null
  updated_at text not null

invoice_record_attachments
  id integer primary key
  invoice_record_id integer not null
  definition_key text nullable
  stored_file_id integer not null
  supersedes_attachment_id integer nullable
  created_at text not null

UNIQUE(client_invoice_record_types.client_id, client_invoice_record_types.key)
```

Each record field definition has a stable key, stored label, input kind (`text`, `multiline`, `date`, `url`, `number`, `boolean`, or `select`), required flag, and optional choices/validation. Attachment definitions similarly provide a stable key, label, accepted MIME types/extensions, maximum count, and required flag. Definitions are validated JSON because a record is edited and snapshotted as a unit; file bytes and common file metadata continue using the centralized append-only file store.

Rules:

- `nfse` is a recognized purpose used for initial presets, placement, and migration only. It must not require dedicated columns, tables, upload code, or CRUD services.
- A customer may customize its NFS-e fields and attachments or create unrelated record types such as purchase order, timesheet, tax receipt, delivery proof, or compliance evidence.
- Record instances snapshot their type name, purpose, and definitions. Later customer configuration changes do not reinterpret historical values or attachments.
- Archiving a record type prevents new records but never removes existing records or files.
- Record metadata and attachments remain editable in any invoice status unless a future record type explicitly introduces a lifecycle rule. Invoice document locking must not implicitly lock supporting records.
- Generalized attachments reuse the existing safe file-storage boundary: generated stored names, hashes, atomic moves, original filename as metadata only, and no overwrites.
- A text generator may declare an optional target `{ recordTypeKey, fieldKey }`. Saving or regenerating generated text does not update the record automatically; the user explicitly applies the current editable output.
- PDF templates receive generalized records only through an intentionally documented, safe document-model projection. Merely saving a record never forces it to appear on an invoice PDF.
- Avoid a universal entity/field framework: this abstraction is specifically for customer-configured supporting information attached to invoices.

## 15. Database Migration Strategy

Use generated Drizzle migrations after updating `src/db/schema.ts`. Do not hand-invent production migration commands; use the package scripts.

### Migration A: additive generalized fields and template tables

- Add issuer/customer custom-fields JSON columns with a valid empty-array default or perform explicit backfill before making them non-null.
- Create `pdf_templates` and `pdf_template_revisions`.
- Add nullable issuer/customer default-template references.
- Add nullable invoice snapshot and template-revision columns.
- Create `client_text_generators` and `invoice_generated_texts` with their per-client/per-invoice uniqueness constraints.
- Create `client_invoice_record_types`, `invoice_records`, and `invoice_record_attachments`; reuse the common stored-file table rather than creating record-specific file storage.
- Register initial built-in React PDF template/revision idempotently.

### Migration B: data backfill

For every issuer/customer:

- Convert each nonempty legacy document field to a predefined `PartyField`.
- Preserve value and meaningful existing label.
- Assign deterministic positions.
- Do not create duplicates when migration/startup is rerun.

Mapping examples:

| Legacy column | Definition | Label | Section |
| --- | --- | --- | --- |
| issuer `legal_name` | `legal_name` | Legal name | identity |
| issuer `cnpj` | `br_cnpj` | CNPJ | identity |
| issuer `address` | `address` | Address | address |
| issuer `email` | `email` | Email | contact |
| issuer `bank_beneficiary` | `payment_beneficiary` | Beneficiary | payment |
| issuer `bank_beneficiary_address` | `beneficiary_address` | Beneficiary address | payment |
| issuer `bank_account_number` | `account_number` | Account number | payment |
| issuer `bank_iban` | `iban` | IBAN | payment |
| issuer `bank_swift_code` | `swift_bic` | SWIFT / BIC | payment |
| issuer `bank_name` | `bank_name` | Bank name | payment |
| issuer `bank_address` | `bank_address` | Bank address | payment |
| issuer `bank_details` | `payment_instructions` | Payment instructions | payment |
| issuer `pix_key` | `pix` | PIX | payment |
| client `legal_name` | `legal_name` | Legal name | identity |
| client `address` | `address` | Address | address |
| client `country` | `country` | Country | address |
| client `email` | `email` | Email | contact |

Then:

- Create reconstructed snapshots for existing invoices from their current related records.
- Assign the built-in classic React PDF revision to existing invoices.
- Set reasonable issuer/global default to the classic React template where absent.
- Convert each valid legacy customer NFS-e template into one active `nfse_description` Liquid generator without changing the stored source text.
- Copy each existing saved invoice NFS-e description into `invoice_generated_texts`, including generator identity/source snapshots where recoverable.
- Create a customer NFS-e record type wherever legacy NFS-e linkage exists or the customer uses the NFS-e workflow.
- Convert every legacy NFS-e link into an `invoice_records` row and map number, issue date, verification code, public URL, and notes by stable field key.
- Relink legacy NFS-e PDF/XML files through `invoice_record_attachments` without moving, rewriting, or rehashing stored bytes.
- Flag, rather than rewrite or discard, legacy NFS-e templates that fail Liquid validation.
- Do not modify file records or archived PDF bytes; migration adds generalized references to existing stored files.

### Migration C: application cutover

- Read/write document fields exclusively through generalized party fields.
- Render exclusively from invoice snapshots.
- Dispatch PDFs through the renderer registry.
- Read and write NFS-e/custom generated output through generalized text-generator services, with temporary compatibility reads for legacy NFS-e columns.
- Read and write supporting metadata and attachments exclusively through generalized invoice-record services, with temporary compatibility reads for legacy NFS-e links.
- Stop writing legacy document columns.
- Keep temporary compatibility reads only where necessary for a rolling transition during development.

### Migration D: legacy-column removal

After tests and manual migration verification:

- Remove migrated legacy issuer/customer document columns, legacy customer/invoice NFS-e description columns, and dedicated NFS-e link/attachment structures using SQLite table recreation as generated by Drizzle.
- Remove compatibility mapping code.
- Retain migration tests starting from the current pre-change schema.

Separating removal from backfill reduces risk and makes failures recoverable without touching archived files.

## 16. Service and Repository Boundaries

### Party fields

- Domain: definitions, field sets, ordering, key rules, warnings, snapshot conversion.
- Route schemas: decode dynamic form rows and warning acknowledgements.
- Issuer/customer services: apply field sets, validate, and persist typed arrays.
- Repositories: serialize/deserialize validated JSON and perform database operations only.

### Templates

- Repository: template/revision CRUD and lookup.
- Service: revision creation, engine availability rules, default validation, effective-template resolution, duplication, built-in registration.
- Liquid renderer: parsing/rendering only.
- Gotenberg client: HTTP/multipart and transport errors only.
- Invoice service: document-model construction, revision selection, lifecycle enforcement, renderer dispatch, archive orchestration.

### Text generators

- Repository: customer generator CRUD, ordering/archive state, and saved invoice-output persistence.
- Service: key/purpose uniqueness, Liquid validation, generation from the renderer-neutral invoice model, explicit regeneration, and immutable generator metadata/source snapshots on saved output.
- Shared Liquid layer: parser, strict access policy, context contract, limits, and tag/filter allowlist shared with HTML templates; output escaping is selected explicitly for HTML versus plain text.
- Routes: translate validation failures to preserved `422` fragments and never build Liquid contexts or render templates directly.

### Invoice records and attachments

- Domain: record/type keys, typed field definitions, attachment definitions, validation, ordering, and immutable definition snapshots.
- Repository: record-type CRUD, invoice-record persistence, and attachment-reference persistence; it does not write file bytes directly.
- Service: applicable-type resolution, snapshot creation, value validation, archive/multiplicity rules, explicit generated-text application, and legacy NFS-e migration mapping.
- Shared file service: validation, hashing, atomic append-only storage, metadata insertion, download authorization, and supersession for every attachment purpose.
- Routes: parse multipart/form payloads, invoke services, and return preserved validation fragments; no NFS-e-specific persistence path.

Routes must not select fallback templates, construct Liquid contexts, call Gotenberg directly, or implement snapshot lifecycle rules.

## 17. Error Model

Add explicit service errors suitable for route translation:

- `PdfTemplateNotFoundError`
- `PdfTemplateRevisionNotFoundError`
- `PdfTemplateArchivedError`
- `PdfTemplateEngineMismatchError`
- `PdfEngineNotConfiguredError`
- `PdfEngineUnavailableError`
- `PdfTemplateValidationError`
- `PdfTemplateRenderError`
- `GotenbergTimeoutError`
- `GotenbergInvalidResponseError`
- `TextGeneratorNotFoundError`
- `TextGeneratorKeyTakenError`
- `TextGeneratorValidationError`
- `TextGeneratorRenderError`
- existing document-locked error for snapshot/template mutation

Expected validation errors return swappable `422` fragments. Temporary engine failures should normally return `503` with a useful message. Missing configuration is a settings/actionability error and should not be presented as an internal server failure.

## 18. Testing Plan

### 18.1 Party-field domain tests

- Parse and serialize party fields without losing order.
- Reject duplicate and invalid keys.
- Preserve stored labels independently from definition changes.
- Apply field sets idempotently.
- Do not overwrite existing values when applying field sets.
- Separate document and internal visibility.
- Produce warnings for CNPJ/IBAN/SWIFT examples without blocking save.
- Strictly reject malformed email/URL where specified.
- Add and persist a fully custom field.

### 18.2 Migration tests

- Backfill every nonempty legacy issuer field exactly once.
- Backfill every nonempty legacy customer field exactly once.
- Preserve empty/null behavior.
- Preserve labels, sections, and deterministic ordering.
- Reconstruct snapshots for existing invoices.
- Assign the classic React revision.
- Leave archived file rows and bytes untouched.
- Run migration against a representative pre-change database fixture.

### 18.3 Snapshot tests

- New invoice copies current document fields.
- Later issuer/customer edits do not change invoice document model.
- Draft refresh replaces snapshots.
- Refresh is rejected outside draft.
- Revert to draft does not refresh implicitly.
- Internal and empty fields do not enter snapshots.

### 18.4 Text-generator tests

- Create multiple named generators for one customer and reject duplicate keys case-insensitively.
- Allow at most one active `nfse-description` purpose per customer.
- Render variables, loops, conditionals, keyed party fields, and section iteration from the shared invoice document model.
- Preserve literal characters such as `&`, `<`, and non-ASCII text in plain-text output instead of HTML-escaping them.
- Render invoice-specific output from party snapshots, not current customer/issuer settings.
- Saving generated output snapshots generator key, name, and source; later generator edits do not mutate it.
- Regeneration requires an explicit replacement action when edited output exists.
- Archived generators remain associated with saved output but cannot produce new output.
- Migrate valid legacy NFS-e templates and flag invalid ones without data loss.

### 18.5 Template domain tests

- Create reusable templates independent of customers.
- Create immutable sequential revisions.
- Resolve explicit/customer/issuer/built-in precedence.
- Store the resolved revision on invoice creation.
- Change template only while document is editable.
- Do not allow engine changes on an existing template.
- Register built-ins idempotently and create a revision when source hash changes.
- Archived templates remain resolvable by existing invoices.

### 18.6 Liquid tests

- Render variables, loops, conditionals, and optional sections.
- Escape invoice/customer values by default.
- Access a field by key and iterate by section.
- Reject invalid tags/filters and malformed syntax.
- Report useful source locations where LiquidJS provides them.
- Enforce source and render limits.
- Prevent filesystem-based includes.
- Render the built-in HTML template with empty and populated optional sections.

### 18.7 Renderer contract tests

- React PDF and HTML renderers accept the same document model.
- Registry dispatches by revision engine.
- Renderer mismatch is rejected.
- No fallback occurs after a renderer error.
- Both successful outputs begin with `%PDF-`.

### 18.8 Gotenberg client tests

Use a local fake HTTP server for unit/integration tests:

- Sends multipart with `index.html` and expected options.
- Returns PDF bytes on success.
- Maps connection refusal, timeout, 4xx, and 5xx correctly.
- Rejects a successful non-PDF response.
- Enforces maximum response size.
- Propagates trace identifiers.

Add an opt-in real Gotenberg integration test for local/CI environments where the service is enabled; do not make ordinary unit tests require Docker.

### 18.9 Route/UI tests

- Template list filters by engine.
- HTML templates are visible but not selectable without configuration.
- Service rejects forged selection of HTML templates without configuration.
- Configured but unhealthy state is displayed distinctly.
- `422` party forms preserve dynamic fields and warnings.
- Draft invoice template override updates the correct fragment.
- Archived PDF remains downloadable without its rendering engine.
- Issue action fails safely without changing status if rendering/archive fails.
- Customer generator forms preserve submitted source and metadata on `422`.
- Invoice detail lists the customer's active generators and keeps generated output editable and copyable.
- NFS-e-purpose output appears in the existing NFS-e workflow while custom outputs remain separately named.

### 18.10 Regression tests

- Existing filename and fixed-item interpolation continues to work.
- Legacy NFS-e templates and saved descriptions migrate without silent source/content changes.
- Current React PDF output remains nonempty and valid.
- Invoice issue/revert status side effects remain intact.
- Archive supersession remains append-only.
- Money remains integer minor units and totals remain item-derived.

## 19. Implementation Phases

### Phase 1: Generalized party-field domain

1. Add definitions, field sets, types, Zod schemas, ordering, and warnings.
2. Add JSON columns and repository serialization.
3. Build the reusable party-field editor.
4. Update issuer and customer forms/services.
5. Backfill legacy values, retaining legacy columns temporarily.
6. Add domain, service, form, and migration tests.

Exit criteria:

- Existing issuer/customer information appears in the new sectioned editor.
- Suggested fields, field sets, and fully custom fields work.
- No legacy value is lost.

### Phase 2: Invoice document snapshots

1. Add snapshot columns and types.
2. Snapshot new invoices transactionally.
3. Backfill existing invoices.
4. Add draft refresh action.
5. Change PDF/context reads to use snapshots with temporary compatibility fallback.
6. Test lifecycle locking and historical independence.

Exit criteria:

- Editing current party settings cannot change an invoice unless a draft refresh is explicitly invoked.

### Phase 3: Generalized customer text generators

1. Extract the renderer-neutral invoice document model and finalized Liquid context contract.
2. Add the constrained Liquid parser/rendering core with explicit plain-text and HTML output policies.
3. Add customer text-generator and saved invoice-output tables, services, routes, and forms.
4. Migrate the legacy customer NFS-e template and saved invoice NFS-e output with compatibility reads.
5. Place `nfse-description` generators alongside the generalized `nfse` record-purpose workflow and expose other named generators on invoice detail.
6. Add generation, editing, copy feedback, explicit regeneration, migration, and snapshot-isolation tests.

Exit criteria:

- Customers can define multiple named Liquid text generators.
- NFS-e description is a generator purpose rather than a fixed customer template field.
- Generated output uses invoice snapshots, remains editable, and is historically stable after saving.
- Filenames and recurring item names remain on the existing small interpolation engine.

### Phase 3B: Generalized invoice records and attachments

1. Add record-type definition schemas and customer configuration UI.
2. Add generalized invoice records with immutable definition snapshots.
3. Route all record attachments through the shared append-only file service.
4. Add optional explicit text-generator targets for record fields.
5. Migrate legacy NFS-e metadata and PDF/XML references without rewriting stored files.
6. Replace NFS-e-specific forms/routes/services with purpose-aware generalized record components and temporary compatibility reads.
7. Test field validation, multiplicity, snapshot stability, file supersession, lifecycle independence, and migration fidelity.

Exit criteria:

- Customers can define multiple kinds of supporting invoice information and attachment bundles.
- NFS-e is a preset/purpose rendered by the generalized record system, not a dedicated persistence subsystem.
- Existing NFS-e metadata and files remain accessible with unchanged bytes and historical meaning.
- Generated text enters a record field only through an explicit user action.

### Phase 4: Template registry and React PDF adapter

1. Add template/revision schema and feature folder.
2. Register the current React document as the classic built-in template.
3. Add renderer interface and registry.
4. Adapt existing React PDF rendering without changing its layout.
5. Add global/customer defaults and invoice revision selection.
6. Add engine-filtered template list/selector UI.

Exit criteria:

- Existing PDFs render through the registry.
- Reusable React template selection and precedence work.
- Invoice revision selection is snapshotted and lifecycle-locked.

### Phase 5: Liquid HTML rendering

1. Reuse the constrained Liquid core and document-model contract introduced for text generators.
2. Add HTML-specific escaping, complete-document validation, and rendering limits.
3. Create the first built-in HTML + Liquid template.
4. Add template validation, revision editing, duplication, and sample rendering.
5. Add source editor UI and revision history.

Exit criteria:

- Built-in and user HTML templates render deterministically to complete HTML from the shared document model.

### Phase 6: Gotenberg engine

1. Add environment configuration and engine status model.
2. Implement Gotenberg multipart client and error mapping.
3. Add optional Compose configuration and health check.
4. Wire HTML renderer into registry.
5. Enforce configured/available selection and action rules server-side.
6. Add fake-server and opt-in real-service tests.

Exit criteria:

- Configured deployments can preview, download, and archive HTML PDFs.
- Unconfigured deployments remain fully functional with React PDF.
- No silent fallback or partial lifecycle transition occurs.

### Phase 7: Cleanup and documentation

1. Remove legacy party columns after verified cutover.
2. Remove party-field, generated-text, and legacy NFS-e record/attachment compatibility reads.
3. Update product specification and architecture plan.
4. Update `.env.example`, Docker documentation, and template author reference.
5. Document field definitions, field sets, engine filtering, and failure behavior.
6. Run build, typecheck, unit tests, migration test, and both renderer checks.

## 20. Operational and Data-Safety Requirements

- Never overwrite archived PDFs or template assets.
- A failed render/archive must not advance invoice status.
- Template revision creation and current-revision update must be transactional.
- Invoice creation must store party snapshots and resolved template revision in the same transaction as the invoice where practical.
- Gotenberg receives rendered invoice data, so deployments should keep it on a private Compose network.
- Do not log complete rendered HTML because it may contain customer and payment data.
- Log template/revision/invoice IDs, engine, trace ID, duration, status, and error category.
- Back up SQLite and `DATA_DIR` together.
- Removing Gotenberg configuration never deletes templates, revisions, invoices, or files.

## 21. Documentation Deliverables

Implementation is not complete until these are documented:

- Supported engines and their deployment tradeoffs.
- Enabling optional Gotenberg in Compose.
- Engine configured versus temporarily unavailable states.
- Template selection precedence.
- Template revision and invoice locking behavior.
- Liquid variable/filter/tag reference supported by the app.
- Customer text-generator keys, purposes, plain-text escaping behavior, regeneration rules, and saved-output snapshots.
- Customer invoice-record type keys, purposes, field/attachment definitions, lifecycle behavior, and historical definition snapshots.
- The shared append-only attachment model, supersession behavior, and migration of existing NFS-e PDF/XML references.
- Party-field keys, sections, visibility, suggestions, warnings, and custom fields.
- Field-set behavior and assurance that applying one never overwrites values.
- Import/export expectations for HTML templates.
- Historical snapshot behavior and the meaning of “Refresh party details.”
- Migration/backfill caveat for invoices created before snapshots existed.

## 22. Acceptance Criteria

The project is complete when all of the following are true:

- Issuer/customer forms no longer assume Brazilian tax or international-bank fields as fixed schema.
- Existing legal, address, contact, tax, and payment values are preserved as generalized fields.
- Users can add suggested fields, apply field sets, and create fully custom fields.
- Fields are organized into sections and can be rendered generically or accessed by key.
- Invoice party data is snapshotted and stable across later settings edits.
- Templates are reusable entities with immutable revisions.
- Customers can select a default template and drafts can override it.
- All selectors can filter by engine.
- HTML templates cannot be selected or rendered without configured Gotenberg.
- Configured but unhealthy Gotenberg produces a clear, non-destructive failure.
- React PDF works with no Gotenberg service.
- Built-in and user HTML templates use the same Liquid format.
- Customers can create multiple named Liquid text generators, including one active NFS-e-description generator.
- Text generators use the shared invoice document model, preserve literal plain text, and do not require Gotenberg.
- Saved generated text remains editable and does not change when its generator or current party settings change.
- Customers can configure generalized invoice record types with typed information fields and attachment rules.
- NFS-e metadata and files use the same invoice-record and attachment machinery as custom supporting records.
- Record definitions are snapshotted, attachment bytes remain append-only, and later customer configuration cannot reinterpret historical records.
- Applying generated text to a record field is explicit rather than an automatic side effect.
- Archived PDFs remain append-only, downloadable, and authoritative.
- Existing fixed-item and filename templates remain compatible, and legacy NFS-e templates/output migrate without silent data loss.
- Migrations, lifecycle behavior, both renderer paths, availability rules, and htmx validation fragments have automated coverage.

## 23. Recommended First Implementation Slice

Begin with generalized party fields and snapshots before adding template tables or Gotenberg. That slice fixes the current historical-regeneration weakness and establishes the shared document data model required by both engines.

The first pull-request-sized change should contain:

1. Party-field definitions and Zod schemas.
2. Additive JSON columns only.
3. Legacy-to-party-field backfill.
4. Read-only sectioned display plus tests.

Follow with the editable field UI and invoice snapshots. Introduce the shared Liquid core with generalized text generators before HTML PDF rendering. Avoid combining schema removal, dynamic field editing, text-generator migration, PDF template registry, and Gotenberg into one migration or change set.
