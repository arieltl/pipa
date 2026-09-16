# Design guide

This document describes Pipa's current implementation and the constraints
that keep the beta small to operate. The product motivation is described in
the [README](../README.md); this guide is about technical decisions.

## Server-rendered workflow

The app runs on Bun with Hono and renders HTML with Hono JSX. htmx handles
server-backed validation, mutations, recalculation, and fragment replacement;
page navigation receives full HTML pages. Interactive forms still rely on JavaScript. Alpine.js is kept for
local-only state such as tabs, disclosure panels, dropdowns, and copy feedback.
There is no SPA or separate API required for the main workflow.

Feature folders separate routes, services, repositories, and components.
Domain modules hold portable rules such as money, numbering, status
transitions, templates, and file naming. This keeps business behavior out of
HTTP handlers and makes it testable without a browser.

## Local persistence

SQLite and a filesystem under `DATA_DIR` avoid database, object-storage, and
service administration for a small self-hosted installation. SQLite uses
integer minor units for money, ISO dates/timestamps, foreign keys, and WAL
mode. Stored files use generated safe paths, hashes, atomic writes, and
append-only records; the original upload name is metadata rather than a path.

The database and files are one dataset and must be backed up together. See the
[self-hosting guide](self-hosting.md).

## Historical document stability

Creating an invoice copies the relevant client/issuer values and resolves a
PDF template revision. Later settings changes therefore do not silently alter
the invoice document. Issuing an invoice crosses a dedicated lock boundary:
the PDF is archived and document editing stops; reverting to draft unlocks it.

PDF template revisions are immutable. Archived PDFs and supporting uploads are
never overwritten; a replacement is a new file record that can supersede the
old one. This preserves the historical artifact even when a current preview
is regenerated.

## PDF engines

React PDF is the built-in renderer and the lightweight default. It needs no
additional service. HTML/Liquid templates use the same
constrained document model but are rendered through an optional private
Gotenberg service. Gotenberg provides a template-editing path with Chromium,
at a higher memory/CPU cost.

The engines are selected explicitly; neither silently substitutes for the other.
If a selected Gotenberg renderer is unconfigured or unavailable, the user sees the failure and
the invoice/archive state is left unchanged. Keep Gotenberg on the private
Compose network because rendered content contains invoice and payment data.

### Template packages

Editable templates use one package model: an `index.html` entry for HTML/Liquid
or `index.tsx` for React PDF, plus supporting files. A single-file template is
the same model with only its entry document. Import and export select plain
text or ZIP automatically; users do not choose an internal template type.

Each saved revision captures the complete package. Existing single-file
revisions are adapted when read, without rewriting historical rows. Previewing
an unsaved package does not create a revision or change an invoice. The editor
and invoice renderer use the same package-resolution rules.

Dependencies belong to the package that contains them. Local assets and Liquid
`render` partials cannot reach other templates, application files, or remote
resources. See the [template reference](../pdf_template_author_reference.md)
for the supported file types and authoring rules.

### Editable React PDF

The original compiled Classic renderer remains available for historical
revisions. Duplicating Classic creates a source package that can be edited and
saved through the same workspace as HTML templates. New React packages receive
the renderer-neutral invoice document model.

Template JavaScript runs inside QuickJS compiled to WebAssembly, with execution
and memory limits. It receives a small React/PDF authoring API and package-local
modules, without Bun, Node, filesystem, or network capabilities. The application
does not evaluate template JavaScript in its host runtime. The sandbox produces
a bounded document tree; the host validates it before constructing React PDF
elements. Image resources must belong to the template or use supported raster
data URLs. This is a restricted authoring environment, not a general React app
or an arbitrary npm dependency loader.

The QuickJS runtime is bundled into the application, including compiled
executables. It does not require a separate renderer service. HTML/Liquid still
uses optional Gotenberg, and neither engine falls back to the other.

## Access boundary

Authentication is intentionally not implemented in the beta. The deployment
assumes localhost or a trusted private network; an authenticating reverse proxy or private
access gateway is required for remote access. Anyone who reaches the app can
read and mutate its data. Built-in authentication is a future roadmap item.
