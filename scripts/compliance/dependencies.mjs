// Offline license check for the production dependency closure.
//
// Connects the three existing compliance modules into one policy-driven
// pass over a repository snapshot:
//   - dependency-graph.mjs resolves the production closure of every
//     configured lockfile,
//   - dependency-evidence.mjs maps packages with a missing or non-SPDX raw
//     license field onto checked original license texts,
//   - license-expression.mjs evaluates the resulting SPDX expression
//     against the license set of the consuming area,
//   - license-reviews.mjs applies the bound decisions of the user to
//     records whose license needs a review.
//
// The check is pure: it reads only from the given snapshot map, never opens
// a file, never uses the network or node_modules, and neither writes nor
// prints anything.

import { collectProductionDependencies } from './dependency-graph.mjs';
import {
  configuredGlobalRoots,
  fail,
  globalPath,
  isNonEmptyString,
  isObject,
  parseJsonBytes,
  readEvidence,
  readExtraDependencies,
  readPolicy,
  readSnapshot,
} from './dependencies-policy.mjs';
import { evaluateLicenseExpression } from './license-expression.mjs';
import { resolveDependencyLicense } from './dependency-evidence.mjs';
import { createLicenseReviewLedger, readLicenseReviews } from './license-reviews.mjs';

const LOCKFILE_BASENAME = 'package-lock.json';

function compareStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function basenameOf(path) {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

// Area of a global workspace path: the longest matching area path wins.
function areaFor(globalRoot, areas) {
  let best = null;
  let bestLength = -1;
  for (const area of areas) {
    for (const candidate of area.paths) {
      const matches = candidate === '' || globalRoot === candidate || globalRoot.startsWith(`${candidate}/`);
      if (matches && candidate.length > bestLength) {
        best = area;
        bestLength = candidate.length;
      }
    }
  }
  return best;
}

// True when the expression mentions one of the ids that need a legal review.
function mentionsReviewRequiredId(expression, reviewRequiredIds) {
  if (reviewRequiredIds.length === 0) return false;
  const tokens = expression
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);
  return tokens.some((token) => reviewRequiredIds.includes(token));
}

// Evaluates the license of one record against the license set of the area
// of its consuming root. A bound approval only lifts a review finding whose
// expression would pass once the review ids are allowed: a forbidden part of
// the expression stays forbidden.
function evaluateAgainstArea(license, area, policy, review, issues) {
  const context = review.context;
  if (typeof license !== 'string' || license.trim().length === 0) {
    issues.push({ severity: 'error', code: 'LICENSE_MISSING', ...context });
    return { license: null, selected: [] };
  }
  const allowed = [...policy.commonAllowedLicenses, ...area.additionalAllowedLicenses];
  const result = evaluateLicenseExpression(license, allowed);
  if (result.ok) return { license, selected: result.selected };
  if (result.code === 'LICENSE_EXPRESSION_INVALID') {
    issues.push({ severity: 'error', code: 'LICENSE_EXPRESSION_INVALID', ...context });
    return { license: null, selected: [] };
  }
  const reviewRequired = mentionsReviewRequiredId(license, policy.reviewRequiredIds);
  if (
    reviewRequired &&
    evaluateLicenseExpression(license, [...allowed, ...policy.reviewRequiredIds]).ok &&
    review.reviews.approves(context, review.record, license)
  ) {
    issues.push({ severity: 'info', code: 'LICENSE_REVIEW_APPROVED', ...context });
    return { license, selected: [] };
  }
  const code = reviewRequired ? 'LICENSE_REVIEW_REQUIRED' : 'LICENSE_NOT_ALLOWED';
  issues.push({ severity: 'error', code, ...context });
  return { license, selected: [] };
}

// Internal workspaces are dependencies too: their own manifest decides the
// license, a missing license field is never replaced by an area default.
function readWorkspaceLicense(record, lockPath, snapshot, context, issues) {
  const workspacePath = globalPath(lockPath, record.lockPath);
  const manifestPath = workspacePath === '' ? 'package.json' : `${workspacePath}/package.json`;
  const bytes = snapshot.get(manifestPath);
  if (bytes === undefined) {
    issues.push({ severity: 'error', code: 'WORKSPACE_MANIFEST_MISSING', ...context });
    return null;
  }
  let manifest = null;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    manifest = null;
  }
  if (!isObject(manifest)) {
    issues.push({ severity: 'error', code: 'WORKSPACE_MANIFEST_MISSING', ...context });
    return null;
  }
  const manifestLicense = isNonEmptyString(manifest.license) ? manifest.license : null;
  if (manifestLicense === null) {
    issues.push({ severity: 'error', code: 'LICENSE_MISSING', ...context });
    return null;
  }
  if (isNonEmptyString(record.rawLicense) && record.rawLicense !== manifestLicense) {
    issues.push({ severity: 'error', code: 'WORKSPACE_LICENSE_MISMATCH', ...context });
  }
  return manifestLicense;
}

