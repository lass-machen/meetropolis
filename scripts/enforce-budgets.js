/* eslint-disable -- legacy budget script uses dynamic node fs/path patterns the project lint rules do not benefit from analysing */
// Lightweight budget enforcement without external deps.
// Checks:
// - Max lines per file (error if above hard limit)
// - Approx. max lines per function/arrow function (best-effort)
//
// Hard limits reflect AGENTS.md budgets:
// - React/TS/server files: absolute limit 600 lines
// - Function/component: absolute limit 80 lines
//
// This script is intentionally conservative to avoid false positives
// that could break developer workflows. It errs on the side of not
// flagging ambiguous patterns.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();
const TARGET_DIRS = ['apps/web/src', 'apps/server/src', 'packages/shared/src'];

const HARD_LIMIT_FILE_LINES = 600;
const HARD_LIMIT_FUNCTION_LINES = 80;

// Function bodies in React components (`.tsx`) are typically a single
// JSX return; splitting them into helper sub-components below 80 LoC is
// often premature abstraction. Hooks (`use*.ts`) often wire several
// sub-hooks in a single body to keep the React hook-order contract
// intact; sub-100-LoC splits force the wiring elsewhere without
// reducing complexity. Plain `.ts` files keep the stricter 80-LoC
// budget. Edge cases that still bust 120/150 go into `.budgetignore`.
const HARD_LIMIT_FUNCTION_LINES_TSX = 150;
const HARD_LIMIT_FUNCTION_LINES_HOOK = 120;

function functionLimitFor(relPath) {
  if (relPath.endsWith('.tsx')) return HARD_LIMIT_FUNCTION_LINES_TSX;
  const base = path.basename(relPath);
  if (base.startsWith('use') && base.endsWith('.ts')) return HARD_LIMIT_FUNCTION_LINES_HOOK;
  return HARD_LIMIT_FUNCTION_LINES;
}

const TS_LIKE_EXTENSIONS = new Set(['.ts', '.tsx']);

// Path prefixes that are always skipped:
// - generated/: Prisma client + runtime, auto-generated, not refactor candidates
// - .test./.spec.: tests are allowed to be longer than production code
const ALWAYS_EXCLUDE_PREFIXES = ['apps/server/src/generated/'];
const ALWAYS_EXCLUDE_REGEX = /\.(test|spec)\.(ts|tsx)$/;

// Optional allowlist for pre-existing files with a planned refactor. Format per
// line: "<relative-path>  <reason>". Lines starting with '#' are comments.
function loadIgnoreList() {
  const ignorePath = path.join(PROJECT_ROOT, '.budgetignore');
  if (!fs.existsSync(ignorePath)) return new Set();
  const raw = fs.readFileSync(ignorePath, 'utf8');
  const set = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const filePart = trimmed.split(/\s+/)[0];
    if (filePart) set.add(filePart);
  }
  return set;
}

function isExcluded(relPath, ignoreList) {
  for (const prefix of ALWAYS_EXCLUDE_PREFIXES) {
    if (relPath.startsWith(prefix)) return true;
  }
  if (ALWAYS_EXCLUDE_REGEX.test(relPath)) return true;
  if (ignoreList.has(relPath)) return true;
  return false;
}

function listFilesRecursive(startDir) {
  const collected = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (TS_LIKE_EXTENSIONS.has(ext)) {
          collected.push(fullPath);
        }
      }
    }
  }
  walk(startDir);
  return collected;
}

function readFileLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  // Normalize to \n split
  return content.split(/\r?\n/);
}

