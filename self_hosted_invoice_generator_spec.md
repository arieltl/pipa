# Self-Hosted Invoice Generator — Project Specification

## 1. Project goal

Build a simple, lightweight, self-hosted invoice generator focused on a Brazilian PJ developer workflow.

The main use case is generating one monthly invoice for a company/client in London, with support for occasional extra clients, freelance work, approved expenses, and later linking the corresponding Brazilian nota fiscal / NFS-e metadata and files.

The app should be simple, useful, pleasant to use, Docker Compose friendly, and lightweight in server RAM usage.

---

## 2. Main workflow

Typical monthly workflow:

1. Create invoice for a client.
2. Select the invoice date that should appear on the PDF.
3. App auto-generates the invoice number using the client's numbering rule.
4. App optionally adds the client's default fixed monthly service item.
5. Add approved expenses or other billable items if needed.
6. App generates a copyable nota fiscal description from a template.
7. Generate/download invoice PDF.
8. Send invoice to the client.
9. Issue nota fiscal outside the app.
10. Come back and link the nota fiscal number, verification URL, PDF, XML, or notes.
11. Mark invoice as sent/paid if desired.

Important distinction:

```text
Commercial invoice to foreign client != Brazilian nota fiscal / NFS-e
```

The app helps generate the commercial invoice and later stores the relationship to the official Brazilian nota fiscal.

---

## 3. Recommended tech stack

Recommended MVP stack:

```text
Runtime: Bun
Web framework: Hono
UI: server-rendered JSX + htmx
Database: SQLite
DB helper/ORM: Drizzle
SQLite driver: bun:sqlite
PDF generation: server-side @react-pdf/renderer
Storage: local filesystem
Deployment: Docker Compose
```

Avoid for MVP:

```text
Chromium
Puppeteer
Gotenberg
MinIO
S3
Postgres
Prisma
Full SPA architecture
```

Reasoning:

- No headless browser for PDF generation.
- No extra DB container.
- No local S3 service.
- Single app container.
- Simple `/data` volume.
- Type-safe TypeScript stack.
- React-style PDF authoring without Chromium.

High-level architecture:

```text
Browser
  -> htmx requests
Bun/Hono app
  -> Drizzle + SQLite
  -> local /data folder
  -> react-pdf for invoice PDFs
```

---

## 4. Core domain concepts

### 4.1 Client

The app should support multiple clients from the start.

Client fields:

```text
Name
Legal/company name
Client code
Address
Country
Email
Default currency
Default payment terms / notes, optional
Default fixed monthly value
Default fixed monthly item name template
Default nota fiscal description template
Default invoice PDF filename template
Invoice numbering profile
Created at
Updated at
```

Example client codes:

```text
LONDONCO
ACME
FREELA
```

The client code can be used in invoice numbers, PDF filenames, and templates.

---

### 4.2 Invoice

An invoice is the commercial invoice generated for a client.

The invoice does **not** need:

```text
Due date
Billing period
Period start
Period end
Tax fields
Discount fields
Quantity fields
```

The invoice only needs:

```text
Client
Invoice number
Invoice date shown on PDF, manually selectable
Actual DB creation date, stored automatically
Currency
Status
Items
Total
Generated/final nota fiscal description text
Optional archived PDF file
Created at
Updated at
```

Important:

```text
invoice_date = date shown on the generated PDF
created_at = actual database creation timestamp
```

These are different fields.

Example:

```text
Invoice date shown on PDF: 2026-06-30
Created in app at: 2026-06-20 22:14:08
```

---

## 5. Fixed monthly service item

Each client can have a default fixed monthly value, similar to a recurring monthly development service amount.

Example:

```text
Monthly software development services - June 2026
Amount: £X,XXX
```

This value is a client default, not a live reference.

Important behavior:

```text
Changing the client's default fixed monthly value only affects future invoices.
It must not affect historical invoices.
```

When an invoice is created, the app copies the current client default into an invoice item.

Good model:

```text
client.default_fixed_monthly_value = template/default for future invoices
invoice_items.value = historical concrete value for this invoice
```

---

## 6. Excluding the fixed monthly item

The fixed monthly service item should be included by default but excludable per invoice.

