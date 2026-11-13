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
const ROOT_LOCK_PATH = 'package-lock.json';
const ASSET_LOCK_PATH = 'tools/asset-lab/package-lock.json';

const policyBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'policy.json'));
const policyDoc = JSON.parse(policyBytes.toString('utf8'));
const evidenceBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'dependency-evidence.json'));
const evidenceDoc = JSON.parse(evidenceBytes.toString('utf8'));

const rootLockConfig = policyDoc.lockfiles.find((lock) => lock.path === ROOT_LOCK_PATH);
const assetLockConfig = policyDoc.lockfiles.find((lock) => lock.path === ASSET_LOCK_PATH);

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

// Snapshot with the committed compliance data and the committed original
// license texts of all primary evidence bindings.
const baseSnapshot = () => {
  const files = new Map();
  files.set(POLICY_PATH, policyBytes);
  files.set(EVIDENCE_PATH, evidenceBytes);
  for (const entry of evidenceDoc.entries) {
    for (const file of entry.files) {
      files.set(`compliance/${file.path}`, fs.readFileSync(path.join(COMPLIANCE_DIR, file.path)));
    }
  }
  return files;
};

const makeLock = (packages) =>
  jsonBytes({ name: 'meetropolis', version: '0.1.0', lockfileVersion: 3, requires: true, packages });

// Every configured root of the root lockfile needs a packages entry,
// otherwise the graph refuses the lockfile.
const rootPackages = (overrides = {}) => {
  const packages = {};
  for (const root of rootLockConfig.roots) {
    packages[root] = { name: 'workspace', version: '0.0.0', license: 'MIT' };
  }
  return { ...packages, ...overrides };
};

const assetPackages = (overrides = {}) => ({
  '': { name: 'asset-lab', version: '0.0.0', license: 'MIT' },
  ...overrides,
});

// Fixture policy: the committed policy with explicit roots for the locks of
// the fixture. The committed policy file itself stays untouched.
const policyWithRoots = (overrides) => {
  const doc = JSON.parse(policyBytes.toString('utf8'));
  for (const lock of doc.lockfiles) {
    if (overrides[lock.path]) lock.roots = [...overrides[lock.path]];
  }
  return jsonBytes(doc);
};

const snapshot = ({ root = {}, asset = {}, extra = new Map(), policy = policyBytes } = {}) => {
  const files = baseSnapshot();
  files.set(POLICY_PATH, policy);
  files.set(ROOT_LOCK_PATH, makeLock(rootPackages(root)));
  files.set(ASSET_LOCK_PATH, makeLock(assetPackages(asset)));
  for (const [key, value] of extra) files.set(key, value);
  return files;
};

const hasCode = (issues, code) => issues.some((issue) => issue.code === code);
const byLockPath = (records) => Object.fromEntries(records.map((record) => [record.lockPath, record]));
const manifest = (license, name = 'desk') => jsonBytes({ name, version: '0.1.0', license });

// Workspace packages of the root lock are roots of their own, so the
// fixture policy has to name them explicitly.
const deskRootPolicy = policyWithRoots({ [ROOT_LOCK_PATH]: [...rootLockConfig.roots, 'packages/desk'] });

