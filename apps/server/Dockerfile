FROM node:20-bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
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

# Install all deps from workspace root
RUN npm install

# 2) Prisma Client generieren (benötigt für Build/Typs)
WORKDIR /workspace/apps/server
RUN npx prisma generate --schema ./prisma/schema.prisma

# 3) Build
RUN npm run build

# 4) Prod-Dependencies behalten (ohne dev), aber tsx für Seed behalten
RUN npm prune --omit=dev && npm install tsx --save-prod

FROM node:20-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace/apps/server
ENV NODE_ENV=production

# 5) Nur das Nötige übernehmen
COPY --from=builder /workspace/apps/server/node_modules ./node_modules
COPY --from=builder /workspace/apps/server/prisma ./prisma
COPY --from=builder /workspace/apps/server/dist ./dist

# 6) Entrypoint (Migration optional) + Start
COPY apps/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 2567
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