Create invoice option:

```text
[✓] Include default fixed monthly service item
```

If unchecked, the invoice starts without the recurring item.

Useful for:

```text
Expense-only invoices
Correction invoices
One-off freelance invoices
Special cases where base service is not billed
```

Even if included, the copied item name and value should be editable for that invoice only.

---

## 7. Templatable fixed monthly item name

The name/description of the fixed monthly invoice item should be templatable.

Example client template:

```text
{{client.name}} - Software development services - {{invoice.dateMonthName}} {{invoice.dateYear}}
```

Example output:

```text
London Client - Software development services - June 2026
```

Another possible template:

```text
Software development services - Invoice {{invoice.number}}
```

The generated item name should be copied into the invoice item at creation time. Later changes to the template should not mutate old invoices.

---

## 8. Invoice items

The invoice item model should be intentionally simple.

Each item only needs:

```text
Description/name
Value
Type/source, optional but useful
Notes, optional
Attachment, optional later
Created at
Updated at
```

No need for:

```text
Quantity
Unit price
Tax
Discount
Subtotal per quantity
```

The invoice PDF should show a simple item list and a total at the bottom.

Example:

| Item | Value |
|---|---:|
| Monthly software development services - June 2026 | £4,000.00 |
| Approved travel expense | £120.00 |
| Approved software subscription reimbursement | £30.00 |
| **Total** | **£4,150.00** |

Totals are calculated as:

```text
invoice.total = sum(invoice_items.value)
```

---

## 9. Per-client invoice numbering

Invoice numbering must be per client.

There should not be only one global sequence.

Examples:

```text
LONDONCO-2026-001
LONDONCO-202606-01
ACME-2026-001
FREELA-2026-06-01
```

---

## 10. Numbering profiles

Each client should use a numbering profile.

Supported rule types:

```text
Sequential per client
Yearly sequential per client
Monthly sequential per client
Date-based
Date + sequence
Manual override
```

Good default:

```text
{CLIENT_CODE}-{YYYYMM}-{SEQ:02}
```

Example:

```text
LONDONCO-202606-01
```

This supports one invoice per month while still allowing a second invoice in the same month:

```text
LONDONCO-202606-02
```

---

## 11. Numbering template tokens

Invoice number patterns should support tokens like:

```text
{CLIENT_CODE}
{YYYY}
{YY}
{MM}
{DD}
{YYYYMM}
{SEQ}
{SEQ:02}
{SEQ:03}
```

Sequence reset periods:

```text
never
yearly
monthly
daily
```

Internal period keys:

```text
never   -> all
yearly  -> 2026
monthly -> 2026-06
daily   -> 2026-06-20
```

Invoice number allocation should be transactional:

```text
BEGIN
  read sequence for client + profile + period
  generate invoice number
  insert invoice
  increment sequence
COMMIT
```

Enforce uniqueness:

```text
UNIQUE(client_id, invoice_number)
```

Optionally also enforce:

```text
UNIQUE(invoice_number)
```

Global uniqueness is recommended to avoid confusion.

---

## 12. Nota fiscal description templating

The app should include a simple templating engine for generating nota fiscal / NFS-e description text.

This is **not** an API integration. The output is just editable, copyable text.

UI behavior:

```text
Generate from template
Show editable text area
Copy button
Save final text to invoice
Regenerate from template if needed
```

The generated text should be copied/saved into the invoice. Later changes to the client template should not mutate old invoice text.

---

## 13. Nota fiscal template variables

The nota fiscal description template should support invoice number as a variable.

Useful variables:

```text
{{invoice.number}}
{{invoice.date}}
{{invoice.dateYear}}
{{invoice.dateMonth}}
{{invoice.dateMonthName}}
{{invoice.dateMonthNamePt}}
{{invoice.total}}
{{invoice.currency}}
{{client.name}}
{{client.legalName}}
{{client.country}}
{{client.code}}
{{issuer.name}}
{{issuer.legalName}}
{{items.summary}}
```

Example template:

```text
Prestação de serviços de desenvolvimento de software referente à invoice {{invoice.number}}, emitida em {{invoice.date}}, para cliente no exterior.
```

Example output:

