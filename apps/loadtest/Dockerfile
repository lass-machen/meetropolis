FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY ./apps/loadtest/package.json ./apps/loadtest/package.json

RUN npm install -w @meetropolis/loadtest

COPY . .

WORKDIR /app/apps/loadtest

CMD ["npm", "run", "dev"]


