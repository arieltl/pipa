# Code improvement decisions

This is a decision list for the maintainer. It records observed behavior and
possible bounded changes; it does not authorize, schedule, or promise any of
them. “Beta blocker” and “defer” are recommendations pending maintainer
approval.

## Safeguards already added

The following are current behavior, not items awaiting a product decision:

- Compose binds the application to loopback by default, the root filesystem is
  read-only, and the data volume remains writable. README and the self-hosting
  guide match that behavior. See `docker-compose.yml`, `compose.yml`, and
  `docs/self-hosting.md`.
- Requests are capped at 20 MiB and explicitly cross-site browser mutations are
  rejected in `src/app.tsx`. Supporting-record files have an additional 10 MiB
  cap in `src/features/invoice-records/invoice-records.instances.ts`.
- Record values validate real dates, finite numbers, configured select choices,
  and HTTP(S) URLs. Required attachments are shown as incomplete; they do not
  block invoice issuance. Record files download with attachment disposition and
  `X-Content-Type-Options: nosniff`.
- Party and PDF presentation state is snapshotted for invoices; file replacement
  creates a new file record and preserves earlier bytes.
- Legacy Liquid generator sources that cannot be parsed and sample-rendered are
  shown as requiring review without rewriting the stored source.
- Invalid record-definition JSON is normalized to arrays before the Alpine
  editor re-renders a 422 response, so a syntactically valid object cannot break
  the editor's array operations. See `src/features/clients/clients.routes.tsx`.
- The project design, direction, and AI contribution policy are published in
  `docs/design.md`, `docs/roadmap.md`, and `AI_POLICY.md`.

## Decisions before a public beta

### Public deployment boundary and authentication

**Current behavior.** There are no users, sessions, or application-level access
control. The app relies on loopback/trusted-LAN placement or an authenticated
proxy. Cross-site mutation rejection is a CSRF mitigation, not authentication.

**Maintainer decision.** This boundary is intentional for beta. Keep the warning
prominent; built-in authentication is on the approved future roadmap.

**Benefit and risk.** The current approach is simple and suited to a personal
self-hosted tool. Adding auth later affects deployment, recovery, user
management, and every write route.

**Effort.** Documentation decision: small. Built-in auth: large.

**Release check.** Verify the documented trusted-network boundary. Do not treat
built-in auth as a pending beta implementation requirement.

**Verification needed.** Fresh Compose starts on loopback; proxy instructions
work for the selected deployment; README and user guide agree.

## Generalized records and text

### Generator-to-record linking — not pursued

Generated text already has its own editable saved invoice fields. Supporting
record instances are separate; text can be copied into them manually if needed.
The maintainer declined a separate linking feature because duplicating generated
text into another record is not needed for the intended workflow. Earlier plans
mentioned a target/apply action; that proposal is superseded and is neither a
beta requirement nor a roadmap commitment.

### Required attachment semantics

**Current behavior.** A record type can mark an attachment required. Missing
files show an “Incomplete” warning in the record card, and users can replace a
single-file attachment. Records remain editable after invoice issue and missing
files do not prevent issuing a commercial invoice.

**Proposed change.** Choose one contract: retain the present warning-only
meaning, or introduce an explicit record-completion/lifecycle rule. Do not
silently make commercial issuance fail without a documented workflow decision.

**Benefit and risk.** A chosen rule makes “required” predictable. A strict gate
could accidentally prevent a commercial invoice from being issued when an
external document arrives later.

**Effort.** Warning-only documentation: small. Record lifecycle/completion:
medium.

**Recommendation pending approval.** Keep warning-only for beta and state it in
the guide; defer lifecycle enforcement.

**Verification needed.** UI and route tests show incomplete state, replacement,
and behavior after issue; documentation describes the chosen meaning.

### Attachment type validation and malware boundary

**Current behavior.** Attachment categories validate the browser-declared MIME
type against configured allowed types. Paths are server-generated and downloads
use attachment disposition; the app does not inspect bytes or malware-scan.

**Proposed change.** Decide whether declared MIME type is sufficient for the
trusted-network beta. Possible later additions are magic-byte checks for a
small supported set, external malware scanning, and administrator-configured
file policies.

**Benefit and risk.** Stronger checking gives clearer type guarantees. It adds
format-specific complexity and cannot by itself make uploaded files safe.

**Effort.** Documented limitation: small. Magic-byte checks: medium. Malware
integration: large and operationally heavy.

