// Tests for the source import policy reader.
//
// The reader validates the sourceImports section of the parsed policy
// object and returns a normalized copy. Only this test file touches the
// file system (to read the real policy); the module itself never does.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSourceImportPolicy } from './source-policy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';

function readRealPolicy() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'compliance', 'policy.json'), 'utf8'));
}

function clonePolicy(policy) {
  return JSON.parse(JSON.stringify(policy));
}

function assertInvalid(call, markers = []) {
  assert.throws(call, (error) => {
    assert.equal(error.code, 'COMPLIANCE_DATA_INVALID');
    assert.equal(error.exitCode, 2);
    assert.equal(error.message, DATA_INVALID_MESSAGE);
    for (const marker of markers) {
      if (marker.length === 0) continue;
      assert.ok(!error.message.includes(marker), `leaked marker ${marker}`);
    }
    return true;
  });
}

describe('readSourceImportPolicy happy path', () => {
  it('accepts the real policy and returns a sorted copy without mutating the input', () => {
    const policy = readRealPolicy();
    const snapshot = clonePolicy(policy);
    const result = readSourceImportPolicy(policy);
    assert.deepEqual(policy, snapshot);
    assert.notEqual(result, policy.sourceImports);
    assert.deepEqual(Object.keys(result).sort(), [
      'allowedDynamicImports',
      'forbiddenWebScopes',
      'organizationRepositories',
      'pinnedDynamicImports',
      'pinnedFiles',
      'protectedPackageFamilies',
      'protectedPackageRoots',
      'protectedScopes',
    ]);
    const sorted = (values) => [...values].sort();
    assert.deepEqual(result.protectedPackageRoots, sorted(result.protectedPackageRoots));
    assert.deepEqual(result.protectedPackageFamilies, sorted(result.protectedPackageFamilies));
    assert.deepEqual(
      result.allowedDynamicImports.map((entry) => entry.path),
      sorted(result.allowedDynamicImports.map((entry) => entry.path)),
    );
    // Legitimate loader roles stay allowed, not wrongly forbidden.
    const byPath = new Map(result.allowedDynamicImports.map((entry) => [entry.path, entry.specifier]));
    assert.equal(byPath.get('apps/server/src/emailLoader.ts'), '@meetropolis/tenancy');
    assert.equal(byPath.get('apps/server/src/adminLoader.ts'), '@meetropolis/billing');
    assert.equal(byPath.get('apps/server/src/transcriptionLoader.ts'), '@meetropolis/transcription');
  });

  it('tolerates unknown extra root fields', () => {
    const policy = readRealPolicy();
    policy.extraFutureField = { nested: true };
    const result = readSourceImportPolicy(policy);
    assert.ok(Array.isArray(result.protectedPackageRoots));
  });
});

