# syntax=docker/dockerfile:1

# --- Build stage: install deps, produce assets, and compile executable ---
FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
# Vendor htmx/Alpine, compile Tailwind, generate the embedded runtime manifest,
# and compile the app into a standalone executable.
RUN bun run build:binary
RUN mkdir -p /app/empty-data

# --- Runtime stage: distroless image with only the compiled executable ---
FROM gcr.io/distroless/base-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    INVOICE_HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    DB_PATH=/data/app.db \
    FILES_DIR=/data/files \
    TMP_DIR=/tmp

COPY --from=build --chown=nonroot:nonroot /app/dist/invoice ./invoice
COPY --from=build --chown=nonroot:nonroot /app/empty-data /data

EXPOSE 3000
CMD ["./invoice"]