**Recommendation pending approval.** Defer stronger inspection; retain the
clear limitation and size limits for beta.

**Verification needed.** If changed, tests use spoofed content/type pairs and
confirm downloads retain safe headers.

### Attachment history and file reconciliation

**Current behavior.** Replacements preserve prior file bytes and file metadata,
but the record card presents current attachments rather than a browseable
history. A filesystem write occurs before its metadata insert, so an unexpected
database failure can leave an unreferenced file on disk; no data is overwritten.

**Proposed change.** Optionally add an attachment-history view and a dry-run
administrator reconciliation command that reports orphaned files without
deleting them automatically.

**Benefit and risk.** History improves auditability; reconciliation helps
operators after exceptional failures. Any cleanup must remain conservative to
avoid deleting legitimate append-only files.

**Effort.** History: medium. Dry-run reconciliation: medium; destructive cleanup
requires a separate explicit decision.

**Recommendation pending approval.** Defer for beta.

**Verification needed.** Replacement history preserves hashes and links; a
dry-run neither modifies files nor DB rows; recovery fixtures cover a failed
metadata insert.

### Record and attachment concurrency

**Current behavior.** Attachment count is re-read inside a SQLite transaction
before inserting the new attachment. The record-type multiplicity rule is still
an application-level read-then-insert check, and the schema has no conditional
unique constraint for types that allow only one record.

**Proposed change.** Decide whether single-user SQLite usage makes the current
rule adequate. A later option is an explicit transaction/retry strategy for
record creation, with a database constraint where the model permits one.

**Benefit and risk.** It hardens rare simultaneous requests. Conditional
uniqueness is awkward because `allowMultiple` is configuration data and can
change after records exist.

**Effort.** Medium.

**Recommendation pending approval.** Defer for beta; document the single-user
self-hosted assumption.

**Verification needed.** Concurrent create tests verify at most one record for
non-multiple types and preserve behavior when configuration changes.

### Stable keys and unusual object property names

**Current behavior.** Record and custom party keys must begin with a letter, so
`__proto__` is rejected. Names such as `constructor` and `prototype` are still
syntactically valid and currently treated as ordinary JSON keys; no prototype
mutation path was found in the reviewed code.

**Proposed change.** Optionally reserve a short deny-list of JavaScript object
property names for user-defined keys and construct dynamic maps with
`Object.create(null)` where appropriate.

**Benefit and risk.** Defense in depth against future code using dynamic maps.
It can reject keys a user may already have created, so it needs a compatibility
decision.

**Effort.** Small to medium, depending on migration handling.

**Recommendation pending approval.** Defer; no confirmed exploit or data-loss
path was found.

**Verification needed.** Schema and migration tests cover reserved legacy keys
and normal template access.

## Template and generator management

### Generator ordering and unarchive

**Current behavior.** Generators have `position` and `archivedAt` columns.
Active and archived generators are displayed, but the UI has archive only; it
does not reorder or restore an archived generator.

**Proposed change.** Add explicit reorder controls and an unarchive action that
checks key and NFS-e-purpose uniqueness before restoring.

**Benefit and risk.** It improves long-lived client configuration. Restoring a
generator can conflict with a newer generator that adopted its key or purpose.

**Effort.** Medium.

**Recommendation pending approval.** Defer for beta unless users will maintain
many generators immediately.

**Verification needed.** Ordering persists; unarchive conflict is explained and
does not alter saved invoice text; archived generators cannot be selected for
new output.

### PDF template archive management

**Current behavior.** PDF templates have `archivedAt` and services reject an
archived template for new selection, but no archive/unarchive management action
is exposed in the template UI.

**Proposed change.** Add management controls with a clear rule: archives remain
renderable for invoices already pinned to their revisions while new invoices
cannot select them.

**Benefit and risk.** It lets operators retire designs safely. A mistaken archive
can confuse users without a clear restore path.

**Effort.** Medium.

**Recommendation pending approval.** Defer for beta; current built-ins and
revisions cover the primary workflow.

**Verification needed.** Existing invoice render/archive still works after a
template archive; selector hides it; restore behavior handles conflicts.

### Preview a template with a selected existing invoice

**Current behavior.** The template area renders representative sample data and
can generate a sample PDF. It does not let an operator choose an existing
invoice for preview.

**Proposed change.** Add a controlled invoice picker and render against the
safe document model, with no save, archive, or template-selection side effect.