describe('readSourceImportPolicy shape', () => {
  it('rejects a missing or malformed root', () => {
    assertInvalid(() => readSourceImportPolicy(null));
    assertInvalid(() => readSourceImportPolicy([]));
    assertInvalid(() => readSourceImportPolicy('policy'));
    const missing = readRealPolicy();
    delete missing.sourceImports;
    assertInvalid(() => readSourceImportPolicy(missing));
    const notObject = readRealPolicy();
    notObject.sourceImports = ['sourceImports'];
    assertInvalid(() => readSourceImportPolicy(notObject));
  });

  it('rejects a wrong schema version', () => {
    for (const schemaVersion of [undefined, 0, 2, '1', null]) {
      const policy = readRealPolicy();
      if (schemaVersion === undefined) delete policy.schemaVersion;
      else policy.schemaVersion = schemaVersion;
      assertInvalid(() => readSourceImportPolicy(policy));
    }
  });

  it('rejects a missing sourceImports field and unknown extra fields', () => {
    const fields = [
      'protectedPackageRoots',
      'protectedPackageFamilies',
      'protectedScopes',
      'forbiddenWebScopes',
      'allowedDynamicImports',
      'pinnedFiles',
      'pinnedDynamicImports',
    ];
    for (const field of fields) {
      const policy = readRealPolicy();
      delete policy.sourceImports[field];
      assertInvalid(() => readSourceImportPolicy(policy), [field]);
    }
    const extra = readRealPolicy();
    extra.sourceImports.unknownFutureField = [];
    assertInvalid(() => readSourceImportPolicy(extra), ['unknownFutureField']);
    const nested = readRealPolicy();
    nested.sourceImports.allowedDynamicImports[0].extra = true;
    assertInvalid(() => readSourceImportPolicy(nested), ['extra']);
  });

  it('rejects non-array, sparse and duplicate string lists', () => {
    const notArray = readRealPolicy();
    notArray.sourceImports.protectedPackageRoots = '@meetropolis/tenancy';
    assertInvalid(() => readSourceImportPolicy(notArray));
    const sparse = readRealPolicy();
    sparse.sourceImports.protectedPackageRoots = new Array(2);
    sparse.sourceImports.protectedPackageRoots[0] = '@meetropolis/tenancy';
    assertInvalid(() => readSourceImportPolicy(sparse));
    const dupes = readRealPolicy();
    dupes.sourceImports.protectedScopes = ['@signalyr', '@signalyr'];
    assertInvalid(() => readSourceImportPolicy(dupes), ['@signalyr']);
    const empty = readRealPolicy();
    empty.sourceImports.protectedPackageRoots = [];
    assertInvalid(() => readSourceImportPolicy(empty));
  });
});

describe('readSourceImportPolicy values', () => {
  it('rejects malformed package roots', () => {
    const bad = [
      '',
      'express',
      '@Scope/name',
      '@scope/Name',
      '@scope/',
      '@/name',
      '@scope',
      '@scope/name/sub',
      '@scope/name@1.0.0',
      '@scope/*',
      '@scope /name',
      '@scope/name ',
      'http://example.com/pkg',
      '@scope/name?query',
      '@scope/name#frag',
      '@sc\tpe/name',
      42,
      null,
    ];
    for (const root of bad) {
      const policy = readRealPolicy();
      policy.sourceImports.protectedPackageRoots = [root, '@meetropolis/billing'];
      assertInvalid(() => readSourceImportPolicy(policy), typeof root === 'string' ? [root.trim()] : []);
    }
  });

  it('rejects malformed scopes', () => {
    for (const scope of ['', 'signalyr', '@Signalyr', '@/x', '@scope/name', '@scope ', 42]) {
      const policy = readRealPolicy();
      policy.sourceImports.protectedScopes = [scope, '@signalyr'];
      assertInvalid(() => readSourceImportPolicy(policy));
    }
  });

  it('rejects drive-relative pinned paths while keeping valid relatives green', () => {
    // Drive-relative paths carry a drive prefix without a slash and must
    // fail; absolute and backslash drives are counter-probes that already
    // fail; a plain relative path stays valid.
    for (const drivePath of ['C:relative.ts', 'c:relative.ts']) {
      const policy = readRealPolicy();
      policy.sourceImports.pinnedFiles.push({
        path: drivePath,
        sha256: 'ab'.repeat(32),
        reason: 'Drive probe.',
      });
      assertInvalid(() => readSourceImportPolicy(policy), [drivePath]);
    }
    for (const drivePath of ['C:/relative.ts', 'D:\\relative.ts']) {
      const policy = readRealPolicy();
      policy.sourceImports.pinnedFiles.push({
        path: drivePath,
        sha256: 'ab'.repeat(32),
        reason: 'Drive probe.',
      });
      assertInvalid(() => readSourceImportPolicy(policy));
    }
    const valid = readRealPolicy();
    valid.sourceImports.pinnedFiles.push({
      path: 'tools/asset-lab/extra-note.md',
      sha256: 'ab'.repeat(32),
      reason: 'Valid relative probe.',
    });
    const result = readSourceImportPolicy(valid);
    assert.ok(result.pinnedFiles.some((entry) => entry.path === 'tools/asset-lab/extra-note.md'));
  });

  it('rejects malformed repository paths, hashes and reasons', () => {
    const badPaths = [
      '',
      '/absolute/path.ts',
      'C:/drive/path.ts',
      'C:relative.ts',
      'back\\slash.ts',
      'with space.ts',
      './dot.ts',
      '../up.ts',
      'a/../b.ts',
      'ctrl\x01char.ts',
    ];
    for (const badPath of badPaths) {
      const policy = readRealPolicy();
      policy.sourceImports.allowedDynamicImports[0].path = badPath;
      assertInvalid(() => readSourceImportPolicy(policy), [badPath.trim()]);
    }
    const badHash = readRealPolicy();
    badHash.sourceImports.pinnedFiles[0].sha256 = 'D66E6F97EC7F13F57C00C481C216126D5E8A6EDF02EA6A029D52DE8BE3B7CE7D';
    assertInvalid(() => readSourceImportPolicy(badHash));
    const shortHash = readRealPolicy();
    shortHash.sourceImports.pinnedFiles[0].sha256 = 'd66e6f97';
    assertInvalid(() => readSourceImportPolicy(shortHash));
    const zeroHash = readRealPolicy();
    zeroHash.sourceImports.pinnedFiles[0].sha256 = '0'.repeat(64);
    assertInvalid(() => readSourceImportPolicy(zeroHash));
    for (const reason of ['', '   ', 42, null]) {
      const policy = readRealPolicy();
      policy.sourceImports.pinnedFiles[0].reason = reason;
      assertInvalid(() => readSourceImportPolicy(policy));
    }
  });
});

