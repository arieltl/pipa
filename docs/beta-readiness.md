# Beta readiness review

This is a working release checklist, not a statement that the beta has been published.

## Checkpoint

- Existing implementation committed and pushed as `23aeda9`.
- Existing release: `v0.1.2`. Proposed next release: `v0.2.0-beta.1`, pending maintainer choice.
- Repository currently private. Visibility changes and release publication await maintainer direction.
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
- [ ] Finalize license and copyright attribution with maintainer.
- [ ] Finalize AI policy, project story, roadmap, and security reporting channel.
- [x] Verify fresh Docker install and persistent restart using isolated data (non-root, read-only root, tmpfs).
- [ ] Verify upgrade from representative legacy data and optional real Gotenberg rendering.
- [ ] Complete final build, typecheck, tests, document/example review, and clean Git review.
- [ ] Commit/push preparation changes and verify non-publishing GitHub CI.
- [ ] Review release notes and known limitations with maintainer.
- [ ] Obtain explicit authorization before release publication.

## Known scope decisions pending

- Built-in authentication is deliberately future work; deploy on a trusted network or behind an authenticating proxy.
- Text generation and supporting records work separately; copying generated text into record fields is manual today.
- Legacy NFS-e columns/routes remain for compatibility. Removing them is a separate verified migration, not a prerequisite for preserving current data.
- Generator ordering/unarchive, PDF template archive management, selected-invoice template preview, and further UX improvements need explicit beta-versus-roadmap classification.
- Current container/executable build targets Linux amd64. Additional architectures are not yet a supported release artifact.
- Upload MIME checks validate declared types, not a malware scan or guarantee of file content.

## Release preparation

After scope and policy decisions: write the final release notes, select the prerelease version, and synchronize package/versioned deployment instructions. Build and test locally and in ordinary CI. Present the exact commit, tag, artifact expectations, and known limitations for approval. Do not create even a draft GitHub release before that approval.
