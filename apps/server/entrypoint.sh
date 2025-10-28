#!/bin/sh
set -e

SCHEMA_PATH="${PRISMA_SCHEMA:-/workspace/apps/server/prisma/schema.prisma}"

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy --schema $SCHEMA_PATH"
  npx prisma migrate deploy --schema "$SCHEMA_PATH"
  if [ "$RUN_SEED" = "true" ]; then
    npx prisma db seed --schema "$SCHEMA_PATH" || echo "[entrypoint] seed non-fatal"
  fi
fi

exec "$@"


