FROM node:20-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# 1) Prepare workspace root for npm workspaces
WORKDIR /workspace

# Copy root package files for workspace resolution
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy server package
COPY apps/server ./apps/server

# Copy packages if they exist (for shared deps)
COPY packages ./packages

# Install all deps from workspace root (with Prisma hoisting fix)
RUN npm install && cd apps/server && npm install @prisma/client prisma

# Build shared package first (server depends on it)
RUN cd /workspace/packages/shared && npm run build

# 2) Prisma Client generieren (benötigt für Enterprise-Packages und Server-Build)
WORKDIR /workspace/apps/server
RUN npx prisma generate --schema ./prisma/schema.prisma

# Build enterprise packages if submodule is present (no-op for OSS builds)
RUN if [ -f packages/tenancy-enterprise/packages/tenancy/tsconfig.json ]; then \
      npx tsc -p packages/tenancy-enterprise/packages/tenancy/tsconfig.json && \
      npx tsc -p packages/tenancy-enterprise/packages/billing/tsconfig.json; \
    fi

# 3) Build
RUN npm run build

# 4) Prune dev dependencies from root
WORKDIR /workspace
RUN npm prune --omit=dev

# Install tsx for seed in server workspace
WORKDIR /workspace/apps/server
RUN npm install tsx --save-prod

FROM node:20-bookworm-slim AS runner

LABEL org.opencontainers.image.source="https://github.com/lass-machen/meetropolis"
LABEL org.opencontainers.image.description="Meetropolis Server - Virtual Office Platform"
LABEL org.opencontainers.image.licenses="Apache-2.0"

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