describe('readSourceImportPolicy semantics', () => {
  it('keeps the required signalyr, tauri and family guards', () => {
    const noSignalyr = readRealPolicy();
    noSignalyr.sourceImports.protectedScopes = ['@other'];
    assertInvalid(() => readSourceImportPolicy(noSignalyr), ['@other']);
    const noTauri = readRealPolicy();
    noTauri.sourceImports.forbiddenWebScopes = ['@other-scope'];
    assertInvalid(() => readSourceImportPolicy(noTauri), ['@other-scope']);
    for (const family of [
      '@meetropolis/enterprise',
      '@meetropolis/brand',
      '@meetropolis/desktop',
      '@meetropolis/telemetry',
    ]) {
      const policy = readRealPolicy();
      policy.sourceImports.protectedPackageFamilies = policy.sourceImports.protectedPackageFamilies.filter(
        (entry) => entry !== family,
      );
      assertInvalid(() => readSourceImportPolicy(policy), [family]);
    }
  });

  it('rejects unprotected, subpath and wildcard allow targets', () => {
    for (const specifier of ['@meetropolis/unknown', '@meetropolis/tenancy/sub', '@meetropolis/*']) {
      const policy = readRealPolicy();
      policy.sourceImports.allowedDynamicImports[0].specifier = specifier;
      assertInvalid(() => readSourceImportPolicy(policy), [specifier]);
    }
  });

  it('rejects unknown or duplicated loader paths and forbidden web targets', () => {
    const unknown = readRealPolicy();
    unknown.sourceImports.allowedDynamicImports[0].path = 'apps/server/src/otherLoader.ts';
    assertInvalid(() => readSourceImportPolicy(unknown), ['otherLoader']);
    const duplicate = readRealPolicy();
    duplicate.sourceImports.allowedDynamicImports[1].path = duplicate.sourceImports.allowedDynamicImports[0].path;
    assertInvalid(() => readSourceImportPolicy(duplicate));
    const signalyrAllow = readRealPolicy();
    signalyrAllow.sourceImports.allowedDynamicImports[0].specifier = '@signalyr/relay';
    signalyrAllow.sourceImports.protectedPackageRoots.push('@signalyr/relay');
    assertInvalid(() => readSourceImportPolicy(signalyrAllow), ['@signalyr/relay']);
    const webTauri = readRealPolicy();
    webTauri.sourceImports.protectedPackageRoots.push('@tauri-apps/api');
    webTauri.sourceImports.allowedDynamicImports[6].specifier = '@tauri-apps/api';
    assertInvalid(() => readSourceImportPolicy(webTauri), ['@tauri-apps/api']);
  });

  it('rejects prefix-only family matches', () => {
    // '@meetropolis/enterprises' shares a prefix but is neither a listed
    // root, nor a scope member, nor the family root or a root-plus-hyphen
    // member, so it stays unprotected and must fail.
    const policy = readRealPolicy();
    policy.sourceImports.allowedDynamicImports[0].specifier = '@meetropolis/enterprises';
    assertInvalid(() => readSourceImportPolicy(policy), ['@meetropolis/enterprises']);
  });

  it('accepts an explicitly listed root without family cover', () => {
    // Data allow test on the fixture only, not a real policy change:
    // '@meetropolis/enterprises' is a listed root here, so the allow entry
    // is valid even though no family matches.
    const policy = readRealPolicy();
    policy.sourceImports.protectedPackageRoots.push('@meetropolis/enterprises');
    policy.sourceImports.allowedDynamicImports[0].specifier = '@meetropolis/enterprises';
    const result = readSourceImportPolicy(policy);
    assert.ok(
      result.allowedDynamicImports.some(
        (entry) => entry.path === 'apps/server/src/tenancyLoader.ts' && entry.specifier === '@meetropolis/enterprises',
      ),
    );
  });

  it('accepts a family-only covered target without a roots entry', () => {
    // '@meetropolis/enterprise-addon' is no listed root but a
    // root-plus-hyphen member of the existing enterprise family.
    const policy = readRealPolicy();
    policy.sourceImports.allowedDynamicImports[0].specifier = '@meetropolis/enterprise-addon';
    const result = readSourceImportPolicy(policy);
    assert.ok(result.allowedDynamicImports.some((entry) => entry.specifier === '@meetropolis/enterprise-addon'));
  });

  it('accepts a scope-only covered target without roots or family entries', () => {
    // '@additional/module' is covered only by the additionally declared
    // '@additional' scope.
    const policy = readRealPolicy();
    policy.sourceImports.protectedScopes.push('@additional');
    policy.sourceImports.allowedDynamicImports[0].specifier = '@additional/module';
    const result = readSourceImportPolicy(policy);
    assert.ok(result.allowedDynamicImports.some((entry) => entry.specifier === '@additional/module'));
  });

  it('enforces the plugin pin and rejects foreign dynamic pins', () => {
    const missing = readRealPolicy();
    missing.sourceImports.pinnedFiles = [];
    assertInvalid(() => readSourceImportPolicy(missing));
    const doubled = readRealPolicy();
    doubled.sourceImports.pinnedFiles.push(clonePolicy(doubled.sourceImports.pinnedFiles[0]));
    assertInvalid(() => readSourceImportPolicy(doubled));
    for (const pin of [
      {
        path: 'tools/asset-lab/tests/other.test.ts',
        sha256: 'd66e6f97ec7f13f57c00c481c216126d5e8a6edf02ea6a029d52de8be3b7ce7d',
        kind: 'dynamic-import',
        argumentKind: 'identifier',
        line: 15,
        targetPath: 'apps/server/src/api/utils/collisionHelpers.ts',
        reason: 'Foreign pin.',
      },
      {
        path: 'apps/server/src/transcriptionLoader.ts',
        sha256: 'd66e6f97ec7f13f57c00c481c216126d5e8a6edf02ea6a029d52de8be3b7ce7d',
        kind: 'dynamic-import',
        argumentKind: 'identifier',
        line: 15,
        targetPath: 'apps/server/src/api/utils/collisionHelpers.ts',
        reason: 'Transcription pin.',
      },
      {
        path: 'scripts/compliance/parser-runtime.test.mjs',
        sha256: 'd66e6f97ec7f13f57c00c481c216126d5e8a6edf02ea6a029d52de8be3b7ce7d',
        kind: 'dynamic-import',
        argumentKind: 'literal',
        line: 54,
        targetPath: './parser-runtime.mjs',
        reason: 'Runtime test pin.',
      },
    ]) {
      const policy = readRealPolicy();
      policy.sourceImports.pinnedDynamicImports.push(pin);
      assertInvalid(() => readSourceImportPolicy(policy), [pin.path]);
    }
  });

  it('rejects malformed pin records and unsafe line numbers', () => {
    for (const line of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '15', null]) {
      const policy = readRealPolicy();
      policy.sourceImports.pinnedDynamicImports[0].line = line;
      assertInvalid(() => readSourceImportPolicy(policy));
    }
    const kind = readRealPolicy();
    kind.sourceImports.pinnedDynamicImports[0].kind = 'import';
    assertInvalid(() => readSourceImportPolicy(kind));
    const argument = readRealPolicy();
    argument.sourceImports.pinnedDynamicImports[0].argumentKind = 'literal';
    assertInvalid(() => readSourceImportPolicy(argument));
    const target = readRealPolicy();
    target.sourceImports.pinnedDynamicImports[0].targetPath = 'apps/server/src/other.ts';
    assertInvalid(() => readSourceImportPolicy(target), ['other.ts']);
  });

  it('keeps raw values out of the error', () => {
    const policy = readRealPolicy();
    policy.sourceImports.allowedDynamicImports[0].specifier = '@evil/MARKER-ROOT';
    assertInvalid(() => readSourceImportPolicy(policy), ['@evil/MARKER-ROOT', 'MARKER-ROOT']);
  });
});