```text
Prestação de serviços de desenvolvimento de software referente à invoice LONDONCO-202606-01, emitida em 30/06/2026, para cliente no exterior.
```

Another possible template:

```text
Serviços de desenvolvimento, manutenção e consultoria em software prestados para {{client.legalName}}, empresa localizada em {{client.country}}, conforme invoice {{invoice.number}}, no valor total de {{invoice.currency}} {{invoice.total}}.
```

The template engine can be simple variable interpolation. No need for loops or complex logic in the MVP.

---

## 14. Invoice PDF filename templating

The downloaded/generated invoice PDF filename should be templatable.

Example template:

```text
{{invoice.number}}_{{client.code}}_{{invoice.date}}.pdf
```

Example output:

```text
LONDONCO-202606-01_LONDONCO_2026-06-30.pdf
```

Another template:

```text
Invoice_{{invoice.number}}_{{client.name}}.pdf
```

The app should sanitize generated filenames to avoid invalid path characters.

Suggested filename variables:

```text
{{invoice.number}}
{{invoice.date}}
{{invoice.dateYear}}
{{invoice.dateMonth}}
{{invoice.dateMonthName}}
{{client.name}}
{{client.legalName}}
{{client.code}}
{{invoice.currency}}
{{invoice.total}}
```

---

## 15. Template engine design

Use a small and safe interpolation engine.

MVP behavior:

```text
Replace known {{variables}}
Leave unknown variables visibly unresolved or show validation warning
Escape/sanitize output depending on context
Do not execute arbitrary JS
Do not allow file path traversal in filename templates
```

Suggested template contexts:

```text
NotaFiscalDescriptionContext
FixedMonthlyItemNameContext
InvoicePdfFilenameContext
```

The same underlying interpolation helper can power all three.

Template examples:

```text
Fixed monthly item name:
Software development services - {{invoice.dateMonthName}} {{invoice.dateYear}}

Nota fiscal description:
Serviços de desenvolvimento de software conforme invoice {{invoice.number}}, emitida em {{invoice.date}}, para {{client.legalName}}.

PDF filename:
{{invoice.number}}_{{client.code}}_{{invoice.date}}.pdf
```

---

## 16. Linking nota fiscal later

After issuing NFS-e outside the app, the user can link it to the invoice.

Fields:

```text
Invoice ID
NFS-e / nota fiscal number
Issue date
Verification code
Public verification URL
Uploaded PDF
Uploaded XML
Notes
Created at
Updated at
```

The invoice detail page should show:

```text
NFS-e linked: yes/no
Number
Issue date
Verification link
PDF/XML attachments
```

---

## 17. PDF generation

Use server-side `@react-pdf/renderer`.

The PDF does not need to share web UI components.

Use a clean invoice view model:

```ts
type InvoicePDFData = {
  issuer: IssuerInfo
  client: ClientInfo
  invoice: InvoiceInfo
  items: InvoiceItem[]
  total: Money
  notaFiscal?: NotaFiscalInfo
}
```

The PDF should contain:

```text
Issuer information
Client information
Invoice number
Invoice date selected by user
Simple item list with values
Total at bottom
Payment/bank details, optional
Notes, optional
Linked nota fiscal metadata, optional
```

The PDF does not need:

```text
Due date
Period start/end
Taxes
Discounts
Quantity
Unit price
```

---

## 18. Regenerate vs archive PDFs

Default behavior:

```text
Invoice data is the source of truth.
PDF can be regenerated on demand.
```

Optional archival behavior:

```text
Archive exact PDF that was sent.
Never overwrite archived PDFs.
```

This allows:

```text
Download regenerated PDF
Archive/freeze exact sent PDF
```

Archived PDF metadata:

```text
File ID
Invoice ID
Template version
Generated at
SHA-256
Path
```

---

## 19. Local filesystem storage

Use local filesystem storage mounted through Docker Compose.

Recommended layout:

```text
/data
  app.db
  files/
    generated/
      invoices/
    archived/
      invoices/
        2026/
    nfse/
      2026/
    attachments/
      expenses/
  tmp/
```

No S3/MinIO/Garage for MVP.

---

## 20. Filesystem safety strategy

Use reasonable protection without making the stack complex.

