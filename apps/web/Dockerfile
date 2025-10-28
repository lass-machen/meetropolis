# Build Stage
FROM node:20-alpine AS builder

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

ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_LIVEKIT_URL=${VITE_LIVEKIT_URL}

# Install dependencies and build
WORKDIR /workspace/apps/web
RUN npm ci || npm install
RUN npm run build

# Production Stage
FROM nginx:alpine AS runner

# Copy built files to nginx
COPY --from=builder /workspace/apps/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]

