#!/usr/bin/env bash
set -euo pipefail

SECONDS=0
trap 'printf "Total duration: %ss\n" "$SECONDS"' EXIT

# Only the checked-out HEAD is gated: every non-deletion line must point
# at HEAD. Pure deletions pass without further checks.
head_sha="$(git rev-parse HEAD)"
have_request=0
while read -r local_ref local_sha _remote_ref _remote_sha; do
  if [[ -z "${local_ref:-}" ]]; then
    continue
  fi
  stripped="${local_sha//0/}"
  if [[ -z "$stripped" ]]; then
    continue
  fi
  commit_sha="$(git rev-parse "${local_sha}^{commit}")"
  if [[ "$commit_sha" != "$head_sha" ]]; then
    printf '%s\n' "pre-push only gates the checked-out HEAD: ${local_ref} points to ${local_sha:0:12}, HEAD is ${head_sha:0:12}. Check it out first, then push." >&2
    exit 1
  fi
  have_request=1
done
if [[ "$have_request" -eq 0 ]]; then
  exit 0
fi

root="$(git rev-parse --show-toplevel)"
gate="${MEETROPOLIS_GATE:-$(dirname "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")/scripts/gate.sh}"

if [[ -x "$gate" ]]; then
  exec "$gate" push oss "$root"
fi

status="$(git status --porcelain --untracked-files=no)"
if [[ -n "$status" ]]; then
  printf '%s\n' 'pre-push only gates committed changes: commit first' >&2
  exit 1
fi

printf '%s\n' 'No workspace gate found: running only the OSS checks (scripts/ci-local.sh)'
set +e
bash "$root/scripts/ci-local.sh"
status=$?
set -e
exit "$status"
