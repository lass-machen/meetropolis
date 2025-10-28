FROM node:20-bookworm-slim AS builder

# 1) Prepare server workspace
WORKDIR /workspace/apps/server
COPY apps/server/package*.json ./
# Install mit Dev-Dependencies für Build
RUN npm ci || npm install

# 2) Prisma Client generieren (benötigt für Build/Typs)
COPY apps/server/prisma ./prisma
RUN npx prisma generate --schema ./prisma/schema.prisma

# 3) Source kopieren und bauen
COPY tsconfig.base.json /workspace/tsconfig.base.json
COPY apps/server/tsconfig.json ./tsconfig.json
COPY apps/server/src ./src
RUN npm run build

# 4) Prod-Dependencies behalten (ohne dev)
RUN npm prune --omit=dev

FROM node:20-bookworm-slim AS runner
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

