#!/bin/sh
set -e

# Schema path. Defaults to the pure OSS schema baked into the image. Build
# flows that compose a different schema (e.g. an optional commercial overlay)
# can override at runtime by setting PRISMA_SCHEMA to a path inside the
# container.
PRISMA_SCHEMA="${PRISMA_SCHEMA:-/workspace/apps/server/prisma/schema.prisma}"

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy --schema $PRISMA_SCHEMA"
  npx prisma migrate deploy --schema "$PRISMA_SCHEMA"
  if [ "$RUN_SEED" = "true" ]; then
    npx prisma db seed --schema "$PRISMA_SCHEMA" || echo "[entrypoint] seed non-fatal"
  fi
fi

exec "$@"
