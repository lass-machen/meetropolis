#!/usr/bin/env node
// Style statistics + hex-colour ratchet gate.
//
// Runs the public stylelint rule `color-no-hex` over every project CSS file
// and compares the per-file, per-value hex counts with the committed baseline
// in style-stats.json.
//
// A new hex value or a rising count for an existing value fails the gate.
// Reductions are allowed, so the baseline only ever ratchets downwards.
// The canonical token file is exempt: it is the one place where hex values
// are allowed to live.
//
// Exit codes:
//   0 - no regression
//   1 - regression: new hex value or rising count for an existing value
//   2 - infrastructure error: the file search, stylelint or the baseline
//       failed, or the diagnostics are unknown
//
// Usage:
//   node scripts/style-stats.cjs

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'style-stats.json');
const BASELINE_VERSION = 1;
const CANONICAL_TOKEN_FILE = 'apps/web/src/styles/tokens.css';
const STYLELINT_CONFIG = { rules: { 'color-no-hex': true } };
const HEX_PATTERN = /^#[\da-z]+$/i;
const BASELINE_HEX_PATTERN = /^#[0-9a-z]+$/;
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.vord',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'test-results',
  'playwright-report',
  '.turbo',
  '.cache',
]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

// Collects every project CSS file as a deterministic POSIX-relative path.
// Symlinks are never followed and generated or vendored directories are left out.
// Read errors are not swallowed: an unreadable directory aborts the search so
// that a broken filesystem never turns into an empty, green run.
function findCssFiles(root) {
  const files = [];

  const walk = (directory) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.css')) {
        files.push(toPosix(path.relative(root, absolutePath)));
      }
    }
  };

  walk(root);

  return files.sort();
}

// Reads the hex value out of the source at the position stylelint reported.
// The rule itself decides what counts as a hex colour, so the position is the
// only source of truth here.
function extractHexFromWarning(source, warning) {
  const line = source.split('\n')[warning.line - 1];

  if (line === undefined) return null;

  const start = warning.column - 1;
  const end = warning.endColumn - 1;

  if (start < 0 || end <= start || end > line.length) return null;

  const candidate = line.slice(start, end);

  return HEX_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

// Every diagnostic that is not a known `color-no-hex` finding makes the run
// fail closed: an unknown diagnostic must never be silently ignored.
function collectFileDiagnostics(fileResult, relativePath) {
  const diagnostics = [];

  for (const warning of fileResult.warnings ?? []) {
    if (warning.rule !== 'color-no-hex') {
      diagnostics.push(
        `${relativePath}:${warning.line}:${warning.column} unknown diagnostic ` +
          `"${warning.rule ?? 'no rule'}": ${warning.text}`,
      );
    }
  }

  for (const problem of fileResult.parseErrors ?? []) {
    diagnostics.push(`${relativePath}: parse error: ${problem.text}`);
  }

  for (const problem of fileResult.invalidOptionWarnings ?? []) {
    diagnostics.push(`${relativePath}: invalid option: ${problem.text}`);
  }

  for (const problem of fileResult.deprecations ?? []) {
    diagnostics.push(`${relativePath}: deprecated feature: ${problem.text}`);
  }

  return diagnostics;
}

// Lints one CSS file with the real stylelint API and returns the hex counts
// per lowercase hex value. Disable comments are ignored on purpose: a file
// must not be able to switch the gate off for itself.
async function lintCssFile(stylelint, { relativePath, absolutePath, source }) {
  const result = await stylelint.lint({
    code: source,
    codeFilename: absolutePath,
    config: STYLELINT_CONFIG,
    ignoreDisables: true,
  });

  const results = result.results ?? [];

  if (results.length !== 1) {
    return { errors: [`${relativePath}: Stylelint returned ${results.length} results instead of one.`] };
  }

  const fileResult = results[0];
  const diagnostics = collectFileDiagnostics(fileResult, relativePath);

  if (diagnostics.length > 0) return { errors: diagnostics };

  const counts = new Map();

  for (const warning of fileResult.warnings ?? []) {
    const hex = extractHexFromWarning(source, warning);

    if (hex === null) {
      return {
        errors: [
          `${relativePath}:${warning.line}:${warning.column} ` +
            'The hex value at the reported position is not readable.',
        ],
      };
    }

    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }

  if (fileResult.errored && counts.size === 0) {
    return {
      errors: [`${relativePath}: Stylelint reports an error without a recognizable color-no-hex diagnostic.`],
    };
  }

  return { counts };
}

function isRelativePosixPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\\') || value.startsWith('/')) return false;

  return !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

// Parses and validates the baseline. Every malformed baseline is an error,
// never a silently empty baseline.
function parseBaseline(raw, baselinePath) {
  let payload;

  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Baseline ${baselinePath} is not valid JSON: ${error.message}`);
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Baseline ${baselinePath} has an invalid format.`);
  }

  if (payload.version !== BASELINE_VERSION) {
    throw new Error(`Baseline ${baselinePath} has version ${payload.version}, expected ${BASELINE_VERSION}.`);
  }

  if (!payload.files || typeof payload.files !== 'object' || Array.isArray(payload.files)) {
    throw new Error(`Baseline ${baselinePath} has no valid "files" section.`);
  }

  const files = new Map();

  for (const [file, counts] of Object.entries(payload.files)) {
    if (!isRelativePosixPath(file)) {
      throw new Error(`Baseline ${baselinePath} contains the invalid path "${file}".`);
    }

    if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
      throw new Error(`Baseline ${baselinePath}: "${file}" has no valid count.`);
    }

    const entries = new Map();

    for (const [hex, count] of Object.entries(counts)) {
      if (!BASELINE_HEX_PATTERN.test(hex)) {
        throw new Error(`Baseline ${baselinePath}: "${hex}" in "${file}" is not a lowercase hex value.`);
      }

      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`Baseline ${baselinePath}: "${hex}" in "${file}" has no valid count.`);
      }

      entries.set(hex, count);
    }

    files.set(file, entries);
  }

  return { version: payload.version, updatedAt: payload.updatedAt ?? null, files };
}