describe('readSourceImportPolicy organization repositories', () => {
  function baseOrgPolicy() {
    const policy = readRealPolicy();
    policy.sourceImports.organizationRepositories = {
      owners: ['lass-machen'],
      allowedPublic: ['lass-machen/example-open'],
    };
    return policy;
  }

  it('rejects a missing organizationRepositories field', () => {
    const policy = readRealPolicy();
    delete policy.sourceImports.organizationRepositories;
    assertInvalid(() => readSourceImportPolicy(policy));
  });

  it('rejects an organizationRepositories record with an extra key', () => {
    const policy = baseOrgPolicy();
    policy.sourceImports.organizationRepositories.extra = true;
    assertInvalid(() => readSourceImportPolicy(policy), ['extra']);
  });

  it('rejects empty owners', () => {
    const policy = baseOrgPolicy();
    policy.sourceImports.organizationRepositories = { owners: [], allowedPublic: [] };
    assertInvalid(() => readSourceImportPolicy(policy));
  });

  it('rejects an invalid owner', () => {
    const policy = baseOrgPolicy();
    policy.sourceImports.organizationRepositories = { owners: ['Lass-Machen'], allowedPublic: [] };
    assertInvalid(() => readSourceImportPolicy(policy), ['Lass-Machen']);
  });

  it('rejects duplicate owners', () => {
    const policy = baseOrgPolicy();
    policy.sourceImports.organizationRepositories = {
      owners: ['lass-machen', 'lass-machen'],
      allowedPublic: [],
    };
    assertInvalid(() => readSourceImportPolicy(policy), ['lass-machen']);
  });

  it('rejects an allowedPublic entry with a foreign owner', () => {
    const policy = baseOrgPolicy();
    policy.sourceImports.organizationRepositories = {
      owners: ['lass-machen'],
      allowedPublic: ['other-org/repo'],
    };
    assertInvalid(() => readSourceImportPolicy(policy), ['other-org/repo']);
  });

  it('returns sorted organizationRepositories without mutating the input', () => {
    const policy = baseOrgPolicy();
    policy.sourceImports.organizationRepositories = {
      owners: ['zeta-owner', 'lass-machen'],
      allowedPublic: ['zeta-owner/zebra', 'lass-machen/aperture'],
    };
    const snapshot = clonePolicy(policy);
    const result = readSourceImportPolicy(policy);
    assert.deepEqual(policy, snapshot);
    assert.deepEqual(result.organizationRepositories, {
      owners: ['lass-machen', 'zeta-owner'],
      allowedPublic: ['lass-machen/aperture', 'zeta-owner/zebra'],
    });
  });
});