**Benefit and risk.** It makes layout review more realistic. The picker exposes
real customer/payment data to anyone who can access the app, which is already
within the trusted-network boundary but should be visible in the UX.

**Effort.** Medium.

**Recommendation pending approval.** Defer for beta.

**Verification needed.** Preview has no writes, uses invoice snapshots rather
than current party defaults, and handles unavailable Gotenberg distinctly.

### Legacy NFS-e compatibility removal

**Current behavior.** Generalized records are used for new supporting-record
workflows. Legacy NFS-e tables, routes, and compatibility reads remain so old
data continues to work. The migration test verifies representative backfill and
does not rewrite archived file metadata.

**Proposed change.** After real-installation validation and backups, perform a
separate SQLite table-recreation migration to remove legacy columns/tables and
compatibility paths.

**Benefit and risk.** It simplifies the model and avoids two interfaces. The
risk is permanent loss of an overlooked legacy value or attachment relation.

**Effort.** Large.

**Recommendation pending approval.** Defer beyond beta; do not remove merely to
make the codebase look cleaner.

**Verification needed.** Backup/restore drill, production-shaped database copy,
full row/file-reference comparison, migration rollback plan, and generated PDF
comparison for historical invoices.

## Experience and onboarding

### Client configuration UX refinement

**Current behavior.** New and existing client screens use one vertical
workspace for overview, document details, billing, numbering, PDF appearance,
text generators, and supporting records. The document-field picker is local
Alpine behavior while persistence remains htmx-based. Validation now directs
the form to the section containing the first error.

**Proposed change.** Gather beta feedback before choosing focused improvements:
keyboard navigation in the picker, better empty states, section completion
status, draft recovery, and responsive density. Avoid a broad SPA rewrite unless
an observed workflow cannot be solved with the current server-rendered model.

**Benefit and risk.** Targeted refinement improves perceived quality without
weakening the local-first architecture. A broad restyle risks destabilizing
forms that already preserve unsaved values while switching sections.

**Effort.** Small per refinement; large for a complete redesign.

**Recommendation pending approval.** Defer broad redesign; collect beta
feedback and select bounded improvements.

**Verification needed.** Browser checks on create/edit, tab/keyboard flow,
mobile layout, htmx error recovery, and unsaved edits across section switches.

### First-run setup and guided onboarding

**Current behavior.** The user guide describes issuer setup, client creation,
and invoice creation. The application does not provide a dedicated first-run
checklist or setup wizard.

**Proposed change.** Consider a dismissible dashboard checklist for issuer,
client, numbering, and first invoice, linking to the existing pages rather than
duplicating their forms.

**Benefit and risk.** It shortens the path to a first usable invoice. A wizard
can obscure advanced configuration or create another stateful workflow to
maintain.

**Effort.** Medium.

**Recommendation pending approval.** Defer until beta feedback confirms setup
friction.

**Verification needed.** New database usability test, dismissal persistence
decision, accessibility review, and no interference with direct navigation.

## Operations and release engineering

### Fresh-install, upgrade, and final release verification

**Current behavior.** The beta checklist records an isolated fresh Docker
install/restart check, representative legacy migration coverage, a real
Gotenberg test, and a prior CI checkpoint. Those results apply to the named
checkpoint rather than automatically to a later release commit.

**Proposed change.** Before any release authorization, rerun build, typecheck,
unit tests, binary build, fresh container smoke test, representative upgrade,
and optional Gotenberg conversion against the exact proposed release commit.

**Benefit and risk.** It ties release evidence to the artifact users will run.
It requires local Docker/CI capacity but does not change product behavior.

**Effort.** Medium operational effort.

**Recommendation pending approval.** Beta blocker for release publication.

**Verification needed.** Record exact commit, commands, image tag/digest,
health check, persistent data restart, migration assertions, and result links in
the release checklist.

### Architecture support matrix

**Current behavior.** The compiled binary/container release path targets Linux
amd64. This is documented in the beta checklist and self-hosting guide.

**Proposed change.** Decide whether to keep amd64-only support for beta or add
arm64 build/release artifacts.

**Benefit and risk.** arm64 helps Raspberry Pi and Apple Silicon Linux hosts;
multi-architecture releases increase CI, native dependency, and image-testing
work.

**Effort.** Keep current scope: none. Add arm64: medium to large.

**Recommendation pending approval.** Defer arm64; state amd64 support clearly.

**Verification needed.** If added, build and run the exact image/binary on each
advertised architecture, including migrations and PDF rendering.
