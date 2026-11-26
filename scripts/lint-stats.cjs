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
    inlineStyles: stats.inlineStyles,
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

const INLINE_STYLE_METRICS = ['styleObjects', 'colorLiterals'];
const COLOR_PATTERN = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\b(?:rgba?|hsla?)\(/g;

function countColorLiteralsInStyleObject(node, counts) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) countColorLiteralsInStyleObject(child, counts);
    return;
  }
  if (node.type === 'StringLiteral' && typeof node.value === 'string') {
    const matches = node.value.match(COLOR_PATTERN);
    if (matches) counts.colorLiterals += matches.length;
  }
  if (node.type === 'TemplateLiteral' && Array.isArray(node.quasis)) {
    for (const quasi of node.quasis) {
      const cooked = quasi.value && quasi.value.cooked;
      if (typeof cooked === 'string') {
        const matches = cooked.match(COLOR_PATTERN);
        if (matches) counts.colorLiterals += matches.length;
      }
    }
  }
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') countColorLiteralsInStyleObject(value, counts);
  }
}

// Counts inline style objects (style={{ ... }}) and the color literals inside
// them in one TSX source unit. Only object expressions count; identifiers
// such as style={styles} and className attributes are ignored.
function countInlineStylesInSource(source, filePath) {
  let ast;
  try {
    ast = require('@babel/parser').parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
    });
  } catch (err) {
    throw new Error(`lint-stats: cannot parse ${filePath}: ${err.message}`);
  }
  const counts = { styleObjects: 0, colorLiterals: 0 };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (
      node.type === 'JSXAttribute' &&
      node.name &&
      node.name.type === 'JSXIdentifier' &&
      node.name.name === 'style' &&
      node.value &&
      node.value.type === 'JSXExpressionContainer' &&
      node.value.expression &&
      node.value.expression.type === 'ObjectExpression'
    ) {
      counts.styleObjects += 1;
      countColorLiteralsInStyleObject(node.value.expression, counts);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast);
  return counts;
}

// Collects every project TSX file below apps/web/src as a sorted list of
// absolute paths. node_modules is never entered.
function findTsxFiles(root) {
  const start = path.join(root, 'apps/web/src');
  const files = [];
  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
        files.push(absolutePath);
      }
    }
  };
  walk(start);
  return files.sort();
}

// Sums the inline style counters over every project TSX file.
function countInlineStyles(root) {
  const totals = { styleObjects: 0, colorLiterals: 0 };
  for (const filePath of findTsxFiles(root)) {
    const source = fs.readFileSync(filePath, 'utf8');
    const counts = countInlineStylesInSource(source, filePath);
    totals.styleObjects += counts.styleObjects;
    totals.colorLiterals += counts.colorLiterals;
  }
  return totals;
}

// A rising inline style counter is a regression; equal or falling counts are
// not. A missing baseline (or missing metric inside it) is an error, never a
// silently empty baseline.
function compareInlineStyles(current, baseline) {
  const regressions = [];
  for (const metric of INLINE_STYLE_METRICS) {
    if (!baseline || typeof baseline[metric] !== 'number') {
      throw new Error('inline style baseline missing, run lint:stats:update');
    }
    if (current[metric] > baseline[metric]) {
      regressions.push({ metric, baseline: baseline[metric], current: current[metric] });
    }
  }
  return regressions;
}

function main() {
  const report = runEslint();
  const stats = aggregate(report);
  stats.inlineStyles = countInlineStyles(ROOT);

  if (JSON_OUT) {
    process.stdout.write(
      JSON.stringify(
        {
          totalWarnings: stats.totalWarnings,
          totalErrors: stats.totalErrors,
          byRule: stats.byRule,
          inlineStyles: stats.inlineStyles,
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
    console.log(
      `inline styles: ${written.inlineStyles.styleObjects} objects, ${written.inlineStyles.colorLiterals} color literals.`,
    );
    process.exit(0);
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.error(`lint-stats: no baseline at ${BASELINE_PATH}.`);
    console.error('Create one with: node scripts/lint-stats.cjs --update');
    process.exit(2);
  }

  let inlineRegressions;
  try {
    inlineRegressions = compareInlineStyles(stats.inlineStyles, baseline.inlineStyles);
  } catch (err) {
    console.error(`lint-stats: ${err.message}`);
    process.exit(2);
  }

  const regressions = compare(stats, baseline);

  console.log(`lint-stats: ${stats.totalWarnings} warnings, ${stats.totalErrors} errors`);
  console.log(
    `baseline:   ${baseline.totalWarnings} warnings, ${baseline.totalErrors} errors (as of ${baseline.updatedAt || 'unknown'})`,
  );
  console.log('\nCurrent counts by rule:');
  console.log(formatRuleTable(stats.byRule));
  console.log(
    `\ninline styles: ${stats.inlineStyles.styleObjects} objects, ${stats.inlineStyles.colorLiterals} color literals ` +
      `(baseline: ${baseline.inlineStyles.styleObjects} objects, ${baseline.inlineStyles.colorLiterals} color literals)`,
  );

  if (regressions.length === 0 && inlineRegressions.length === 0) {
    console.log('\nlint-stats: no regressions.');
    process.exit(0);
  }

  console.log('\nlint-stats: REGRESSIONS detected:');
  for (const r of regressions) {
    console.log(`  ${r.rule}: ${r.kind} ${r.baseline} -> ${r.current} (+${r.delta})`);
  }
  for (const r of inlineRegressions) {
    console.log(`  inlineStyles.${r.metric}: ${r.baseline} -> ${r.current} (+${r.current - r.baseline})`);
  }
  console.log('\nFix the new warnings, or if they are legitimate library-boundaries,');
  console.log('move the code into one of the documented adapter files');
  console.log('(see LIBRARY_BOUNDARIES.md) and then run:');
  console.log('  node scripts/lint-stats.cjs --update');
  console.log('to refresh the baseline alongside your change.');
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  BASELINE_PATH,
  ROOT,
  aggregate,
  compare,
  compareInlineStyles,
  countInlineStyles,
  countInlineStylesInSource,
  findTsxFiles,
  formatRuleTable,
  loadBaseline,
  main,
  runEslint,
  writeBaseline,
};