// A new hex value or a rising count is a regression, a falling count is not.
function compareFileCounts(baselineCounts, currentCounts) {
  const regressions = [];

  for (const [hex, current] of currentCounts) {
    const baseline = baselineCounts.get(hex) ?? 0;

    if (current > baseline) {
      regressions.push({
        hex,
        baseline,
        current,
        kind: baseline === 0 ? 'new value' : 'count increased',
      });
    }
  }

  return regressions;
}

function sumCounts(counts) {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

function failedRun(errors) {
  return {
    ok: false,
    errors,
    regressions: [],
    checkedFiles: 0,
    hexTotal: 0,
    baselineTotal: 0,
    baselineFiles: 0,
    baselineUpdatedAt: null,
    exemptFiles: [],
  };
}

async function runStyleStats({ root = ROOT, baselinePath = BASELINE_PATH, files, stylelint } = {}) {
  const errors = [];
  const regressions = [];
  const exemptFiles = [];
  let checkedFiles = 0;
  let hexTotal = 0;

  let rawBaseline;

  try {
    rawBaseline = fs.readFileSync(baselinePath, 'utf8');
  } catch (error) {
    return failedRun([`Baseline ${baselinePath} cannot be read: ${error.message}`]);
  }

  let baseline;

  try {
    baseline = parseBaseline(rawBaseline, baselinePath);
  } catch (error) {
    return failedRun([error.message]);
  }

  let targets;

  if (files) {
    targets = files;
  } else {
    let cssFiles;

    try {
      cssFiles = findCssFiles(root);
    } catch (error) {
      return failedRun([`File search under ${root} failed: ${error.message}`]);
    }

    targets = cssFiles.map((relativePath) => ({
      relativePath,
      absolutePath: path.join(root, relativePath),
    }));
  }

  for (const target of targets) {
    let source;

    try {
      source = fs.readFileSync(target.absolutePath, 'utf8');
    } catch (error) {
      errors.push(`${target.relativePath}: file not readable (${error.message}).`);
      continue;
    }

    let outcome;

    try {
      outcome = await lintCssFile(stylelint, { ...target, source });
    } catch (error) {
      errors.push(`${target.relativePath}: Stylelint failed (${error.message}).`);
      continue;
    }

    if (outcome.errors) {
      errors.push(...outcome.errors);
      continue;
    }

    checkedFiles += 1;

    const hexCount = sumCounts(outcome.counts);

    if (target.relativePath === CANONICAL_TOKEN_FILE) {
      exemptFiles.push({ file: target.relativePath, hexes: hexCount });
      continue;
    }

    hexTotal += hexCount;

    const baselineCounts = baseline.files.get(target.relativePath) ?? new Map();

    for (const regression of compareFileCounts(baselineCounts, outcome.counts)) {
      regressions.push({ file: target.relativePath, ...regression });
    }
  }

  const baselineTotal = [...baseline.files.values()].reduce((sum, counts) => sum + sumCounts(counts), 0);

  return {
    ok: errors.length === 0 && regressions.length === 0,
    errors,
    regressions,
    checkedFiles,
    hexTotal,
    baselineTotal,
    baselineFiles: baseline.files.size,
    baselineUpdatedAt: baseline.updatedAt,
    exemptFiles,
  };
}

function formatSummary(result) {
  const stand = result.baselineUpdatedAt ? ` (as of ${result.baselineUpdatedAt})` : '';
  const lines = [
    `style-stats: ${result.checkedFiles} CSS files checked, ` +
      `${result.hexTotal} hex values outside the token file.`,
    `Baseline:   ${result.baselineTotal} hex values in ${result.baselineFiles} files${stand}.`,
  ];

  for (const exempt of result.exemptFiles) {
    lines.push(`Exempt:     ${exempt.file} (${exempt.hexes} hex values, canonical token file).`);
  }

  return lines.join('\n');
}

function formatRegression(regression) {
  return (
    `  ${regression.file}: ${regression.hex} ${regression.kind} ` +
    `(Baseline ${regression.baseline}, current ${regression.current})`
  );
}

async function main() {
  const stylelintModule = await import('stylelint');
  const stylelint = stylelintModule.default ?? stylelintModule;
  const result = await runStyleStats({ stylelint });

  console.log(formatSummary(result));

  if (result.errors.length > 0) {
    console.error('\nstyle-stats: error (Fail-Closed):');

    for (const error of result.errors) console.error(`  ${error}`);

    process.exitCode = 2;
    return;
  }

  if (result.regressions.length > 0) {
    console.error('\nstyle-stats: REGRESSIONS detected:');

    for (const regression of result.regressions) console.error(formatRegression(regression));

    console.error('\nstyle-stats: Replace the hex values with design tokens or reduce their number.');
    process.exitCode = 1;
    return;
  }

  console.log('\nstyle-stats: no regressions.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`style-stats: unexpected error: ${error.message}`);
    process.exitCode = 2;
  });
}

module.exports = {
  BASELINE_PATH,
  BASELINE_VERSION,
  CANONICAL_TOKEN_FILE,
  STYLELINT_CONFIG,
  compareFileCounts,
  extractHexFromWarning,
  findCssFiles,
  formatRegression,
  formatSummary,
  lintCssFile,
  parseBaseline,
  runStyleStats,
};