describe('checkDependencies', () => {
  it('reads the committed lockfile configuration from the policy', () => {
    assert.ok(rootLockConfig, 'root lockfile configuration');
    assert.ok(assetLockConfig, 'asset lab lockfile configuration');
    assert.deepEqual(assetLockConfig.roots, ['']);
    assert.ok(rootLockConfig.roots.includes('packages/shared'));
  });

  it('flags a transitive GPL-only dependency in the MIT area', () => {
    const files = snapshot({
      root: {
        'apps/web': { name: 'web', version: '0.1.0', license: 'MIT', dependencies: { a: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0', license: 'MIT', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0', license: 'GPL-3.0-only' },
      },
    });
    const { records, issues } = checkDependencies({ files });
    const record = byLockPath(records)['node_modules/b'];
    assert.equal(record.name, 'b');
    assert.equal(record.version, '2.0.0');
    assert.equal(record.globalRoot, 'apps/web');
    assert.equal(record.area, 'mit');
    assert.equal(record.effectiveLicense, 'GPL-3.0-only');
    assert.deepEqual(record.selectedLicenses, []);
    assert.ok(hasCode(issues, 'LICENSE_NOT_ALLOWED'));
  });

  it('accepts the same package under MIT in the MIT area', () => {
    const files = snapshot({
      root: {
        'apps/web': { name: 'web', version: '0.1.0', license: 'MIT', dependencies: { a: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0', license: 'MIT', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0', license: 'MIT' },
      },
    });
    const { records, issues } = checkDependencies({ files });
    assert.deepEqual(issues, []);
    const record = byLockPath(records)['node_modules/b'];
    assert.equal(record.globalRoot, 'apps/web');
    assert.equal(record.area, 'mit');
    assert.equal(record.effectiveLicense, 'MIT');
    assert.deepEqual(record.selectedLicenses, ['MIT']);
  });

  it('selects MIT from an MIT OR GPL expression', () => {
    const files = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0', license: 'MIT OR GPL-3.0-only' },
      },
    });
    const { records, issues } = checkDependencies({ files });
    assert.deepEqual(issues, []);
    const record = byLockPath(records)['node_modules/b'];
    assert.equal(record.effectiveLicense, 'MIT OR GPL-3.0-only');
    assert.deepEqual(record.selectedLicenses, ['MIT']);
  });

  it('flags an MIT AND GPL expression', () => {
    const files = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0', license: 'MIT AND GPL-3.0-only' },
      },
    });
    const { records, issues } = checkDependencies({ files });
    assert.ok(hasCode(issues, 'LICENSE_NOT_ALLOWED'));
    assert.deepEqual(byLockPath(records)['node_modules/b'].selectedLicenses, []);
  });

  it('flags a missing and an invalid license value', () => {
    const missing = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0' },
      },
    });
    const missingResult = checkDependencies({ files: missing });
    assert.ok(hasCode(missingResult.issues, 'LICENSE_MISSING'));
    assert.equal(byLockPath(missingResult.records)['node_modules/b'].effectiveLicense, null);

    const invalid = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0', license: 'MIT and ISC' },
      },
    });
    const invalidResult = checkDependencies({ files: invalid });
    assert.ok(hasCode(invalidResult.issues, 'LICENSE_EXPRESSION_INVALID'));
  });

  it('reports MPL and EPL as review required', () => {
    for (const license of ['MPL-2.0', 'EPL-2.0']) {
      const files = snapshot({
        root: {
          '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { b: '^1.0.0' } },
          'node_modules/b': { version: '2.0.0', license },
        },
      });
      const { issues } = checkDependencies({ files });
      assert.ok(hasCode(issues, 'LICENSE_REVIEW_REQUIRED'), license);
      assert.ok(!hasCode(issues, 'LICENSE_NOT_ALLOWED'), license);
    }
  });

  it('flags an AGPL workspace consumed by an MIT root', () => {
    const files = snapshot({
      root: {
        'apps/web': { name: 'web', version: '0.1.0', license: 'MIT', dependencies: { desk: '*' } },
        'node_modules/desk': { link: true, resolved: 'packages/desk' },
        'packages/desk': { name: 'desk', version: '0.1.0', license: 'AGPL-3.0-only' },
      },
      extra: new Map([['packages/desk/package.json', manifest('AGPL-3.0-only')]]),
      policy: deskRootPolicy,
    });
    const { records, issues } = checkDependencies({ files });
    const record = byLockPath(records)['packages/desk'];
    assert.equal(record.workspace, true);
    assert.equal(record.globalRoot, 'apps/web');
    assert.equal(record.area, 'mit');
    assert.equal(record.effectiveLicense, 'AGPL-3.0-only');
    assert.ok(hasCode(issues, 'LICENSE_NOT_ALLOWED'));
  });

  it('accepts an MIT workspace consumed by an AGPL root', () => {
    const files = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { desk: '*' } },
        'node_modules/desk': { link: true, resolved: 'packages/desk' },
        'packages/desk': { name: 'desk', version: '0.1.0', license: 'MIT' },
      },
      extra: new Map([['packages/desk/package.json', manifest('MIT')]]),
      policy: deskRootPolicy,
    });
    const { records, issues } = checkDependencies({ files });
    const record = byLockPath(records)['packages/desk'];
    assert.equal(record.globalRoot, '');
    assert.equal(record.area, 'agpl');
    assert.equal(record.effectiveLicense, 'MIT');
    assert.deepEqual(issues, []);
  });

  it('flags a missing workspace manifest and a missing workspace license field', () => {
    const withoutManifest = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { desk: '*' } },
        'node_modules/desk': { link: true, resolved: 'packages/desk' },
        'packages/desk': { name: 'desk', version: '0.1.0', license: 'MIT' },
      },
      policy: deskRootPolicy,
    });
    assert.ok(hasCode(checkDependencies({ files: withoutManifest }).issues, 'WORKSPACE_MANIFEST_MISSING'));

    const withoutLicense = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { desk: '*' } },
        'node_modules/desk': { link: true, resolved: 'packages/desk' },
        'packages/desk': { name: 'desk', version: '0.1.0', license: 'MIT' },
      },
      extra: new Map([['packages/desk/package.json', jsonBytes({ name: 'desk', version: '0.1.0' })]]),
      policy: deskRootPolicy,
    });
    const result = checkDependencies({ files: withoutLicense });
    assert.ok(hasCode(result.issues, 'LICENSE_MISSING'));
    assert.equal(byLockPath(result.records)['packages/desk'].effectiveLicense, null);
  });

  it('flags a lock and manifest license drift and evaluates the manifest license', () => {
    const files = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { desk: '*' } },
        'node_modules/desk': { link: true, resolved: 'packages/desk' },
        'packages/desk': { name: 'desk', version: '0.1.0', license: 'MIT' },
      },
      extra: new Map([['packages/desk/package.json', manifest('Apache-2.0')]]),
      policy: deskRootPolicy,
    });
    const { records, issues } = checkDependencies({ files });
    assert.ok(hasCode(issues, 'WORKSPACE_LICENSE_MISMATCH'));
    assert.equal(byLockPath(records)['packages/desk'].effectiveLicense, 'Apache-2.0');
    assert.deepEqual(byLockPath(records)['packages/desk'].selectedLicenses, ['Apache-2.0']);
  });

  it('maps all seven primary evidence bindings with the committed license bytes', () => {
    const packages = {
      '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: {} },
    };
    for (const entry of evidenceDoc.entries) {
      packages[''].dependencies[entry.name] = `^${entry.version}`;
      packages[entry.lockPath] = { version: entry.version, integrity: entry.integrity };
      if (entry.rawLicense !== null) packages[entry.lockPath].license = entry.rawLicense;
    }
    const files = snapshot({ root: packages });
    const { records, issues } = checkDependencies({ files });
    assert.deepEqual(issues, []);
    const index = byLockPath(records);
    for (const entry of evidenceDoc.entries) {
      const record = index[entry.lockPath];
      assert.ok(record, entry.lockPath);
      assert.equal(record.name, entry.name, entry.lockPath);
      assert.equal(record.effectiveLicense, entry.license, entry.lockPath);
      assert.equal(record.area, 'agpl', entry.lockPath);
    }
    assert.deepEqual(index['node_modules/@visx/vendor'].selectedLicenses, ['ISC', 'MIT']);
  });

  it('flags a changed evidence binding and a missing license file', () => {
    const evidencePackages = () => {
      const packages = {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: {} },
      };
      for (const entry of evidenceDoc.entries) {
        packages[''].dependencies[entry.name] = `^${entry.version}`;
        packages[entry.lockPath] = { version: entry.version, integrity: entry.integrity };
        if (entry.rawLicense !== null) packages[entry.lockPath].license = entry.rawLicense;
      }
      return packages;
    };

    const changedPackages = evidencePackages();
    changedPackages['node_modules/busboy'].version = '9.9.9';
    const changed = checkDependencies({ files: snapshot({ root: changedPackages }) });
    assert.ok(hasCode(changed.issues, 'DEPENDENCY_EVIDENCE_MISMATCH'));

    const files = snapshot({ root: evidencePackages() });
    files.delete('compliance/licenses/busboy-1.6.0/LICENSE');
    const missing = checkDependencies({ files });
    assert.ok(hasCode(missing.issues, 'EVIDENCE_FILE_MISMATCH'));
  });

  it('assigns the root area, the shared area and the separate asset lab lock', () => {
    const agpl = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { agpl: '^1.0.0' } },
        'node_modules/agpl': { version: '1.0.0', license: 'AGPL-3.0-only' },
      },
    });
    const rootResult = checkDependencies({ files: agpl });
    assert.equal(byLockPath(rootResult.records)['node_modules/agpl'].area, 'agpl');
    assert.deepEqual(rootResult.issues, []);

    const shared = snapshot({
      root: {
        'packages/shared': { name: 'shared', version: '0.1.0', license: 'MIT', dependencies: { agpl: '^1.0.0' } },
        'node_modules/agpl': { version: '1.0.0', license: 'AGPL-3.0-only' },
      },
    });
    const sharedResult = checkDependencies({ files: shared });
    assert.equal(byLockPath(sharedResult.records)['node_modules/agpl'].globalRoot, 'packages/shared');
    assert.equal(byLockPath(sharedResult.records)['node_modules/agpl'].area, 'mit');
    assert.ok(hasCode(sharedResult.issues, 'LICENSE_NOT_ALLOWED'));

    const asset = snapshot({
      asset: {
        '': { name: 'asset-lab', version: '0.0.0', license: 'MIT', dependencies: { agpl: '^1.0.0' } },
        'node_modules/agpl': { version: '1.0.0', license: 'AGPL-3.0-only' },
      },
    });
    const assetResult = checkDependencies({ files: asset });
    const assetRecord = byLockPath(assetResult.records)['node_modules/agpl'];
    assert.equal(assetRecord.globalRoot, 'tools/asset-lab');
    assert.equal(assetRecord.area, 'mit');
    assert.ok(hasCode(assetResult.issues, 'LICENSE_NOT_ALLOWED'));
  });

  it('flags a missing mandatory edge and reports a missing optional peer as info', () => {
    const files = snapshot({
      root: {
        '': {
          name: 'meetropolis',
          version: '0.1.0',
          license: 'AGPL-3.0-only',
          dependencies: { missing: '^1.0.0', peerUser: '^1.0.0' },
        },
        'node_modules/peerUser': {
          version: '1.0.0',
          license: 'MIT',
          peerDependencies: { optionalPeer: '^1.0.0' },
          peerDependenciesMeta: { optionalPeer: { optional: true } },
        },
      },
    });
    const { issues } = checkDependencies({ files });
    const mandatory = issues.find((issue) => issue.code === 'DEPENDENCY_UNRESOLVED');
    assert.ok(mandatory);
    assert.equal(mandatory.severity, 'error');
    const optional = issues.find((issue) => issue.code === 'OPTIONAL_DEPENDENCY_ABSENT');
    assert.ok(optional);
    assert.equal(optional.severity, 'info');
  });

  it('follows an explicitly configured dev root', () => {
    const files = snapshot({
      root: {
        '': {
          name: 'meetropolis',
          version: '0.1.0',
          license: 'AGPL-3.0-only',
          devDependencies: { 'dev-tool': '^1.0.0' },
        },
        'node_modules/dev-tool': { version: '1.0.0', license: 'MIT' },
      },
    });
    const withoutExtra = checkDependencies({ files });
    assert.equal(byLockPath(withoutExtra.records)['node_modules/dev-tool'], undefined);

    const withExtra = checkDependencies({ files, extraDependencies: { '': ['dev-tool'] } });
    const record = byLockPath(withExtra.records)['node_modules/dev-tool'];
    assert.ok(record);
    assert.equal(record.effectiveLicense, 'MIT');
    assert.deepEqual(withExtra.issues, []);
  });

  it('reads the workspace manifest below the directory of a nested lock', () => {
    const files = snapshot({
      asset: {
        '': { name: 'asset-lab', version: '0.0.0', license: 'MIT', dependencies: { local: '*' } },
        'node_modules/local': { link: true, resolved: 'packages/local' },
        'packages/local': { name: 'local', version: '0.0.0', license: 'AGPL-3.0-only' },
      },
      extra: new Map([
        ['tools/asset-lab/packages/local/package.json', manifest('AGPL-3.0-only', 'local')],
        ['tools/packages/local/package.json', manifest('MIT', 'local')],
      ]),
      policy: policyWithRoots({ [ASSET_LOCK_PATH]: ['', 'packages/local'] }),
    });
    const { records, issues } = checkDependencies({ files });
    const record = byLockPath(records)['packages/local'];
    assert.ok(record);
    assert.equal(record.globalRoot, 'tools/asset-lab');
    assert.equal(record.area, 'mit');
    assert.equal(record.effectiveLicense, 'AGPL-3.0-only');
    assert.ok(hasCode(issues, 'LICENSE_NOT_ALLOWED'));
  });

  it('rejects an extra dependency root that no lock configures', () => {
    const files = snapshot({
      asset: {
        '': { name: 'asset-lab', version: '0.0.0', license: 'MIT', devDependencies: { 'dev-tool': '^1.0.0' } },
        'node_modules/dev-tool': { version: '1.0.0', license: 'MIT' },
      },
    });
    assert.throws(
      () => checkDependencies({ files, extraDependencies: { 'apps/desk': ['dev-tool'] } }),
      (error) => error.code === 'COMPLIANCE_DATA_INVALID' && !error.message.includes('apps/desk'),
    );
  });

  it('accepts an extra dependency for a nested global root', () => {
    const files = snapshot({
      asset: {
        '': { name: 'asset-lab', version: '0.0.0', license: 'MIT', devDependencies: { 'dev-tool': '^1.0.0' } },
        'node_modules/dev-tool': { version: '1.0.0', license: 'MIT' },
      },
    });
    const { records, issues } = checkDependencies({
      files,
      extraDependencies: { 'tools/asset-lab': ['dev-tool'] },
    });
    const record = byLockPath(records)['node_modules/dev-tool'];
    assert.ok(record);
    assert.equal(record.globalRoot, 'tools/asset-lab');
    assert.equal(record.area, 'mit');
    assert.deepEqual(issues, []);
  });

  it('flags a workspace root that the policy does not configure', () => {
    const added = snapshot({
      root: {
        'apps/new': { name: 'new', version: '0.1.0', license: 'MIT' },
      },
    });
    const addedIssue = checkDependencies({ files: added }).issues.find(
      (issue) => issue.code === 'LOCKFILE_ROOT_UNCONFIGURED',
    );
    assert.ok(addedIssue);
    assert.equal(addedIssue.path, ROOT_LOCK_PATH);
    assert.equal(addedIssue.root, 'apps/new');
    assert.equal(addedIssue.lockPath, 'apps/new');

    const removed = snapshot({
      policy: policyWithRoots({
        [ROOT_LOCK_PATH]: rootLockConfig.roots.filter((root) => root !== 'apps/web'),
      }),
    });
    const removedIssue = checkDependencies({ files: removed }).issues.find(
      (issue) => issue.code === 'LOCKFILE_ROOT_UNCONFIGURED',
    );
    assert.ok(removedIssue);
    assert.equal(removedIssue.path, ROOT_LOCK_PATH);
    assert.equal(removedIssue.root, 'apps/web');
    assert.equal(removedIssue.lockPath, 'apps/web');
  });

  it('keeps raw policy values out of configuration error messages', () => {
    const marker = 'MARKER-AREA-9F3A';
    const files = snapshot();
    files.set(
      POLICY_PATH,
      jsonBytes({
        ...policyDoc,
        areas: policyDoc.areas.map((area) =>
          area.id === 'mit' ? { ...area, id: marker, additionalAllowedLicenses: [42] } : area,
        ),
      }),
    );
    assert.throws(
      () => checkDependencies({ files }),
      (error) => error.code === 'COMPLIANCE_DATA_INVALID' && !error.message.includes(marker),
    );
  });

  it('flags a missing and an unconfigured lockfile', () => {
    const missing = snapshot();
    missing.delete(ROOT_LOCK_PATH);
    const missingResult = checkDependencies({ files: missing });
    const missingIssue = missingResult.issues.find((issue) => issue.code === 'LOCKFILE_MISSING');
    assert.ok(missingIssue);
    assert.equal(missingIssue.path, ROOT_LOCK_PATH);

    const unconfigured = snapshot();
    unconfigured.set('apps/web/package-lock.json', makeLock({ '': { name: 'web' } }));
    const unconfiguredResult = checkDependencies({ files: unconfigured });
    const unconfiguredIssue = unconfiguredResult.issues.find((issue) => issue.code === 'LOCKFILE_UNCONFIGURED');
    assert.ok(unconfiguredIssue);
    assert.equal(unconfiguredIssue.path, 'apps/web/package-lock.json');
  });

  it('rejects a missing, an invalid and an ambiguous policy', () => {
    const withoutPolicy = snapshot();
    withoutPolicy.delete(POLICY_PATH);
    assert.throws(
      () => checkDependencies({ files: withoutPolicy }),
      (error) => error.code === 'COMPLIANCE_DATA_INVALID',
    );

    const invalid = snapshot();
    invalid.set(POLICY_PATH, jsonBytes({ ...policyDoc, schemaVersion: 2 }));
    assert.throws(
      () => checkDependencies({ files: invalid }),
      (error) => error.code === 'COMPLIANCE_DATA_INVALID',
    );

    const ambiguous = snapshot();
    const duplicated = policyDoc.areas.map((area) => ({
      ...area,
      paths: area.id === 'mit' ? [...area.paths, 'apps/server'] : area.paths,
    }));
    ambiguous.set(POLICY_PATH, jsonBytes({ ...policyDoc, areas: duplicated }));
    assert.throws(
      () => checkDependencies({ files: ambiguous }),
      (error) => error.code === 'COMPLIANCE_DATA_INVALID',
    );
  });

  it('produces the same result for reordered inputs', () => {
    const build = () =>
      snapshot({
        root: {
          '': {
            name: 'meetropolis',
            version: '0.1.0',
            license: 'AGPL-3.0-only',
            dependencies: { peerUser: '^1.0.0' },
            devDependencies: { 'dev-a': '^1.0.0' },
          },
          'apps/web': {
            name: 'web',
            version: '0.1.0',
            license: 'MIT',
            dependencies: { peerUser: '^1.0.0' },
            devDependencies: { 'dev-b': '^1.0.0' },
          },
          'node_modules/peerUser': { version: '1.0.0', license: 'MIT' },
          'node_modules/dev-a': { version: '1.0.0', license: 'MIT' },
          'node_modules/dev-b': { version: '1.0.0', license: 'MIT' },
        },
      });

    const first = build();
    const second = new Map([...build()].reverse());
    const extrasA = { '': ['dev-a'], 'apps/web': ['dev-b'] };
    const extrasB = { 'apps/web': ['dev-b'], '': ['dev-a'] };
    const resultA = checkDependencies({ files: first, extraDependencies: extrasA });
    const resultB = checkDependencies({ files: second, extraDependencies: extrasB });
    assert.deepEqual(resultA.records, resultB.records);
    assert.deepEqual(resultA.issues, resultB.issues);
    assert.ok(resultA.records.length > 0);
  });

  it('keeps records and issues free of absolute paths and source urls', () => {
    const files = snapshot({
      root: {
        '': { name: 'meetropolis', version: '0.1.0', license: 'AGPL-3.0-only', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '2.0.0', license: 'MIT' },
      },
    });
    const { records, issues } = checkDependencies({ files });
    for (const record of records) {
      assert.ok(!record.globalRoot.startsWith('/'));
      assert.equal(record.sources, undefined);
      assert.equal(record.resolved, undefined);
      assert.ok(!JSON.stringify(record).includes('https://'));
    }
    for (const issue of issues) {
      assert.ok(!issue.path.startsWith('/'));
      assert.ok(!JSON.stringify(issue).includes('https://'));
    }
  });
});