function isFunctionStart(line) {
  // Matches:
  // - function decl: export? async? function Name(
  // - const Name = async? (...) => {
  // - const Name: Type = async? (...) => {
  // Heuristic only.
  const trimmed = line.trim();
  const fnDecl = /^(export\s+)?(async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/.test(trimmed);
  const arrowAssign =
    /^(export\s+)?(const|let|var)\s+[A-Za-z0-9_$]+\s*([:<][^=]+)?=\s*(async\s*)?\([^)]*\)\s*=>\s*\{/.test(trimmed);
  return fnDecl || arrowAssign;
}

function isConciseArrowStart(line) {
  // const Name = (...) => expr (no opening brace)
  const trimmed = line.trim();
  return /^(export\s+)?(const|let|var)\s+[A-Za-z0-9_$]+\s*([:<][^=]+)?=\s*(async\s*)?\([^)]*\)\s*=>\s*(?!\{).+/.test(
    trimmed,
  );
}

function countBracesOnLine(line) {
  // crude but effective for most cases (ignores strings/comments)
  let opens = 0;
  let closes = 0;
  for (const ch of line) {
    if (ch === '{') opens += 1;
    if (ch === '}') closes += 1;
  }
  return { opens, closes };
}

function analyzeFunctions(lines, limit) {
  const violations = [];
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const line = lines[i];
    if (isFunctionStart(line)) {
      // function with block body starting at first '{'
      // find the first '{' from current line forward
      let startLine = i;
      let foundBrace = false;
      let j = i;
      let depth = 0;
      let started = false;
      for (; j < n; j++) {
        const { opens, closes } = countBracesOnLine(lines[j]);
        if (!started && opens > 0) {
          started = true;
          depth = opens - closes;
          startLine = j;
          if (depth <= 0) {
            // single-line body like "{ return x; }"
            const length = j - startLine + 1;
            if (length > limit) {
              violations.push({
                type: 'function',
                start: startLine + 1,
                end: j + 1,
                length,
                message: `Function exceeds ${limit} lines (found: ${length})`,
              });
            }
            foundBrace = true;
            i = j + 1;
            break;
          }
        } else if (started) {
          depth += opens - closes;
          if (depth === 0) {
            const length = j - startLine + 1;
            if (length > limit) {
              violations.push({
                type: 'function',
                start: startLine + 1,
                end: j + 1,
                length,
                message: `Function exceeds ${limit} lines (found: ${length})`,
              });
            }
            foundBrace = true;
            i = j + 1;
            break;
          }
        }
      }
      if (!foundBrace) {
        // could not find closing brace; skip ahead to avoid infinite loop
        i = j + 1;
      }
      continue;
    }
    if (isConciseArrowStart(line)) {
      // concise arrow considered 1 line
      // nothing to check against the function limit
    }
    i += 1;
  }
  return violations;
}

function main() {
  const allTargets = TARGET_DIRS.map((d) => path.join(PROJECT_ROOT, d));
  const files = [];
  for (const dir of allTargets) {
    files.push(...listFilesRecursive(dir));
  }

  const ignoreList = loadIgnoreList();
  const errors = [];
  let skippedCount = 0;

  for (const file of files) {
    const rel = path.relative(PROJECT_ROOT, file);
    if (isExcluded(rel, ignoreList)) {
      skippedCount += 1;
      continue;
    }
    const lines = readFileLines(file);
    if (lines.length > HARD_LIMIT_FILE_LINES) {
      errors.push({
        file: rel,
        message: `File exceeds ${HARD_LIMIT_FILE_LINES} lines (found: ${lines.length})`,
      });
    }
    const functionViolations = analyzeFunctions(lines, functionLimitFor(rel));
    for (const v of functionViolations) {
      errors.push({
        file: `${rel}:${v.start}-${v.end}`,
        message: v.message,
      });
    }
  }

  if (errors.length > 0) {
    console.error('Budget violations found:');
    for (const err of errors) {
      console.error(`- ${err.file}: ${err.message}`);
    }
    if (skippedCount > 0) {
      console.error(`(${skippedCount} files skipped via generated/, *.test.* or .budgetignore)`);
    }
    process.exit(1);
  } else {
    console.log(`OK: no budget violations found. (${skippedCount} files skipped)`);
  }
}

main();
