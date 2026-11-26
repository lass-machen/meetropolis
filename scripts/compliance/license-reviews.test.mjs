import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDependencies } from './dependencies.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const COMPLIANCE_DIR = path.join(REPO_ROOT, 'compliance');

const POLICY_PATH = 'compliance/policy.json';
const EVIDENCE_PATH = 'compliance/dependency-evidence.json';
const REVIEWS_PATH = 'compliance/license-reviews.json';
const ROOT_LOCK_PATH = 'package-lock.json';
const ASSET_LOCK_PATH = 'tools/asset-lab/package-lock.json';

const policyBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'policy.json'));
const policyDoc = JSON.parse(policyBytes.toString('utf8'));
const evidenceBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'dependency-evidence.json'));
const reviewsBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'license-reviews.json'));
const reviewsDoc = JSON.parse(reviewsBytes.toString('utf8'));
const committedLock = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package-lock.json'), 'utf8'));
const rootLockConfig = policyDoc.lockfiles.find((lock) => lock.path === ROOT_LOCK_PATH);

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const makeLock = (packages) =>
  jsonBytes({ name: 'meetropolis', version: '0.1.0', lockfileVersion: 3, requires: true, packages });

const [approval] = reviewsDoc.approvals;
const approvedPackage = () => ({
  version: approval.version,
  integrity: approval.integrity,
  devOptional: true,
  license: approval.license,
});

// Root lock with every configured root; the server root consumes the given
// direct dependencies, all other roots are empty workspaces.
const rootLock = ({ server = { elkjs: '^0.11.0' }, packages = {} } = {}) => {
  const entries = {};
  for (const root of rootLockConfig.roots) {
    entries[root] = { name: 'workspace', version: '0.0.0', license: 'MIT' };
  }
  entries['apps/server'] = { name: 'server', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: server };
  entries['node_modules/elkjs'] = approvedPackage();
  return makeLock({ ...entries, ...packages });
};

const snapshot = ({ lock = rootLock(), reviews = reviewsBytes } = {}) => {
  const files = new Map();
  files.set(POLICY_PATH, policyBytes);
  files.set(EVIDENCE_PATH, evidenceBytes);
  if (reviews !== null) files.set(REVIEWS_PATH, reviews);
  files.set(ROOT_LOCK_PATH, lock);
  files.set(ASSET_LOCK_PATH, makeLock({ '': { name: 'asset-lab', version: '0.0.0', license: 'MIT' } }));
  return files;
};

const reviewsWith = (changes) =>
  jsonBytes({ ...reviewsDoc, approvals: [{ ...approval, ...changes }, ...reviewsDoc.approvals.slice(1)] });
const codesFor = (issues, lockPath) =>
  issues.filter((issue) => issue.lockPath === lockPath).map((issue) => `${issue.severity}:${issue.code}`);
const errorCodes = (issues) => issues.filter((issue) => issue.severity === 'error').map((issue) => issue.code);

