# syntax=docker/dockerfile:1

# --- Build stage: install deps and produce static assets ---
FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
# Vendor htmx/Alpine and compile Tailwind into src/public.
RUN bun run build

# --- Runtime stage: slim image with only what we need ---
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    DB_PATH=/data/app.db \
    FILES_DIR=/data/files \
    TMP_DIR=/tmp

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["bun", "run", "src/index.tsx"]
