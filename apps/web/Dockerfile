# Build Stage
FROM node:24-bookworm-slim AS builder

WORKDIR /workspace

# Copy root package files
COPY package*.json ./
COPY tsconfig.base.json ./

# Copy web app
COPY apps/web ./apps/web

# Copy shared package if it exists
COPY packages ./packages

# Build arguments for environment variables
ARG VITE_API_BASE
ARG VITE_LIVEKIT_URL
ARG VITE_FEATURE_AV_SETTINGS
ARG VITE_FEATURE_VOICE_ISOLATION

ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_LIVEKIT_URL=${VITE_LIVEKIT_URL}
ENV VITE_FEATURE_AV_SETTINGS=${VITE_FEATURE_AV_SETTINGS}
ENV VITE_FEATURE_VOICE_ISOLATION=${VITE_FEATURE_VOICE_ISOLATION}

# Install dependencies from workspace root
WORKDIR /workspace
RUN npm install

# Clean stale host-machine symlinks in apps/web/public/.
# These point to absolute /Users/... paths from the host and are dangling
# inside the container. The optional-submodules vite plugin recreates them
# with valid container paths during the build, sourcing assets from
# packages/brand/packages/web/public when the submodule is present.
RUN find /workspace/apps/web/public -type l -delete

# Build web app
WORKDIR /workspace/apps/web
RUN npm run build

# Production Stage
FROM nginx:alpine AS runner

LABEL org.opencontainers.image.source="https://github.com/lass-machen/meetropolis"
LABEL org.opencontainers.image.description="Meetropolis Web - Virtual Office Platform"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# Copy built files to nginx
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]

