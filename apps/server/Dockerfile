# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# 1) Prepare workspace root for npm workspaces
WORKDIR /workspace

# Copy root package files for workspace resolution
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy server package
COPY apps/server ./apps/server

# The default office map JSON + tile assets live in apps/web/public so the
# Phaser client can serve them statically. The prisma seed (run inside the
# `migrate` service from this builder stage) also reads them to populate
# the database, so we need them inside the builder image as well.
COPY apps/web/public/maps ./apps/web/public/maps
COPY apps/web/public/assets ./apps/web/public/assets

# packages/shared is the only workspace member tracked in the OSS repo.
# Closed-source modules (brand, tenancy-enterprise, desktop) are NOT part
# of the OSS image — they live in private sibling repos consumed by the
# Tiamat-internal deploy pipeline (see ../meetropolis-deploy/dockerfiles/).
# In an OSS-only build the packages/ directory only ever contains
# `shared/`, which is sufficient for the workspace resolver.
COPY packages ./packages

# Install all deps from workspace root (with Prisma hoisting fix)
RUN npm install && cd apps/server && npm install @prisma/client prisma

# Build shared package first (server depends on it)
RUN cd /workspace/packages/shared && npm run build

# 2) Generate the Prisma Client. The schema path is configurable via a
#    build arg so downstream builds (Tiamat-internal deploy with the
#    composed OSS+EE schema) can override it without forking this file.
#    The OSS default is the pure OSS schema baked into this repo.
WORKDIR /workspace/apps/server
ARG PRISMA_SCHEMA_PATH=/workspace/apps/server/prisma/schema.prisma
RUN echo "[dockerfile] prisma generate --schema $PRISMA_SCHEMA_PATH" && \
    npx prisma generate --schema "$PRISMA_SCHEMA_PATH"

# 3) Build
RUN npm run build

# 4) Prune dev dependencies from root
WORKDIR /workspace
RUN npm prune --omit=dev

# Install tsx for seed in server workspace
WORKDIR /workspace/apps/server
RUN npm install tsx --save-prod

FROM node:24-bookworm-slim AS runner

LABEL org.opencontainers.image.source="https://github.com/lass-machen/meetropolis"
LABEL org.opencontainers.image.description="Meetropolis Server - Virtual Office Platform"
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/apps/server
ENV NODE_ENV=production

# 5) Copy entire workspace node_modules (for hoisted deps) and server-specific
COPY --from=builder /workspace/node_modules /workspace/node_modules
COPY --from=builder /workspace/apps/server/node_modules ./node_modules
# Shared package (workspace symlink target, needed at runtime by zoneLockHandler etc.)
COPY --from=builder /workspace/packages/shared /workspace/packages/shared
COPY --from=builder /workspace/apps/server/prisma ./prisma
COPY --from=builder /workspace/apps/server/dist ./dist
# Copy generated Prisma client to dist/ (compiled code imports from dist/generated)
COPY --from=builder /workspace/apps/server/src/generated ./dist/generated

# Default tilesets (referenced by seed maps as /assets/tilesets/...)
COPY apps/web/public/assets /workspace/apps/web/public/assets

# Admin tools (HTML only, served at /tools with Basic Auth)
COPY tools /workspace/tools

# 6) Entrypoint (Migration optional) + Start
COPY apps/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 2567
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
