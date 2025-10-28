FROM node:20-bookworm-slim

# 1) Prepare workspace
WORKDIR /workspace

# Root base tsconfig (server tsconfig extends this)
COPY tsconfig.base.json /workspace/tsconfig.base.json

# 2) Install server dependencies
WORKDIR /workspace/apps/server
COPY apps/server/package*.json ./
RUN npm ci

# 3) Prisma schema + client generate
COPY apps/server/prisma ./prisma
RUN npx prisma generate --schema ./prisma/schema.prisma

# 4) Copy source and build
COPY apps/server/tsconfig.json ./tsconfig.json
COPY apps/server/src ./src
RUN npm run build

# 5) Entrypoint to run migrations (optional) then start
COPY apps/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 2567
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]

