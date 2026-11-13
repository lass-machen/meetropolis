FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY ./apps/loadtest/package.json ./apps/loadtest/package.json
COPY ./packages/shared/package.json ./packages/shared/package.json

RUN npm install -w @meetropolis/shared -w @meetropolis/loadtest

COPY . .

RUN npm run build -w @meetropolis/shared

WORKDIR /app/apps/loadtest

LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

CMD ["npm", "run", "dev"]


