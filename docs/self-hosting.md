# Self-hosting and operations

For personal use on your computer, including the compiled executable, see the
[desktop-use guide](desktop.md).

## Install from GHCR

Pipa's repository is [arieltl/pipa](https://github.com/arieltl/pipa). The existing
GHCR package remains `ghcr.io/arieltl/invoice` so the repository rename does not
require an image migration. Compose service names and `INVOICE_*` settings are
unchanged.

The standard installation uses the prebuilt GHCR image in `compose.yml`; no
local build is needed. Obtain the Compose files from the repository, prepare
the writable data directory as described in the [README](../README.md), then run:

```sh
docker compose -f compose.yml pull
docker compose -f compose.yml up -d
```

For optional Gotenberg, include `-f compose.gotenberg.yml` after `-f compose.yml`
on both commands. Use that same file combination for later lifecycle commands.
`docker-compose.yml` is the alternative source-build stack for development and
testing unreleased changes, not the default installation path.

## Security boundary

The beta has no user accounts, sessions, or application-level access control. Anyone who can reach the app can read and change its invoices, client data, templates, and uploaded files. Keep it on localhost or a trusted LAN. For remote access, bind the app to loopback and use an authenticated reverse proxy such as Cloudflare Access, basic auth, or an equivalent private-network gateway. TLS and proxy access policy are deployment responsibilities.

Do not expose Gotenberg to the host or public network. The Compose override addresses it by its private service name. Rendered documents include invoice, customer, issuer, and payment data.

## Configuration

Copy `.env.example` for local overrides. Important settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `INVOICE_HOST` | `127.0.0.1` directly; `0.0.0.0` inside Docker | Application listener; executable `--host` overrides it |
| `INVOICE_BIND_ADDRESS` | `127.0.0.1` in Compose | Host interface for the published Docker port |
| `INVOICE_IMAGE_TAG` | `0.1.2` in prebuilt Compose | Image tag to deploy |
| `DATA_DIR` | `./data` (dev), `/data` (Docker) | Persistent data root |
| `DB_PATH` | `${DATA_DIR}/app.db` | SQLite database path |
| `FILES_DIR` | `${DATA_DIR}/files` | Archived PDFs and uploaded files |
| `TMP_DIR` | `./data/tmp` (dev), `/tmp` (Docker) | Temporary/runtime files |
| `GOTENBERG_URL` | empty | Optional HTML-to-PDF service |
| `GOTENBERG_TIMEOUT_MS` | `15000` | Gotenberg request timeout |

The container runs as UID/GID `1000:1000`; the bind-mounted data directory must be writable by that user. SQLite needs the data directory writable for its database, WAL, and SHM files. The published image currently targets Linux `amd64`.

Docker listens on `0.0.0.0` **inside the container** so port publishing works;
Compose still publishes on host loopback by default. For direct execution, the
default listener is `127.0.0.1`; `--host 0.0.0.0` deliberately enables network
access. These listener options apply to the current source, not older releases.

When running Bun directly, DB/files/tmp defaults follow `DATA_DIR` unless overridden individually. Compose supplies its own container paths, including `/tmp` on tmpfs, and uses a read-only root filesystem. Set `INVOICE_IMAGE_TAG` to a published version when using `compose.yml`; its current `0.1.2` default predates the new beta features. The beta image will be available only after an approved release. Building from source is optional for testing unreleased changes. Private images require authorized GHCR access; anonymous pull access must be verified at public launch.

HTTP requests are limited to 20 MiB and individual supporting-record attachments to 10 MiB. Declared MIME types are checked against each attachment category; files are not malware-scanned. Missing required attachments appear as an incomplete record and do not prevent issuing a commercial invoice. Browser mutations explicitly originating from another site are rejected; this is not authentication.

## Backups and restore

Back up the SQLite database and `data/files` together. Stop the app, copy the complete `data/` directory to protected storage, then start it again:

```sh
docker compose -f compose.yml stop invoice
cp -a data data.backup-$(date +%Y%m%d-%H%M%S)
docker compose -f compose.yml start invoice
```

Keep backups private because they contain client and payment data. Test a restore on a separate directory before relying on it; never overwrite a production data directory while testing.

To restore a backup, stop the same Compose stack you normally use, move the current directory out of the way, copy the backup into `data/`, repair ownership, and start that stack:

```sh
docker compose -f compose.yml stop invoice
mv data data.before-restore-$(date +%Y%m%d-%H%M%S)
cp -a data.backup-20260907-120000 data
chown -R 1000:1000 data
docker compose -f compose.yml start invoice
```

Replace the backup directory name and Compose file with the exact source-build or prebuilt stack you were running. Keep the moved directory until the restored app has been checked.

## Upgrades and migrations

Back up the complete data directory before upgrading. On startup the app runs pending Drizzle migrations and idempotent built-in seeds. With a source checkout, run `bun run db:migrate` explicitly when desired; with Docker, pull/build the new image and run `docker compose ... up -d`, which recreates the container if needed and performs migrations.

For the standard GHCR installation, set `INVOICE_IMAGE_TAG` in `.env` to the
chosen published version, then run `docker compose -f compose.yml pull` and
`docker compose -f compose.yml up -d`. Include the Gotenberg override if you use
it. There is no `--build` step.

For the beta, keep the previous image or source checkout until the new version has started successfully and the backup is verified. If a migration fails, stop the new container and restore the backup rather than editing database files manually. Prefer a pinned image tag or digest instead of `latest`.

## Health and troubleshooting

```sh
curl http://localhost:3000/healthz
```

The endpoint should return JSON with `status: "ok"`. It does not verify Gotenberg. The PDF templates screen reports Gotenberg as unconfigured, healthy, or unavailable; React PDF remains usable without it.

- Permission errors: make `data/` writable by UID/GID 1000:1000.
- Port in use: change `PORT` and the host-side Compose port.
- HTML template unavailable: check Gotenberg health and `GOTENBERG_URL=http://gotenberg:3000`.
- Missing source assets: run `bun run build` before starting the server.
