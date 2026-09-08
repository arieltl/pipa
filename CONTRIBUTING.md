# Contributing

Thanks for helping improve Pipa. The project is in beta; keep changes focused and explain behavior that affects stored invoices, migrations, files, or PDF output.

## Local setup

Use Bun 1.3.14 (the version used by the container build), then install the locked dependency set:

```sh
bun install --frozen-lockfile
bun run db:migrate
```

Start the development server with `bun run dev`. Before opening a pull request, run:

```sh
bun run build
bun run typecheck
bun run test
```

The test suite uses isolated temporary SQLite databases. Do not put real client, payment, tax, or invoice data in issues, pull requests, fixtures, or screenshots. Use synthetic examples.

## Changes and migrations

Keep business rules in domain/services rather than route handlers. Validate HTTP input at route boundaries, preserve integer minor-unit money values, and keep archived files append-only. When changing the database schema, update `src/db/schema.ts`, then generate a migration with:

```sh
bun run db:generate
```

Review the generated migration and add migration coverage where appropriate; do not use `drizzle-kit push` for committed changes. Include a short upgrade and data-safety note in the pull request for schema or file-storage changes.

Large architectural, dependency, or workflow changes should be discussed in an issue before implementation. Small fixes and focused documentation changes can go directly to a pull request.

## Pull requests

Describe what changed, why, and how it was verified. Mention deliberate beta limitations or follow-up work. Keep secrets and private customer data out of commits. The repository does not require a contributor license agreement.

AI assistance is welcome with disclosure of substantial use and human review, understanding, and testing. Read the [AI contribution policy](AI_POLICY.md) before submitting AI-assisted work.
