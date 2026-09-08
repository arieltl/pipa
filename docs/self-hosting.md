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

Keep Gotenberg private. The bundled Compose override does not publish its port;
it addresses the service by its private Docker name. If using a separate
instance, restrict access to the machines that need it. Rendered documents
include invoice, customer, issuer, and payment data.

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

## Gotenberg: HTML-to-PDF rendering

Gotenberg is optional. The built-in React PDF renderer needs no separate
service. Configure Gotenberg through environment variables; there is currently
no UI form for changing its address. These instructions describe the current
source; the published `0.1.2` image predates this functionality.

### Use the bundled Docker service

From the directory containing the Compose files:

```sh
docker compose -f compose.yml -f compose.gotenberg.yml pull
docker compose -f compose.yml -f compose.gotenberg.yml up -d
```

The override starts `gotenberg/gotenberg:8-chromium` and sets Pipa's connection
to `http://gotenberg:3000`. The service name is the hostname; `3000` is its
internal port. Gotenberg's port is not published to the host. Compose waits for
its health check before starting Pipa. Include both Compose files in subsequent
start, stop, and update commands for this setup.

### Connect to an existing Gotenberg instance

Set the base URL, including protocol and port, in the `.env` file beside your
Compose file. For example, for an instance on a trusted private network:

```dotenv
GOTENBERG_URL=http://192.168.1.20:3001
GOTENBERG_TIMEOUT_MS=30000
```

Replace the example address with one reachable **from Pipa's container**. Use
HTTP or HTTPS. Supply the base URL, not `/health` or the conversion endpoint;
Pipa appends those paths itself. There is no separate Gotenberg port variable.

Apply the settings with:

```sh
docker compose -f compose.yml up -d
```

Do **not** include `compose.gotenberg.yml` for this configuration: that override
sets `GOTENBERG_URL=http://gotenberg:3000`, replacing your custom address.
If changing from the bundled service, stop the old two-file stack first, then
start the single-file configuration. Do not delete your data directory.

Inside Docker, `localhost` means the **Pipa container**, not your computer or
another container. Use a service hostname on a shared Docker network, or an
appropriate reachable host address. Keep access restricted; do not expose
Gotenberg publicly to make the connection work.

### Configure the standalone binary or Bun server

Use the same variables in the environment that launches Pipa. For example,
when Gotenberg is reachable on your computer at port 3001:

```sh
GOTENBERG_URL=http://127.0.0.1:3001 \
GOTENBERG_TIMEOUT_MS=30000 \
./dist/invoice
```

Keep your usual `DATA_DIR`, `DB_PATH`, `FILES_DIR`, and `TMP_DIR` settings and
working directory when running this command; do not accidentally switch to a
different database. For a source run, use `bun run start` in place of
`./dist/invoice`. Stop and restart the process after changing its environment.
In this direct-run case, `127.0.0.1` refers to the computer running Pipa.

### Choose a template and verify the connection

- Open **PDF templates** to see the connection status: unconfigured, connected,
  unavailable, or invalid configuration.
- Choose an **HTML/Gotenberg** template for the client or draft invoice you
  want to render. Setting the URL does not change existing template selections.
- Generate a sample PDF or preview an invoice to verify an actual conversion;
  a successful health check alone does not prove rendering works.
- If rendering fails, Pipa reports the error. It does not silently substitute
  another renderer, archive a failed PDF, or advance the invoice's issue status.

`GOTENBERG_TIMEOUT_MS` defaults to `15000` (15 seconds) and accepts integer
values from `1000` to `120000` (1–120 seconds). Health checks use at most five
seconds. The template screen may cache connection status for ten seconds.

To disable Gotenberg, leave `GOTENBERG_URL` empty and restart/recreate Pipa.
Remove the bundled override if you were using it, since it supplies a URL.
React PDF templates remain usable; invoices pinned to HTML templates still
need Gotenberg to render again. Existing archived PDFs are not removed.

### Troubleshooting

- **Invalid configuration:** check the HTTP(S) base URL and timeout range.
- **Connection refused or unavailable:** check the hostname and port from
  Pipa's network, Gotenberg's health, and any firewall rules. A URL working in
  your browser does not prove it is reachable from a container.
- **Your custom URL is ignored:** check whether `compose.gotenberg.yml` is
  still included and whether Pipa was recreated after the environment change.
- **Conversion times out:** check Gotenberg's logs and available memory/CPU;
  increase the timeout within the supported range if necessary.
- **Pipa's health endpoint is OK but HTML rendering fails:** `/healthz` checks
  the app, not Gotenberg. Check **PDF templates** and attempt a sample conversion.

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