// One record of the production graph under the policy of its consuming root.
function buildRecord(record, lockPath, snapshot, policy, evidence, reviews, issues) {
  const globalRoot = globalPath(lockPath, record.root);
  const area = areaFor(globalRoot, policy.areas);
  const context = { path: lockPath, root: globalRoot, lockPath: record.lockPath };
  const resolved = resolveDependencyLicense(record, evidence.entries, evidence.licenseFiles);
  for (const issue of resolved.issues) {
    issues.push({ severity: 'error', code: issue.code, ...context });
  }
  const license = record.workspace
    ? readWorkspaceLicense(record, lockPath, snapshot, context, issues)
    : resolved.license;
  if (!record.workspace && !isNonEmptyString(record.version)) {
    issues.push({ severity: 'error', code: 'DEPENDENCY_VERSION_MISSING', ...context });
  }
  const evaluated = evaluateAgainstArea(license, area, policy, { context, record, reviews }, issues);
  return {
    ...record,
    globalRoot,
    area: area.id,
    effectiveLicense: evaluated.license,
    selectedLicenses: evaluated.selected,
  };
}

// Every package entry of the lock that is not inside node_modules is a
// workspace of its own and has to be a configured root of that lock.
function rootCoverageIssues(lock, parsed) {
  const issues = [];
  const configured = new Set(lock.roots);
  for (const key of Object.keys(parsed.packages).sort(compareStrings)) {
    if (/(^|\/)node_modules(\/|$)/.test(key)) continue;
    if (configured.has(key)) continue;
    issues.push({
      severity: 'error',
      code: 'LOCKFILE_ROOT_UNCONFIGURED',
      path: lock.path,
      root: globalPath(lock.path, key),
      lockPath: key,
    });
  }
  return issues;
}

// Production closure of one configured lockfile.
function collectLock(lock, snapshot, policy, evidence, reviews, extras, records, issues) {
  const bytes = snapshot.get(lock.path);
  if (bytes === undefined) {
    issues.push({ severity: 'error', code: 'LOCKFILE_MISSING', path: lock.path, root: '' });
    return;
  }
  const parsed = parseJsonBytes(bytes, lock.path, 'LOCKFILE_INVALID');
  if (!isObject(parsed)) {
    fail('LOCKFILE_INVALID', `invalid lockfile: ${lock.path} is not an object`);
  }
  const roots = lock.roots.map((root) => ({
    path: root,
    extraDependencies: extras.get(globalPath(lock.path, root)) ?? [],
  }));
  const graph = collectProductionDependencies({ lockfile: lock.path, lock: parsed, roots });
  issues.push(...rootCoverageIssues(lock, parsed));
  for (const issue of graph.issues) {
    issues.push({
      severity: issue.severity,
      code: issue.code,
      path: lock.path,
      root: globalPath(lock.path, issue.root),
      lockPath: issue.from,
    });
  }
  for (const record of graph.records) {
    records.push(buildRecord(record, lock.path, snapshot, policy, evidence, reviews, issues));
  }
}

// Checks the production dependencies of every configured lockfile against the
// license policy of the consuming area.
// files: Map of repository relative path to file bytes.
// extraDependencies: global workspace path to explicitly added package names.
// Returns { records, issues } and has no output or write side effects.
export function checkDependencies({ files, extraDependencies = {} } = {}) {
  const snapshot = readSnapshot(files);
  const policy = readPolicy(snapshot);
  const evidence = readEvidence(snapshot);
  const reviews = createLicenseReviewLedger(readLicenseReviews(snapshot));
  const extras = readExtraDependencies(extraDependencies, configuredGlobalRoots(policy.lockfiles));
  const records = [];
  const issues = [];
  const configured = new Set(policy.lockfiles.map((lock) => lock.path));
  for (const key of [...snapshot.keys()].sort(compareStrings)) {
    if (basenameOf(key) !== LOCKFILE_BASENAME || configured.has(key)) continue;
    issues.push({ severity: 'error', code: 'LOCKFILE_UNCONFIGURED', path: key, root: '' });
  }
  for (const lock of policy.lockfiles) {
    collectLock(lock, snapshot, policy, evidence, reviews, extras, records, issues);
  }
  issues.push(...reviews.staleIssues());
  records.sort(
    (a, b) =>
      compareStrings(a.globalRoot, b.globalRoot) ||
      compareStrings(a.lockfile, b.lockfile) ||
      compareStrings(a.lockPath, b.lockPath),
  );
  issues.sort(
    (a, b) =>
      compareStrings(a.root, b.root) ||
      compareStrings(a.path, b.path) ||
      compareStrings(a.lockPath ?? '', b.lockPath ?? '') ||
      compareStrings(a.code, b.code),
  );
  return { records, issues };
}
