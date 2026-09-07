# Invoice

Invoice is a lightweight, self-hosted commercial-invoice workspace for a Brazilian PJ workflow. It stores data in SQLite and local files, generates commercial invoice PDFs, and keeps editable text and supporting NFS-e records beside each invoice.

This is a beta application. It has no built-in authentication. Run it on localhost or a trusted private LAN, or put it behind an authenticated reverse proxy (for example, Cloudflare Access) before allowing remote access. Do not publish port 3000 directly to the public Internet.

## Try it locally

Requirements: [Bun](https://bun.sh/) and a writable working directory.

```sh
bun install
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. On first use, configure the issuer, create a client, then create an invoice. See [the user guide](docs/user-guide.md).

## Run with Docker Compose

The default deployment uses React PDF and one app container:

```sh
mkdir -p data
chown -R 1000:1000 data
docker compose -f docker-compose.yml up --build -d
```

Both Compose files bind to `127.0.0.1` by default. Set `INVOICE_BIND_ADDRESS` to a trusted LAN interface only when you intend to allow network access. Remote access needs an authenticating proxy or private-network gateway.

For the optional HTML/Liquid renderer, start the private Gotenberg service:

```sh
docker compose -f docker-compose.yml -f compose.gotenberg.yml up --build -d
```

Gotenberg uses Chromium and needs substantially more memory and CPU than React PDF. It is not a fallback: an unavailable Gotenberg render fails clearly and does not alter the invoice or its archived PDF. See [self-hosting operations](docs/self-hosting.md) for configuration, backups, upgrades, and proxy guidance.

## Documentation

- [User guide](docs/user-guide.md)
- [Self-hosting and operations](docs/self-hosting.md)
- [PDF and text template reference](pdf_template_author_reference.md)
- [Contributing](CONTRIBUTING.md)

The longer specification and architecture files describe design history and implementation decisions; they are not a substitute for the operational guides above.
