# Invoice

Invoice is a lightweight, self-hosted commercial-invoice workspace for Brazilian PJ developers who invoice foreign companies. Existing free invoicing software can be more elaborate than a low-volume monthly workflow needs, while separate notes and documents make it harder to keep the supporting material needed for Brazilian bookkeeping together. This project focuses on repeatable invoices and the editable messages and records that accompany them.

It is intended for developers, freelancers, and tiny software houses sending recurring or occasional commercial invoices. It stores data in SQLite and local files, generates commercial invoice PDFs, and keeps editable text and supporting NFS-e records beside each invoice.

The invoice PDF is only part of that monthly routine. Reusable text templates can help prepare an email to a client, a message, or a note for a bookkeeper using invoice information, while supporting records keep related details and attachments together. Generated text stays editable; the app does not send messages or submit tax documents on your behalf.

This is a beta application. It has no built-in authentication. Run it on localhost or a trusted private LAN, or put it behind an authenticated reverse proxy (for example, Cloudflare Access) before allowing remote access. Do not publish port 3000 directly to the public Internet.

## Try it locally

Requirements: [Bun](https://bun.sh/) and a writable working directory.

```sh
bun install
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. On first use, configure the issuer, create a client, then create an invoice. See [the user guide](docs/user-guide.md).

The current beta includes basic client and invoice editors, reusable text generators, numbering profiles, PDF generation, revisioned PDF templates, and local supporting records/files. It does not provide tax compliance advice or replace the official Brazilian NFS-e process.

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
- [Roadmap](docs/roadmap.md)
- [Design guide](docs/design.md)
- [AI contribution policy](AI_POLICY.md)
- [Security and reporting](SECURITY.md)

The longer specification and architecture files describe design history and implementation decisions; they are not a substitute for the operational guides above.

## License

[MIT](LICENSE) — Copyright (c) 2026 Ariel Tamezgui Leventhal.
