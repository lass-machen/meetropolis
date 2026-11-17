#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
T="$ROOT/tmp/test-gates.$$"
failures=0

trap 'rm -rf "$T"' EXIT
mkdir -p "$T"

git clone --quiet --no-hardlinks "$(git rev-parse --show-toplevel)" "$T/repo"
git -C "$T/repo" config user.name 'Gate Test'
git -C "$T/repo" config user.email 'gate-test@example.invalid'
unset HUSKY || true

(cd "$T/repo" && npm run prepare --silent)
git -C "$T/repo" worktree add --quiet --detach "$T/wt" HEAD

if git -C "$T/wt" commit --allow-empty -m 'bad message' >"$T/bad-commit.log" 2>&1; then
  printf 'ERROR: invalid commit message was accepted\n'
  failures=$((failures + 1))
elif grep -Eq '\[(subject-empty|type-empty)\]' "$T/bad-commit.log"; then
  printf 'OK: commit-message hook rejected the invalid commit message\n'
else
  printf 'ERROR: invalid commit failed for another reason\n'
  sed -n '1,80p' "$T/bad-commit.log"
  failures=$((failures + 1))
fi

if git -C "$T/wt" commit --allow-empty -m 'test: verify hooks in worktrees' >"$T/good-commit.log" 2>&1; then
  printf 'OK: valid commit in fresh worktree was accepted\n'
else
  printf 'ERROR: valid commit in fresh worktree was rejected\n'
  sed -n '1,80p' "$T/good-commit.log"
  failures=$((failures + 1))
fi

mkdir -p "$T/wt/.codex"
printf '{ "unformatted" : true }\n' >"$T/wt/.codex/hooks.json"
if (cd "$T/wt" && npx prettier --check .codex/hooks.json) >"$T/prettier.log" 2>&1; then
  printf 'OK: Prettier ignores .codex/hooks.json\n'
else
  printf 'ERROR: Prettier did not ignore .codex/hooks.json\n'
  sed -n '1,80p' "$T/prettier.log"
  failures=$((failures + 1))
fi

