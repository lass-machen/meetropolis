FROM node:20-bookworm-slim

# 1) Prepare workspace
WORKDIR /workspace

# Root base files (Monorepo)
COPY tsconfig.base.json /workspace/tsconfig.base.json
COPY package.json /workspace/package.json
# Falls vorhanden, Lockfile für deterministische Builds
COPY package-lock.json /workspace/package-lock.json

# 2) Install dependencies (nutzt Root-Lockfile, fällt sauber zurück)
RUN npm ci --omit=dev || npm install --omit=dev

# 3) Wechsel in Server-Package
WORKDIR /workspace/apps/server
COPY apps/server/package*.json ./

# 4) Prisma schema + client generate
COPY apps/server/prisma ./prisma
RUN npx prisma generate --schema ./prisma/schema.prisma

# 5) Copy source and build
COPY apps/server/tsconfig.json ./tsconfig.json
COPY apps/server/src ./src
RUN npm run build

# 6) Entrypoint to run migrations (optional) then start
COPY apps/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 2567
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]

