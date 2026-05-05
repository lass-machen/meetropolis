/* eslint-disable */
// Lightweight budget enforcement without external deps.
// Checks:
// - Max lines per file (error if above hard limit)
// - Approx. max lines per function/arrow function (best-effort)
//
// Hard limits reflect AGENTS.md budgets:
// - React/TS/Server-Dateien: absolut ≤ 600 Zeilen
// - Funktion/Komponente: absolut ≤ 80 Zeilen
//
// This script is intentionally conservative to avoid false positives
// that could break developer workflows. It errs on the side of not
// flagging ambiguous patterns.

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();
const TARGET_DIRS = [
  'apps/web/src',
  'apps/server/src',
  'packages/shared/src',
];

const HARD_LIMIT_FILE_LINES = 600;
const HARD_LIMIT_FUNCTION_LINES = 80;

const TS_LIKE_EXTENSIONS = new Set(['.ts', '.tsx']);

// Pfad-Praefixe, die immer uebersprungen werden:
// - generated/: Prisma-Client + Runtime, autogeneriert, keine Refactor-Kandidaten
// - .test./.spec.: Tests duerfen laenger sein als Produktivcode
const ALWAYS_EXCLUDE_PREFIXES = [
  'apps/server/src/generated/',
];
const ALWAYS_EXCLUDE_REGEX = /\.(test|spec)\.(ts|tsx)$/;

// Optionale Allowlist fuer preexistente, geplante-Refactor-Files. Format pro
// Zeile: "<relativer-pfad>  <reason>". Lines mit '#' am Anfang sind Kommentare.
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
  const arrowAssign = /^(export\s+)?(const|let|var)\s+[A-Za-z0-9_$]+\s*([:<][^=]+)?=\s*(async\s*)?\([^)]*\)\s*=>\s*\{/.test(
    trimmed
  );
  return fnDecl || arrowAssign;
}

function isConciseArrowStart(line) {
  // const Name = (...) => expr (no opening brace)
  const trimmed = line.trim();
  return /^(export\s+)?(const|let|var)\s+[A-Za-z0-9_$]+\s*([:<][^=]+)?=\s*(async\s*)?\([^)]*\)\s*=>\s*(?!\{).+/.test(
    trimmed
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

function analyzeFunctions(lines) {
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
            if (length > HARD_LIMIT_FUNCTION_LINES) {
              violations.push({
                type: 'function',
                start: startLine + 1,
                end: j + 1,
                length,
                message: `Funktion überschreitet ${HARD_LIMIT_FUNCTION_LINES} Zeilen (gefunden: ${length})`,
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
            if (length > HARD_LIMIT_FUNCTION_LINES) {
              violations.push({
                type: 'function',
                start: startLine + 1,
                end: j + 1,
                length,
                message: `Funktion überschreitet ${HARD_LIMIT_FUNCTION_LINES} Zeilen (gefunden: ${length})`,
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
      // nothing to check against HARD_LIMIT_FUNCTION_LINES
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
        message: `Datei überschreitet ${HARD_LIMIT_FILE_LINES} Zeilen (gefunden: ${lines.length})`,
      });
    }
    const functionViolations = analyzeFunctions(lines);
    for (const v of functionViolations) {
      errors.push({
        file: `${rel}:${v.start}-${v.end}`,
        message: v.message,
      });
    }
  }

  if (errors.length > 0) {
    console.error('Budget-Verstöße gefunden:');
    for (const err of errors) {
      console.error(`- ${err.file}: ${err.message}`);
    }
    if (skippedCount > 0) {
      console.error(`(${skippedCount} Files via generated/, *.test.* oder .budgetignore uebersprungen)`);
    }
    process.exit(1);
  } else {
    console.log(`OK: Keine Budget-Verstöße gefunden. (${skippedCount} Files uebersprungen)`);
  }
}

main();