# lint-staged must spawn plain task strings without a shell. A task with
# Shell syntax (`cd DIR && ...`) then hits the /usr/bin/cd stub, reports
# green and never starts the actual checker. The generated
# tasks must not contain shell operators.
cat >"$T/lint20.mjs" <<'EOF'
import { pathToFileURL } from 'node:url';
const repo = process.argv[2];
const config = (await import(pathToFileURL(repo + '/.lintstagedrc.mjs').href)).default;
const staged = [
  repo + '/apps/web/src/lib/backoff.ts',
  repo + '/apps/server/src/index.ts',
  repo + '/packages/shared/src/index.ts',
];
const tasks = await config['*.{ts,tsx}'](staged);
const offenders = tasks.filter(
  (task) => typeof task === 'string' && /(^|\s)cd\s|&&|\||;|\$\(|`/.test(task),
);
if (offenders.length > 0) {
  console.error('Tasks with shell syntax:\n' + offenders.join('\n'));
  process.exit(1);
}
EOF
if (cd "$T/repo" && node "$T/lint20.mjs" "$T/repo") >"$T/lint20.log" 2>&1; then
  printf 'OK: lint-staged tasks without shell operators\n'
else
  printf 'ERROR: lint-staged tasks with shell syntax\n'
  sed -n '1,20p' "$T/lint20.log"
  failures=$((failures + 1))
fi

# pre-push gate: only the checked-out HEAD is gated.
# Isolated clone with a local bare remote; the gate path does not exist,
# and ci-local.sh is a sentinel that only records its invocation.
git clone --quiet --no-hardlinks "$ROOT" "$T/pp"
git -C "$T/pp" config user.name 'Gate Test'
git -C "$T/pp" config user.email 'gate-test@example.invalid'
git init --quiet --bare "$T/pp.git"
git -C "$T/pp" remote add pp "$T/pp.git"
git -C "$T/pp" push --quiet pp HEAD:refs/heads/main
git --git-dir="$T/pp.git" update-ref refs/heads/x "$(git -C "$T/pp" rev-parse HEAD)"
cp "$T/pp/scripts/pre-push.sh" "$T/pp/.git/hooks/pre-push"
chmod +x "$T/pp/.git/hooks/pre-push"
printf '#!/usr/bin/env bash\nprintf "CI-STARTED\\n" >> "%s/ci-local-marker"\nexit 0\n' "$T" >"$T/pp/scripts/ci-local.sh"
git -C "$T/pp" add scripts/ci-local.sh
git -C "$T/pp" commit --quiet -m 'test: sentinel instead of ci-local'
rm -f "$T/ci-local-marker"
git -C "$T/pp" branch alt HEAD~1

if MEETROPOLIS_GATE=/nonexistent git -C "$T/pp" push pp alt:refs/heads/alt >"$T/pp-fremd.log" 2>&1; then
  printf 'ERROR: push of a ref other than HEAD was accepted\n'
  failures=$((failures + 1))
elif grep -q 'checked-out HEAD' "$T/pp-fremd.log" && [ ! -e "$T/ci-local-marker" ]; then
  printf 'OK: push of a ref other than HEAD rejected, ci-local did not start\n'
else
  printf 'ERROR: foreign ref failed without HEAD message or ci-local started\n'
  sed -n '1,40p' "$T/pp-fremd.log"
  failures=$((failures + 1))
fi

if MEETROPOLIS_GATE=/nonexistent git -C "$T/pp" push pp :refs/heads/x >"$T/pp-loesch.log" 2>&1; then
  if [ ! -e "$T/ci-local-marker" ] && ! grep -q 'checked-out HEAD' "$T/pp-loesch.log"; then
    printf 'OK: pure deletion passes without checks\n'
  else
    printf 'ERROR: deletion triggered checks or ci-local\n'
    failures=$((failures + 1))
  fi
else
  printf 'ERROR: pure deletion was rejected\n'
  sed -n '1,40p' "$T/pp-loesch.log"
  failures=$((failures + 1))
fi

# Hook installation without side effects.
# (i) prepare without scripts/ must exit 0 (the Docker build
# does not copy scripts/ but still triggers prepare).
mkdir -p "$T/noscripts"
cp "$T/repo/package.json" "$T/noscripts/package.json"
if (cd "$T/noscripts" && npm run prepare --silent) >"$T/noscripts.log" 2>&1; then
  printf 'OK: prepare without scripts/ exits 0\n'
else
  printf 'ERROR: prepare without scripts/ failed\n'
  sed -n '1,20p' "$T/noscripts.log"
  failures=$((failures + 1))
fi

# (ii) HUSKY=0 must not change core.hooksPath in the main checkout.
git -C "$T/repo" config --unset core.hooksPath 2>/dev/null || true
before_ii="$(git -C "$T/repo" config --local --get core.hooksPath || true)"
if (cd "$T/repo" && HUSKY=0 npm run prepare --silent) >"$T/husky0.log" 2>&1; then
  after_ii="$(git -C "$T/repo" config --local --get core.hooksPath || true)"
  if [ "${before_ii}" = "${after_ii}" ]; then
    printf 'OK: HUSKY=0 leaves core.hooksPath unchanged\n'
  else
    printf 'ERROR: HUSKY=0 changed core.hooksPath from <%s> to <%s>\n' "${before_ii}" "${after_ii}"
    failures=$((failures + 1))
  fi
else
  printf 'ERROR: prepare with HUSKY=0 failed\n'
  sed -n '1,20p' "$T/husky0.log"
  failures=$((failures + 1))
fi

# (iii) prepare in a linked worktree must not change the shared core.hooksPath
# of the clone.
git -C "$T/repo" config --unset core.hooksPath 2>/dev/null || true
before_iii="$(git -C "$T/repo" config --local --get core.hooksPath || true)"
if (cd "$T/wt" && npm run prepare --silent) >"$T/wt-prepare.log" 2>&1; then
  after_iii="$(git -C "$T/repo" config --local --get core.hooksPath || true)"
  if [ "${before_iii}" = "${after_iii}" ]; then
    printf 'OK: worktree prepare leaves core.hooksPath unchanged\n'
  else
    printf 'ERROR: worktree prepare changed core.hooksPath from <%s> to <%s>\n' "${before_iii}" "${after_iii}"
    failures=$((failures + 1))
  fi
else
  printf 'ERROR: prepare in worktree failed\n'
  sed -n '1,20p' "$T/wt-prepare.log"
  failures=$((failures + 1))
fi

if node --test "$ROOT/scripts/style-stats.test.cjs" "$ROOT/scripts/lint-stats.test.cjs" >"$T/ratchet-tests.log" 2>&1; then
  printf 'OK: style and lint ratchet tests passed\n'
else
  printf 'ERROR: style or lint ratchet tests failed\n'
  sed -n '1,80p' "$T/ratchet-tests.log"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  printf 'ERROR: %s gate check(s) failed\n' "$failures"
  exit 1
fi

printf 'All gate checks passed.\n'