describe('license review approvals', () => {
  it('binds exactly elkjs 0.11.1 of the server root to the committed lockfile entry', () => {
    assert.equal(reviewsDoc.approvals.length, 1);
    const entry = committedLock.packages['node_modules/elkjs'];
    assert.deepEqual(
      {
        lockfile: approval.lockfile,
        root: approval.root,
        lockPath: approval.lockPath,
        name: approval.name,
        version: approval.version,
        integrity: approval.integrity,
        license: approval.license,
        approvedBy: approval.approvedBy,
      },
      {
        lockfile: 'package-lock.json',
        root: 'apps/server',
        lockPath: 'node_modules/elkjs',
        name: 'elkjs',
        version: entry.version,
        integrity: entry.integrity,
        license: entry.license,
        approvedBy: 'user',
      },
    );
    assert.match(approval.decidedOn, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it('lifts the review finding of exactly the approved record', () => {
    const { records, issues } = checkDependencies({ files: snapshot() });
    assert.deepEqual(errorCodes(issues), []);
    assert.deepEqual(codesFor(issues, 'node_modules/elkjs'), ['info:LICENSE_REVIEW_APPROVED']);
    const record = records.find((entry) => entry.lockPath === 'node_modules/elkjs');
    assert.equal(record.effectiveLicense, 'EPL-2.0');
    assert.deepEqual(record.selectedLicenses, []);
  });

  it('keeps the finding open without a register', () => {
    const { issues } = checkDependencies({ files: snapshot({ reviews: null }) });
    assert.deepEqual(errorCodes(issues), ['LICENSE_REVIEW_REQUIRED']);
  });

  it('keeps another EPL package open next to the approved one', () => {
    const lock = rootLock({
      server: { elkjs: '^0.11.0', other: '^1.0.0' },
      packages: { 'node_modules/other': { version: '1.0.0', integrity: 'sha512-b3RoZXI=', license: 'EPL-2.0' } },
    });
    const { issues } = checkDependencies({ files: snapshot({ lock }) });
    assert.deepEqual(codesFor(issues, 'node_modules/other'), ['error:LICENSE_REVIEW_REQUIRED']);
    assert.deepEqual(codesFor(issues, 'node_modules/elkjs'), ['info:LICENSE_REVIEW_APPROVED']);
  });

  it('keeps another version or another SRI of elkjs open and reports the approval as stale', () => {
    for (const change of [{ version: '0.11.2' }, { integrity: 'sha512-Y2hhbmdlZA==' }]) {
      const lock = rootLock({ packages: { 'node_modules/elkjs': { ...approvedPackage(), ...change } } });
      const { issues } = checkDependencies({ files: snapshot({ lock }) });
      assert.deepEqual(errorCodes(issues).sort(), ['LICENSE_REVIEW_REQUIRED', 'LICENSE_REVIEW_STALE'], change);
    }
  });

  it('keeps elkjs open under another root and in a nested lock path', () => {
    const otherRoot = rootLock({
      server: {},
      packages: { 'apps/web': { name: 'web', version: '0.1.0', license: 'MIT', dependencies: { elkjs: '^0.11.0' } } },
    });
    const moved = checkDependencies({ files: snapshot({ lock: otherRoot }) });
    assert.deepEqual(errorCodes(moved.issues).sort(), ['LICENSE_REVIEW_REQUIRED', 'LICENSE_REVIEW_STALE']);
    assert.ok(moved.issues.some((issue) => issue.code === 'LICENSE_REVIEW_REQUIRED' && issue.root === 'apps/web'));

    const nested = rootLock({
      server: {},
      packages: {
        'apps/server': { name: 'server', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { tool: '^1.0.0' } },
        'node_modules/tool': { version: '1.0.0', license: 'MIT', dependencies: { elkjs: '^0.11.0' } },
        'node_modules/tool/node_modules/elkjs': approvedPackage(),
      },
    });
    const { issues } = checkDependencies({ files: snapshot({ lock: nested }) });
    assert.deepEqual(codesFor(issues, 'node_modules/tool/node_modules/elkjs'), ['error:LICENSE_REVIEW_REQUIRED']);
  });

  it('never lifts a forbidden part of a combined expression', () => {
    const license = 'EPL-2.0 AND GPL-3.0-only';
    const lock = rootLock({ packages: { 'node_modules/elkjs': { ...approvedPackage(), license } } });
    const { issues } = checkDependencies({ files: snapshot({ lock, reviews: reviewsWith({ license }) }) });
    assert.deepEqual(errorCodes(issues).sort(), ['LICENSE_REVIEW_REQUIRED', 'LICENSE_REVIEW_STALE']);
    assert.ok(!issues.some((issue) => issue.code === 'LICENSE_REVIEW_APPROVED'));
  });

  it('keeps elkjs open when its license value changes', () => {
    const lock = rootLock({ packages: { 'node_modules/elkjs': { ...approvedPackage(), license: 'MPL-2.0' } } });
    const { issues } = checkDependencies({ files: snapshot({ lock }) });
    assert.deepEqual(errorCodes(issues).sort(), ['LICENSE_REVIEW_REQUIRED', 'LICENSE_REVIEW_STALE']);
  });

  it('rejects approvals without the decision of the user or with an open decision date', () => {
    const changes = [
      { approvedBy: 'project-lead' },
      { decidedOn: '[[open]]' },
      { decidedOn: '2026-13-01' },
      { id: 'ENV-DECISION-001' },
      { lockPath: 'apps/server' },
      { scope: 'all' },
    ];
    for (const change of changes) {
      assert.throws(
        () => checkDependencies({ files: snapshot({ reviews: reviewsWith(change) }) }),
        (error) => error.code === 'COMPLIANCE_DATA_INVALID',
        JSON.stringify(change),
      );
    }
    const duplicate = jsonBytes({ ...reviewsDoc, approvals: [approval, { ...approval, id: 'LICENSE-DECISION-002' }] });
    assert.throws(
      () => checkDependencies({ files: snapshot({ reviews: duplicate }) }),
      (error) => error.code === 'COMPLIANCE_DATA_INVALID',
    );
  });
});