Use:

```text
Non-root container user
Read-only container root filesystem
Only /data writable
/tmp as tmpfs
SHA-256 for stored files
No overwrite policy
Logical deletes
Backups of /data
Optional immutable archived files
```

Docker Compose hardening example:

```yaml
services:
  invoice:
    image: your-invoice-app:latest
    container_name: invoice
    restart: unless-stopped

    user: "1000:1000"
    read_only: true

    ports:
      - "3000:3000"

    environment:
      - DATA_DIR=/data
      - DB_PATH=/data/app.db
      - FILES_DIR=/data/files
      - TMP_DIR=/tmp

    volumes:
      - ./data:/data

    tmpfs:
      - /tmp:size=64m,mode=1777

    security_opt:
      - no-new-privileges:true

    cap_drop:
      - ALL
```

Host setup:

```bash
mkdir -p ./data/files ./data/tmp
sudo chown -R 1000:1000 ./data
```

SQLite note:

```text
Do not make /data read-only.
SQLite needs to write app.db, app.db-wal, and app.db-shm.
```

---

## 21. File immutability rules

App-level rules:

```text
Never overwrite stored files
Always write to temp file first
Calculate sha256
Move atomically into final path
Store metadata in SQLite
Use logical delete instead of physical delete
Archived files are superseded, not replaced
```

For official/sent files:

```text
Archive
Supersede
Void
Detach
```

Avoid normal destructive delete in the UI.

Optional host-level hardening for important archived PDFs:

```bash
sudo chattr +i ./data/files/archived/invoices/2026/LONDONCO-202606-01.pdf
```

Remove immutability manually if needed:

```bash
sudo chattr -i ./data/files/archived/invoices/2026/LONDONCO-202606-01.pdf
```

This is optional and should not be required for normal app operation.

---

## 22. Database stack

Use SQLite with Drizzle.

Recommended:

```text
Drizzle schema
Drizzle migrations
bun:sqlite driver
Repository/helper layer
Domain logic outside DB layer
```

Avoid Prisma for this app because it is heavier than needed.

---

## 23. Suggested database tables

