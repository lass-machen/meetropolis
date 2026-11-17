import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'generated',
  '.vite',
  'playwright-report',
  'test-results',
]);

const IMPORT_FROM_PATTERN = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_PATTERN = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Only this exception: the Express request type is augmented through a
// transitive module, so the side-effect import carries no runtime dependency.
const EXCEPTIONS = [
  {
    workspace: 'apps/server',
    packageName: 'express-serve-static-core',
    reason: 'type-only module augmentation of the Express request type',
  },
];

function packageNameOf(specifier) {
  const segments = specifier.split('/');
  if (specifier.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }
  return segments[0];
}

function isIgnoredSpecifier(specifier, allowedSpecifiers) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':')) {
    return true;
  }
  if (specifier.startsWith('@/') || specifier.startsWith('~')) {
    return true;
  }
  if (builtinModules.includes(specifier) || builtinModules.includes(`node:${specifier}`)) {
    return true;
  }
  return allowedSpecifiers.has(specifier);
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveWorkspaces(root, rootPkg) {
  const patterns = rootPkg.workspaces ?? [];
  const dirs = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const parent = path.join(root, pattern.slice(0, -2));
      if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
        continue;
      }
      for (const entry of fs.readdirSync(parent)) {
        const dir = path.join(parent, entry);
        if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'package.json'))) {
          dirs.push(dir);
        }
      }
    } else {
      const dir = path.join(root, pattern);
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, 'package.json'))) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

function collectSourceFiles(workspaceDir) {
  const files = [];
  const visit = (dir, underGenerated) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) {
          continue;
        }
        visit(path.join(dir, entry.name), underGenerated || entry.name === 'generated');
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!SCAN_EXTENSIONS.has(ext)) {
          continue;
        }
        if (entry.name.endsWith('.d.ts') && underGenerated) {
          continue;
        }
        files.push(path.join(dir, entry.name));
      }
    }
  };
  visit(workspaceDir, false);
  return files.sort();
}

function extractSpecifiers(content) {
  const found = [];
  const patterns = [IMPORT_FROM_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, DYNAMIC_IMPORT_PATTERN, REQUIRE_PATTERN];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const before = content.slice(0, match.index);
      found.push({ specifier: match[1], line: before.split('\n').length });
    }
  }
  return found;
}

export function checkDeps({ root }) {
  const absoluteRoot = path.resolve(root);
  const rootPkg = readJsonFile(path.join(absoluteRoot, 'package.json'));
  const rootDeclared = new Set([
    ...Object.keys(rootPkg.dependencies ?? {}),
    ...Object.keys(rootPkg.devDependencies ?? {}),
    ...Object.keys(rootPkg.peerDependencies ?? {}),
    ...Object.keys(rootPkg.optionalDependencies ?? {}),
  ]);

  const allowedSpecifiers = new Set();
  const policyFile = path.join(absoluteRoot, 'compliance', 'policy.json');
  if (fs.existsSync(policyFile)) {
    const policy = readJsonFile(policyFile);
    for (const entry of policy.sourceImports?.allowedDynamicImports ?? []) {
      allowedSpecifiers.add(entry.specifier);
    }
  }

  const findings = [];
  for (const workspaceDir of resolveWorkspaces(absoluteRoot, rootPkg)) {
    const workspace = path.relative(absoluteRoot, workspaceDir);
    const workspacePkg = readJsonFile(path.join(workspaceDir, 'package.json'));
    const declared = new Set([
      ...rootDeclared,
      ...Object.keys(workspacePkg.dependencies ?? {}),
      ...Object.keys(workspacePkg.devDependencies ?? {}),
      ...Object.keys(workspacePkg.peerDependencies ?? {}),
      ...Object.keys(workspacePkg.optionalDependencies ?? {}),
    ]);
    if (workspacePkg.name) {
      declared.add(workspacePkg.name);
    }
    for (const file of collectSourceFiles(workspaceDir)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const { specifier, line } of extractSpecifiers(content)) {
        if (isIgnoredSpecifier(specifier, allowedSpecifiers)) {
          continue;
        }
        const packageName = packageNameOf(specifier);
        if (declared.has(packageName)) {
          continue;
        }
        if (EXCEPTIONS.some((entry) => entry.workspace === workspace && entry.packageName === packageName)) {
          continue;
        }
        findings.push({
          workspace,
          file: path.relative(absoluteRoot, file),
          line,
          specifier,
          packageName,
        });
      }
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return findings;
}

function countScannedFiles(root) {
  const absoluteRoot = path.resolve(root);
  const rootPkg = readJsonFile(path.join(absoluteRoot, 'package.json'));
  let count = 0;
  for (const workspaceDir of resolveWorkspaces(absoluteRoot, rootPkg)) {
    count += collectSourceFiles(workspaceDir).length;
  }
  return count;
}

const invokedAsCli =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;

if (invokedAsCli) {
  const findings = checkDeps({ root: process.cwd() });
  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `check-deps: ${finding.file}:${finding.line} imports ${finding.packageName} but ${finding.workspace}/package.json does not declare it\n`,
      );
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(`check-deps: ok (${countScannedFiles(process.cwd())} files)\n`);
  }
}
