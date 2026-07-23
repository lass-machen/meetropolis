#!/usr/bin/env bash
#
# Local mirror of .github/workflows/ci.yml — runs the exact same checks the
# GitHub CI runs, so you can verify a change is green before pushing and not
# spend Actions minutes on a red run.
#
# It runs every check the five CI jobs run (lint + format, typecheck, prisma
# validate, unit tests for shared/web/server, and the OSS-only build smoke),
# but performs the shared-package build and `prisma generate` once instead of
# repeating them per job the way separate CI runners must.
#
# Usage:
#   scripts/ci-local.sh          # fast: assumes node_modules is installed
#   scripts/ci-local.sh --full   # also runs `npm ci` first (matches CI exactly)
#
# Exit code is non-zero if any check fails; a summary lists what passed/failed.
set -uo pipefail

cd "$(dirname "$0")/.."

# Mirror the workflow-level env. HUSKY=0 skips git-hook install; the dummy
# DATABASE_URL is only parsed (never connected) by prisma validate/generate.
export HUSKY='0'
export DATABASE_URL="${DATABASE_URL:-postgresql://ci:ci@localhost:5432/ci}"
# CI runs on a pure OSS checkout with no closed-source sibling repos. On a
# maintainer machine those siblings ARE present next to this repo, so a naive
# `npm run build` would pull sibling sources (and their separately-installed
# deps) into the bundle and diverge from what CI actually gates. Force the
# open-core boundary to resolve OSS-only so this mirror matches CI exactly.
# (The siblings-included production image is validated by the Docker build, not
# here.) Unset it to run against the siblings instead.
export MEETROPOLIS_OSS_ONLY="${MEETROPOLIS_OSS_ONLY:-1}"

RUN_NPM_CI=0
[ "${1:-}" = "--full" ] && RUN_NPM_CI=1

failed=()
run() {
  local label="$1"
  shift
  printf '\n\033[1;34m▶ %s\033[0m\n' "$label"
  if "$@"; then
    printf '\033[1;32m✓ %s\033[0m\n' "$label"
  else
    printf '\033[1;31m✗ %s (FAILED)\033[0m\n' "$label"
    failed+=("$label")
  fi
}

# --- Setup (built once; CI repeats these per job because runners are isolated).
if [ "$RUN_NPM_CI" = "1" ]; then
  run "npm ci" npm ci
fi
run "build @meetropolis/shared" npm -w @meetropolis/shared run build
run "prisma generate" npm run generate

# --- Job: Prisma schema (validate + generate).
run "prisma validate" bash -c 'cd apps/server && npx prisma validate'

# --- Job: Lint (eslint + budgets + lint-stats) + format check.
run "lint" npm run lint
run "format:check" npm run format:check

# --- Job: Typecheck (all workspaces).
run "typecheck" npm run typecheck

# --- Job: Unit tests (shared + web + server).
run "test @meetropolis/shared" npm -w @meetropolis/shared run test
run "test @meetropolis/web" npm -w @meetropolis/web run test
run "test @meetropolis/server" npm -w @meetropolis/server run test

# --- Job: Build (web + server) — OSS-only smoke.
run "build (web + server)" npm run build

printf '\n────────────────────────────────────────\n'
if [ "${#failed[@]}" -eq 0 ]; then
  printf '\033[1;32mAll CI checks passed locally.\033[0m\n'
  exit 0
fi
printf '\033[1;31m%d check(s) failed:\033[0m\n' "${#failed[@]}"
printf '  - %s\n' "${failed[@]}"
exit 1