Suggested tables:

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
expense_attachments
```

---

## 24. Suggested schema details

### issuer_settings

```text
id
name
legal_name
cnpj
address
email
bank_details
pix_key
default_currency
default_pdf_filename_template
created_at
updated_at
```

### clients

```text
id
name
legal_name
code
address
country
email
default_currency
default_fixed_monthly_value
default_fixed_monthly_item_name_template
default_nfse_description_template
default_pdf_filename_template
numbering_profile_id
created_at
updated_at
```

### numbering_profiles

```text
id
name
pattern
reset_period
created_at
updated_at
```

Example:

```text
pattern: {CLIENT_CODE}-{YYYYMM}-{SEQ:02}
reset_period: monthly
```

### invoice_number_sequences

```text
id
client_id
numbering_profile_id
period_key
next_sequence
created_at
updated_at
```

Unique key:

```text
UNIQUE(client_id, numbering_profile_id, period_key)
```

### invoices

```text
id
client_id
invoice_number
status
invoice_date
currency
total
final_nfse_description_text
include_default_fixed_monthly_item
archived_pdf_file_id
created_at
updated_at
```

Notes:

```text
invoice_date = manually selected date shown on PDF
created_at = actual creation timestamp stored by DB/app
```

`include_default_fixed_monthly_item` records what happened at creation, but totals come from `invoice_items`.

### invoice_items

```text
id
invoice_id
type
name
value
currency
source
notes
created_at
updated_at
```

Possible `type` values:

```text
fixed_monthly_service
expense
extra_work
adjustment
other
```

Possible `source` values:

```text
client_default
manual
expense
adjustment
```

### nota_fiscal_links

```text
id
invoice_id
nf_number
issue_date
verification_code
public_url
pdf_file_id
xml_file_id
notes
created_at
updated_at
```

### files

```text
id
kind
original_filename
stored_path
mime_type
size_bytes
sha256
created_at
deleted_at
superseded_by_file_id
```

---

## 25. UI pages

### Dashboard

Show current/recent invoices.

Example card:

```text
June 2026 - London Client
Invoice: LONDONCO-202606-01
Invoice date: 2026-06-30
Total: £4,150.00
Status: Draft / Sent / NFS-e linked / Paid
```

Actions:

```text
Create invoice
Add item
Download PDF
Archive PDF
Link nota fiscal
Mark sent
Mark paid
```

---

### Client settings

Manage:

```text
Client details
Default fixed monthly value
Default fixed monthly item name template
Default nota fiscal template
Default PDF filename template
Invoice numbering profile
Currency
```

Changing defaults only affects future invoice creation.

---

### Invoice detail

Show:

```text
Invoice number
Client
Invoice date shown on PDF
Actual created_at timestamp
Items
Total
Generated/final nota fiscal description text
PDF actions
Nota fiscal link status
Payment/status
```

Actions:

```text
Add item
Edit item
Remove item
Regenerate NFS-e description
Copy NFS-e description
Download PDF
Archive PDF
Link NFS-e
Upload NFS-e PDF/XML
Mark sent
Mark paid
```

---

### Create invoice flow

Fields/options:

```text
Client
Invoice date shown on PDF
Currency
Include default fixed monthly service item? yes/no
Numbering profile / auto number
Manual invoice number override
```

On create:

```text
1. Allocate invoice number per client
2. Copy current client fixed monthly item if enabled
3. Render fixed monthly item name template
4. Render current client nota fiscal template
5. Save editable final nota fiscal description on invoice
6. Create invoice as draft
7. Store actual created_at timestamp
```

---

## 26. Project structure

Suggested structure:

```text
src/
  server.ts

  db/
    client.ts
    schema.ts
    migrations/
    repositories/
      clients.ts
      invoices.ts
      files.ts
      numbering.ts

  domain/
    invoice-number.ts
    invoice-totals.ts
    invoice-view.ts
    template-engine.ts
    nfse-template.ts
    filename-template.ts
    money.ts
    dates.ts

  pages/
    layout.tsx
    dashboard.tsx
    clients/
    invoices/
    settings/

  pdf/
    invoice-pdf.tsx
    render-invoice-pdf.tsx

  files/
    storage.ts
    local-file-store.ts

  routes/
    clients.ts
    invoices.ts
    files.ts
    settings.ts
```

---

## 27. Important design principles

### Historical invoices are stable

Client defaults are only defaults.

Once an invoice is created:

```text
Invoice number is copied
Invoice date is stored
Fixed monthly item name is rendered and copied
Fixed monthly amount is copied
Line items are concrete records
NFS-e description text is rendered and copied
PDF can be archived
```

Later changes to client settings should not mutate old invoices.

---

### Generated text is editable

Nota fiscal description generation is a helper, not an authority.

```text
Template -> generated text -> user can edit -> saved final text
```

---

### Files are append-only by default

Do not overwrite official files.

```text
New upload = new file record
Correction = supersede old file
Delete = logical delete
```

---

### Keep domain logic portable

Business logic should not be tangled with Hono, htmx, Drizzle, or react-pdf.

Keep these separate:

```text
Invoice numbering
Invoice totals
Template rendering
Filename rendering
File naming
Status transitions
```

This makes a future Go rewrite or PDF engine replacement much easier.

---

## 28. Final MVP definition

The MVP should include:

```text
Client management
Per-client invoice numbering profiles
Manual invoice date shown on PDF
Actual DB created_at timestamp
Monthly invoice creation
Optional inclusion of fixed monthly service item
Templatable fixed monthly item name
Editable simple invoice items with value only
Total calculated as sum of item values
Editable generated nota fiscal description text
Invoice number available in nota fiscal template
Templatable PDF download filename
PDF invoice generation with react-pdf
Local filesystem storage
Nota fiscal number/link/PDF/XML linking
Invoice statuses
SQLite persistence
Docker Compose deployment
Basic filesystem hardening
```

Recommended MVP stack:

```text
Bun + Hono + htmx + server-rendered JSX
Drizzle + SQLite via bun:sqlite
server-side @react-pdf/renderer
local /data filesystem storage
single Docker container
Docker Compose
```

This gives a simple, lightweight, self-hosted invoice tool that matches the current PJ workflow while leaving room for future features.
