FROM node:24-bookworm-slim

# Install FFmpeg for media transcoding
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy monorepo root files
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./

# Copy shared package
COPY packages/shared/ packages/shared/

# Copy npc-service
COPY apps/npc-service/ apps/npc-service/

# Install dependencies
RUN npm install --workspace=@meetropolis/shared --workspace=@meetropolis/npc-service --ignore-scripts 2>/dev/null || npm install

# Build shared and npc-service
RUN cd packages/shared && npx tsc -p tsconfig.json || true
RUN cd apps/npc-service && npx tsc -p tsconfig.json || true

# Dev dependencies are only needed for the TypeScript build above
RUN npm prune --omit=dev

WORKDIR /workspace/apps/npc-service

ENV NODE_ENV=production

EXPOSE 3100

CMD ["node", "--enable-source-maps", "dist/index.js"]
