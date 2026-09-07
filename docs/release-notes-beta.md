# Beta release notes — draft

Not published. Proposed version: `v0.2.0-beta.1`, pending maintainer approval. These notes describe the current implementation, not a promise that every item in the development plans is complete.

## What is included

- A self-hosted commercial invoice workflow with client defaults, reusable numbering profiles, line items, and draft/issued/sent/paid/void statuses.
- Configurable client and issuer document fields, with invoice snapshots that preserve historical details when defaults change.
- Revisioned PDF templates, built-in React PDF rendering, and optional Liquid HTML templates rendered through Gotenberg.
- Per-client text generators with editable output and configurable supporting records with fields and attachments.
- Append-only stored files and archived PDFs when issuing an invoice.
- An interactive server-rendered settings UI using htmx and Alpine, without a full SPA.
- Docker Compose deployment, operator documentation, contribution guidance, and non-publishing CI.

## Deployment and security boundaries

There is **no built-in authentication**. Anyone who can reach the app can read and change its data. Keep it on a trusted network or behind an authenticating proxy; do not expose it directly to the public internet. Compose binds to loopback by default. Cross-site request checks are a safeguard, not access control.

Published deployment artifacts target Linux amd64. HTML PDF rendering requires the optional Gotenberg service, which should remain private to the application network. The built-in renderer does not require Gotenberg.

The app caps request bodies at 20 MiB and supporting-record attachments at 10 MiB each. Upload type checks use declared MIME types; files are not malware-scanned.

## Known limitations

- Generated text is copied into supporting records manually; automatic application is not implemented.
- Some template/generator management conveniences and further settings UI polish remain unfinished. Final roadmap classification is pending.
- Legacy NFS-e routes/data remain for compatibility. The app stores supporting information; it does not issue government NFS-e documents.
- Missing required record attachments are shown as incomplete but do not prevent commercial invoice issuance.
- No multi-user permissions, built-in backup scheduler, or general undo facility.

## Installation and upgrades

Follow the [self-hosting guide](self-hosting.md). Until this beta is actually published, use a source build to evaluate this implementation: the currently documented prebuilt `0.1.2` image predates it.

Before upgrading, stop the app and back up the complete data directory, including the database and stored files. Startup runs migrations. Test restoring a backup; an application rollback may also require restoring the matching pre-upgrade data. Never test migrations against your only copy of production data.

## Release review still required

The maintainer selected MIT; copyright attribution still needs confirmation before adding the license. The [AI contribution policy](../AI_POLICY.md), project narrative, and [approved roadmap](roadmap.md) are documented. The security reporting channel and final version remain pending. Verification evidence and approval gates are tracked in the [beta readiness checklist](beta-readiness.md).

No release tag, GitHub release (including drafts), registry publication, or repository visibility change is authorized by these notes.
