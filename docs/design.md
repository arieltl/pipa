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

React PDF is the built-in renderer and the lightweight default. It runs inside
the app and needs no additional service. HTML/Liquid templates use the same
constrained document model but are rendered through an optional private
Gotenberg service. Gotenberg provides a template-editing path with Chromium,
at a higher memory/CPU cost.

The engines are selected explicitly; neither silently substitutes for the other.
If a selected Gotenberg renderer is unconfigured or unavailable, the user sees the failure and
the invoice/archive state is left unchanged. Keep Gotenberg on the private
Compose network because rendered content contains invoice and payment data.

## Access boundary

Authentication is intentionally not implemented in the beta. The deployment
assumes localhost or a trusted private network; an authenticating reverse proxy or private
access gateway is required for remote access. Anyone who reaches the app can
read and mutate its data. Built-in authentication is a future roadmap item.
