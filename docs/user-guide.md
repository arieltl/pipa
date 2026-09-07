# User guide

## First setup

1. Open **Issuer settings** and enter details for new invoices.
2. Create a client. Client defaults seed future invoices and never rewrite historical ones.
3. Optionally configure the client's numbering profile, currency, recurring item, PDF template, text generators, and supporting record types.

## Create and issue an invoice

1. Choose **New invoice**, select a client, and choose the invoice date shown on the PDF.
2. Keep or remove the default fixed monthly item, then add or edit line items.
3. Review generated text and edit it before copying or saving it. Templates are helpers, not authoritative tax documents.
4. Preview or download the PDF. React PDF works everywhere; HTML / Gotenberg templates require a configured, available Gotenberg service.
5. A draft can be issued when its PDF can be archived. Issuing archives the PDF and locks the invoice document. Reverting to draft unlocks it. Other commercial statuses are **sent**, **paid**, and **void**; NFS-e linkage is separate metadata.

## NFS-e and supporting records

Commercial invoices are not Brazilian NFS-e documents. Use the NFS-e/supporting-record area to store external numbers, dates, verification details, notes, and PDF/XML or other attachments. Uploads use generated safe paths; new uploads supersede prior files without overwriting stored bytes.

Clients can define reusable text generators and invoice record types. A generator's output is editable for manual copy/paste. Integrated application of generated text to a record field is planned; nothing silently changes invoice data.

## Templates and historical data

PDF templates are revisioned. Saving an HTML template creates an immutable revision, and an invoice keeps its selected revision. See the [template reference](../pdf_template_author_reference.md) for Liquid syntax and variables.

Invoice party details and template choices are snapshotted so later settings changes do not silently rewrite the document. Archived PDFs remain authoritative; regenerating a PDF does not overwrite an archive.

## Numbering

Numbering profiles define reusable patterns and reset periods. Automatic numbering requires a sequence token and allocates each client's sequence transactionally. Manually chosen numbers must not collide.

## Data safety

This beta has no undo or account-level permissions. Restrict network access and back up the complete data directory. For backup, restore, upgrades, and deployment topology, read [self-hosting and operations](self-hosting.md).
