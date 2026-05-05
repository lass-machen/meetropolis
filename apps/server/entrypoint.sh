#!/bin/sh
set -e

# Compose the OSS + (optional) enterprise prisma schema before any prisma
# command runs. The composer is idempotent and writes schema.composed.prisma
# inside the same directory as the OSS base schema.
COMPOSE_SCRIPT="${PRISMA_COMPOSE:-/workspace/apps/server/prisma/compose-schema.cjs}"
COMPOSED_SCHEMA="${PRISMA_SCHEMA:-/workspace/apps/server/prisma/schema.composed.prisma}"

if [ -f "$COMPOSE_SCRIPT" ]; then
  echo "[entrypoint] node $COMPOSE_SCRIPT"
  node "$COMPOSE_SCRIPT"
fi

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy --schema $COMPOSED_SCHEMA"
  npx prisma migrate deploy --schema "$COMPOSED_SCHEMA"
  if [ "$RUN_SEED" = "true" ]; then
    npx prisma db seed --schema "$COMPOSED_SCHEMA" || echo "[entrypoint] seed non-fatal"
  fi
fi

exec "$@"


