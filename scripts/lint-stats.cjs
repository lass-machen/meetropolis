#!/usr/bin/env node
// Lint statistics + baseline regression gate.
//
// Run ESLint over the workspace, aggregate warnings by rule, and either
// compare the current counts against the committed baseline (default)
// or write a new baseline (--update).
//
// Exit codes:
//   0  - within budget (or baseline updated)
//   1  - regression: at least one rule exceeded its baseline
//   2  - infrastructure error (eslint failed, missing baseline)
//
// Why this exists:
// The OSS codebase has documented library-boundary warnings (LiveKit,
// Phaser, Colyseus, WebSocket monkey-patching, etc.). They are tracked
// here so that contributors do not silently raise the warning count by
// adding new unsafe accesses outside legitimate boundaries.
//
// Usage:
//   node scripts/lint-stats.cjs           # check against baseline
//   node scripts/lint-stats.cjs --update  # rewrite baseline
//   node scripts/lint-stats.cjs --json    # print machine-readable summary

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'lint-stats.json');

const args = new Set(process.argv.slice(2));
const SHOULD_UPDATE = args.has('--update');
const JSON_OUT = args.has('--json');

function runEslint() {
  try {
    const out = execSync('npx eslint . --format json', {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(out.toString('utf8'));
  } catch (err) {
    // ESLint exits non-zero when there are problems, but still writes JSON
    // to stdout. Use that output when available.
    if (err.stdout && err.stdout.length > 0) {
      try {
        return JSON.parse(err.stdout.toString('utf8'));
      } catch (parseErr) {
        console.error('lint-stats: failed to parse ESLint JSON output.');
        console.error(parseErr.message);
        process.exit(2);
      }
    }
    console.error('lint-stats: ESLint invocation failed.');
    if (err.stderr) console.error(err.stderr.toString('utf8'));
    process.exit(2);
  }
}

function aggregate(eslintReport) {
  const byRule = {};
  let totalWarnings = 0;
  let totalErrors = 0;
  for (const file of eslintReport) {
    for (const msg of file.messages || []) {
      const ruleId = msg.ruleId || '<parser>';
      const isError = msg.severity === 2;
      if (isError) totalErrors += 1;
      else totalWarnings += 1;
      if (!byRule[ruleId]) byRule[ruleId] = { warnings: 0, errors: 0 };
      if (isError) byRule[ruleId].errors += 1;
      else byRule[ruleId].warnings += 1;
    }
  }
  return { byRule, totalWarnings, totalErrors };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  } catch (err) {
    console.error(`lint-stats: failed to parse ${BASELINE_PATH}.`);
    console.error(err.message);
    process.exit(2);
  }
}

function writeBaseline(stats) {
  const payload = {
    schema: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    totalWarnings: stats.totalWarnings,
    totalErrors: stats.totalErrors,
    byRule: stats.byRule,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n');
  return payload;
}

function compare(current, baseline) {
  const regressions = [];
  for (const [rule, counts] of Object.entries(current.byRule)) {
    const baselineCounts = baseline.byRule?.[rule] || { warnings: 0, errors: 0 };
    if (counts.warnings > baselineCounts.warnings) {
      regressions.push({
        rule,
        kind: 'warnings',
        baseline: baselineCounts.warnings,
        current: counts.warnings,
        delta: counts.warnings - baselineCounts.warnings,
      });
    }
    if (counts.errors > baselineCounts.errors) {
      regressions.push({
        rule,
        kind: 'errors',
        baseline: baselineCounts.errors,
        current: counts.errors,
        delta: counts.errors - baselineCounts.errors,
      });
    }
  }
  return regressions;
}

function formatRuleTable(byRule) {
  const rows = Object.entries(byRule)
    .map(([rule, c]) => ({ rule, warnings: c.warnings, errors: c.errors }))
    .sort((a, b) => b.warnings + b.errors - (a.warnings + a.errors));
  const width = Math.max(20, ...rows.map((r) => r.rule.length));
  const lines = rows.map(
    (r) => `  ${r.rule.padEnd(width)}  warn=${String(r.warnings).padStart(4)}  err=${String(r.errors).padStart(3)}`,
  );
  return lines.join('\n');
}

const report = runEslint();
const stats = aggregate(report);

if (JSON_OUT) {
  process.stdout.write(
    JSON.stringify(
      {
        totalWarnings: stats.totalWarnings,
        totalErrors: stats.totalErrors,
        byRule: stats.byRule,
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(0);
}

if (SHOULD_UPDATE) {
  const written = writeBaseline(stats);
  console.log(`lint-stats: baseline updated (${written.totalWarnings} warnings, ${written.totalErrors} errors).`);
  console.log(formatRuleTable(stats.byRule));
  process.exit(0);
}

const baseline = loadBaseline();
if (!baseline) {
  console.error(`lint-stats: no baseline at ${BASELINE_PATH}.`);
  console.error('Create one with: node scripts/lint-stats.cjs --update');
  process.exit(2);
}

const regressions = compare(stats, baseline);

console.log(`lint-stats: ${stats.totalWarnings} warnings, ${stats.totalErrors} errors`);
console.log(
  `baseline:   ${baseline.totalWarnings} warnings, ${baseline.totalErrors} errors (as of ${baseline.updatedAt || 'unknown'})`,
);
console.log('\nCurrent counts by rule:');
console.log(formatRuleTable(stats.byRule));

if (regressions.length === 0) {
  console.log('\nlint-stats: no regressions.');
  process.exit(0);
}

console.log('\nlint-stats: REGRESSIONS detected:');
for (const r of regressions) {
  console.log(`  ${r.rule}: ${r.kind} ${r.baseline} -> ${r.current} (+${r.delta})`);
}
console.log('\nFix the new warnings, or if they are legitimate library-boundaries,');
console.log('move the code into one of the documented adapter files');
console.log('(see LIBRARY_BOUNDARIES.md) and then run:');
console.log('  node scripts/lint-stats.cjs --update');
console.log('to refresh the baseline alongside your change.');
process.exit(1);
