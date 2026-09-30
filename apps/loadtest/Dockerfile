FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY ./apps/loadtest/package.json ./apps/loadtest/package.json
COPY ./packages/shared/package.json ./packages/shared/package.json

RUN npm install -w @meetropolis/loadtest

COPY . .

# @meetropolis/shared resolves to its build output; the loadtest imports the
# Colyseus wire protocol version from it.
RUN npm -w @meetropolis/shared run build

WORKDIR /app/apps/loadtest

CMD ["npm", "run", "dev"]


