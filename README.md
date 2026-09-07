# Invoice

Lightweight, self-hosted invoice generation for a Brazilian PJ workflow. The
application runs with Bun, Hono, SQLite, local file storage, and React PDF.

## Development

```sh
bun install
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>.

## Docker

React PDF is the lightweight default and needs only the invoice container:

```sh
mkdir -p data
chown -R 1000:1000 data
docker compose -f docker-compose.yml up --build -d
```

To enable HTML/Liquid PDF templates, add the private Gotenberg service:

```sh
docker compose -f docker-compose.yml -f compose.gotenberg.yml up --build -d
```

For the prebuilt image in `compose.yml`, use the same override:

```sh
docker compose -f compose.yml -f compose.gotenberg.yml up -d
```

The override sets `GOTENBERG_URL=http://gotenberg:3000`, waits for its health
check, and does not publish Gotenberg's port to the host. Gotenberg runs
Chromium and therefore uses materially more memory and CPU than the React PDF
path; budget roughly 512 MiB of memory for it as a starting point. Keep it on
the private Compose network because rendered HTML contains invoice, customer,
and payment data.

Configuration variables are listed in `.env.example`. A configured but
unhealthy Gotenberg service never causes a fallback to React PDF; the UI reports
the failure, archived files remain downloadable, and issuing stays in draft.

See [pdf_template_author_reference.md](pdf_template_author_reference.md) for
the shared Liquid data model and template rules.
