# Beta readiness review

This is a working release checklist, not a statement that the beta has been published.

## Checkpoint

- Existing implementation committed and pushed as `23aeda9`.
- Existing release: `v0.1.2`. Proposed next release: `v0.2.0-beta.1`, pending maintainer choice. Public project name is also undecided; keep current identifiers until a name is approved.
- Repository currently private. The maintainer will make it public manually when preparation is complete; agents must not change visibility. Release publication separately requires explicit authorization.
- Do not push a release tag or manually dispatch the release workflow before explicit release authorization: both can publish artifacts.

## Required before approval

- [x] Audit application, deployment, and documentation using independent reviews.
- [x] Add non-publishing branch/pull-request CI.
- [x] Default Compose to loopback access and document intentional absence of built-in authentication.
- [x] Limit HTTP body size and reject explicit cross-site browser mutations.
- [x] Tighten supporting-record field validation and preserve submitted values after errors.
- [x] Bound record uploads and expose missing required attachments.
- [x] Surface incompatible saved Liquid templates without rewriting their source.
- [x] Draft README, operator/user guides, contribution guide, and issue templates.
- [x] Add the approved MIT license with Ariel Tamezgui Leventhal's copyright attribution.
- [x] Document approved AI policy: allow assistance with disclosure and human accountability.
- [x] Document the project story and maintainer-approved roadmap.
- [x] Document public issues for ordinary bugs and GitHub private vulnerability reporting for sensitive security reports.
- [ ] Maintainer enables and verifies GitHub private vulnerability reporting when making the repository public.
- [x] Verify fresh Docker install and persistent restart using isolated data (non-root, read-only root, tmpfs).
- [x] Verify upgrade from representative legacy data and optional real Gotenberg rendering.
- [ ] Complete final build, typecheck, tests, document/example review, and clean Git review.
- [x] Commit/push initial preparation changes and verify non-publishing GitHub CI.
- [ ] Review release notes and known limitations with maintainer.
- [ ] Obtain explicit authorization before release publication.

## Known scope decisions pending

Detailed current behavior, possible changes, effort, risk, and verification are in
[code improvement decisions](code-improvement-decisions.md). These are for later
maintainer review, not authorization to implement them or add roadmap commitments.

- Built-in authentication is deliberately future work; deploy on a trusted network or behind an authenticating proxy.
- Generated text has its own editable saved invoice fields. The maintainer does not want a separate generator-to-record linking feature; copying into a separate record is optional and manual.
- Legacy NFS-e columns/routes remain for compatibility. Removing them is a separate verified migration, not a prerequisite for preserving current data.
- Generator ordering/unarchive, PDF template archive management, selected-invoice template preview, and further UX improvements need explicit beta-versus-roadmap classification.
- Current container/executable build targets Linux amd64. Additional architectures are not yet a supported release artifact.
- Upload MIME checks validate declared types, not a malware scan or guarantee of file content.

## Verification evidence

- Preparation checkpoint: `0337113`. [Non-publishing CI](https://github.com/arieltl/invoice/actions/runs/34165806000) passed dependency installation, runtime asset build, typecheck, unit tests, and Linux executable compilation.
- Documentation/policy checkpoint: `c3a124d`. [Non-publishing CI](https://github.com/arieltl/invoice/actions/runs/34166419133) passed installation, runtime build, typecheck, tests, and executable compilation. Eleven public/review Markdown documents were checked for local file links with no missing targets.
- Local suite at that checkpoint: 136 passed, one optional Gotenberg integration test skipped. Representative legacy upgrade coverage is in `src/db/migrations.test.ts`; this does not claim verification against every existing installation.
- Isolated fresh Docker installation passed health and persistence checks across restart with a non-root user, read-only root filesystem, and writable tmpfs. Temporary test resources were removed.
- A separate real `gotenberg/gotenberg:8-chromium` container passed all six tests in `src/pdf/html/gotenberg-client.test.ts`, including Chromium PDF conversion, using `GOTENBERG_INTEGRATION_URL`. The temporary container was removed.
- These checks apply to the preparation checkpoint, not a future final release commit. Re-run relevant checks after further code or deployment changes.
- [Draft release notes](release-notes-beta.md) are for review only; name, version, code scope, and publication remain unapproved. MIT licensing and the documented policies have been approved.

## Release preparation

After scope and policy decisions: write the final release notes, select the prerelease version, and synchronize package/versioned deployment instructions. Build and test locally and in ordinary CI. Present the exact commit, tag, artifact expectations, and known limitations for approval. Do not create even a draft GitHub release before that approval.

## Maintainer launch handoff

This is a checklist for a later approved launch, not authorization to perform it.

1. Decide the public name and version, and review the code-improvement decision list. If renaming the repository or image, update links, image coordinates, package metadata, and deployment examples together.
2. Review repository contents and history for private customer information, credentials, and accidentally committed files before making it public. Documentation checks and unit tests are not a privacy audit.
3. The maintainer makes the repository public manually and enables private vulnerability reporting. Verify that the Security/Advisories reporting option is visible.
4. Explicitly authorize the exact release commit and tag. The tag workflow publishes a Linux amd64 Docker image and creates a GitHub release. It compiles an executable as a check but currently does not attach a downloadable binary to the release.
5. Verify release notes, prerelease status, and image coordinates. Confirm the beta did not move the stable `latest` image tag.
6. Verify anonymous access to the repository and the released container image from a logged-out/fresh environment. Do not assume that changing repository visibility alone proves image pull access.
7. Run the published Compose instructions against isolated data and verify startup, persistence, and an invoice PDF. Keep real data out of this smoke test.

Steps that publish artifacts or alter visibility remain gated by the maintainer's decisions. Until those gates are satisfied, no public installation verification is claimed.
