import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectProductionDependencies } from './dependency-graph.mjs';

const LOCKFILE = 'package-lock.json';

const run = (packages, roots, lockfile = LOCKFILE) =>
  collectProductionDependencies({
    lockfile,
    lock: { name: 'fixture', lockfileVersion: 3, packages },
    roots,
  });

const rootOf = (path, extraDependencies = []) => ({ path, extraDependencies });

const byLockPath = (records) => Object.fromEntries(records.map((r) => [r.lockPath, r]));

describe('collectProductionDependencies', () => {
  it('resolves transitively and picks the nearest nested slot', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { a: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0', license: 'MIT', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '1.0.0', license: 'MIT' },
        'node_modules/a/node_modules/b': { version: '2.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.equal(records.length, 2);
    assert.deepEqual(byLockPath(records)['node_modules/a'], {
      root: '',
      lockfile: LOCKFILE,
      lockPath: 'node_modules/a',
      name: 'a',
      version: '1.0.0',
      integrity: null,
      rawLicense: 'MIT',
      workspace: false,
      edgeKinds: ['dependency'],
    });
    assert.equal(byLockPath(records)['node_modules/a/node_modules/b'].version, '2.0.0');
    assert.deepEqual(byLockPath(records)['node_modules/a/node_modules/b'].edgeKinds, ['dependency']);
  });

  it('resolves a scoped slot with its full scoped name', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { '@scope/pkg': '^1.0.0' } },
        'node_modules/@scope/pkg': { version: '1.2.3', license: 'ISC', integrity: 'sha512-xyz' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.equal(records.length, 1);
    assert.equal(records[0].name, '@scope/pkg');
    assert.equal(records[0].lockPath, 'node_modules/@scope/pkg');
    assert.equal(records[0].integrity, 'sha512-xyz');
  });

  it('keeps per-root shadowing apart for two workspaces sharing one package', () => {
    const { records, issues } = run(
      {
        'apps/web': { name: 'web', version: '1.0.0', dependencies: { shared: '^1.0.0' } },
        'apps/admin': { name: 'admin', version: '1.0.0', dependencies: { shared: '^1.0.0' } },
        'node_modules/shared': { version: '1.0.0', license: 'MIT' },
        'apps/web/node_modules/shared': { version: '2.0.0', license: 'MIT' },
      },
      [rootOf('apps/web'), rootOf('apps/admin')],
    );
    assert.deepEqual(issues, []);
    assert.equal(records.length, 2);
    // Sorted by root, then lockPath.
    assert.equal(records[0].root, 'apps/admin');
    assert.equal(records[0].lockPath, 'node_modules/shared');
    assert.equal(records[0].version, '1.0.0');
    assert.equal(records[1].root, 'apps/web');
    assert.equal(records[1].lockPath, 'apps/web/node_modules/shared');
    assert.equal(records[1].version, '2.0.0');
  });

  it('follows a workspace link and keeps the internal raw license metadata', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { desk: '^1.0.0' } },
        'node_modules/desk': { link: true, resolved: 'apps/desk' },
        'apps/desk': {
          name: 'desk',
          version: '0.1.0',
          license: 'Apache-2.0',
          dependencies: { helper: '^1.0.0' },
        },
        'node_modules/helper': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.equal(records.length, 2);
    assert.ok(!('node_modules/desk' in byLockPath(records)));
    assert.deepEqual(byLockPath(records)['apps/desk'], {
      root: '',
      lockfile: LOCKFILE,
      lockPath: 'apps/desk',
      name: 'desk',
      version: '0.1.0',
      integrity: null,
      rawLicense: 'Apache-2.0',
      workspace: true,
      edgeKinds: ['dependency'],
    });
    assert.equal(byLockPath(records)['node_modules/helper'].workspace, false);
  });

  it('terminates on a dependency cycle and lists each package once', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { a: '^1.0.0' } },
        'node_modules/a': { version: '1.0.0', license: 'MIT', dependencies: { b: '^1.0.0' } },
        'node_modules/b': { version: '1.0.0', license: 'MIT', dependencies: { a: '^1.0.0' } },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.equal(records.length, 2);
  });

  it('reports missing mandatory edges as errors and missing optional edges as info', () => {
    const { records, issues } = run(
      {
        '': {
          dependencies: { gone: '^1.0.0' },
          optionalDependencies: { optGone: '^1.0.0', optHere: '^1.0.0' },
          peerDependencies: { peerGone: '^1.0.0', peerOptGone: '^2.0.0', peerOptHere: '^1.0.0' },
          peerDependenciesMeta: {
            peerOptGone: { optional: true },
            peerOptHere: { optional: true },
          },
        },
        'node_modules/optHere': { version: '1.0.0', license: 'MIT' },
        'node_modules/peerOptHere': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, [
      { severity: 'error', code: 'DEPENDENCY_UNRESOLVED', root: '', from: '', name: 'gone' },
      { severity: 'info', code: 'OPTIONAL_DEPENDENCY_ABSENT', root: '', from: '', name: 'optGone' },
      { severity: 'error', code: 'DEPENDENCY_UNRESOLVED', root: '', from: '', name: 'peerGone' },
      { severity: 'info', code: 'OPTIONAL_DEPENDENCY_ABSENT', root: '', from: '', name: 'peerOptGone' },
    ]);
    assert.deepEqual(byLockPath(records)['node_modules/optHere'].edgeKinds, ['optional']);
    assert.deepEqual(byLockPath(records)['node_modules/peerOptHere'].edgeKinds, ['peer-optional']);
  });

  it('lets an optional edge override a same-named dependency edge', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { dup: '^1.0.0' }, optionalDependencies: { dup: '^1.0.0' } },
        'node_modules/dup': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(byLockPath(records)['node_modules/dup'].edgeKinds, ['optional']);
  });

  it('includes a reached dev-flagged package but never follows devDependencies', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { real: '^1.0.0' }, devDependencies: { onlydev: '^9.0.0' } },
        'node_modules/real': { version: '1.0.0', license: 'MIT', dev: true },
        'node_modules/onlydev': { version: '9.9.9', license: 'MIT', dev: true },
        'node_modules/unused': { version: '1.0.0', license: 'MIT', dev: true },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.equal(records.length, 1);
    assert.equal(records[0].lockPath, 'node_modules/real');
  });

  it('includes an explicitly listed extraDependency even when only a dev edge exists', () => {
    const packages = {
      'apps/web': { name: 'web', version: '1.0.0', devDependencies: { tool: '^3.0.0' } },
      'node_modules/tool': { version: '3.0.0', license: 'MIT' },
    };
    const withExtra = run(packages, [rootOf('apps/web', ['tool'])]);
    assert.deepEqual(withExtra.issues, []);
    assert.deepEqual(byLockPath(withExtra.records)['node_modules/tool'].edgeKinds, ['extra']);
    const missing = run(packages, [rootOf('apps/web', ['ghost'])]);
    assert.deepEqual(missing.records, []);
    assert.deepEqual(missing.issues, [
      { severity: 'error', code: 'DEPENDENCY_UNRESOLVED', root: 'apps/web', from: 'apps/web', name: 'ghost' },
    ]);
  });

  it('uses the real npm alias target name for a record', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { alias: 'npm:real@1.0.0', alias2: 'npm:@scope/other@2.0.0' } },
        'node_modules/alias': { name: 'real', version: '1.0.0', license: 'MIT' },
        'node_modules/alias2': { version: '2.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.equal(byLockPath(records)['node_modules/alias'].name, 'real');
    assert.equal(byLockPath(records)['node_modules/alias2'].name, '@scope/other');
  });

  it('treats bundleDependencies as mandatory production edges', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { pa: '^1.0.0', pc: '^1.0.0', pf: '^1.0.0' } },
        'node_modules/pa': { version: '1.0.0', license: 'MIT', bundleDependencies: ['pb'] },
        'node_modules/pb': { version: '1.0.0', license: 'MIT' },
        'node_modules/pc': {
          version: '1.0.0',
          license: 'MIT',
          dependencies: { pd: '^1.0.0' },
          bundleDependencies: true,
        },
        'node_modules/pd': { version: '1.0.0', license: 'MIT' },
        'node_modules/pf': {
          version: '1.0.0',
          license: 'MIT',
          dependencies: { pe: '^1.0.0' },
          bundleDependencies: false,
        },
        'node_modules/pe': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(byLockPath(records)['node_modules/pb'].edgeKinds, ['bundled']);
    assert.deepEqual(byLockPath(records)['node_modules/pd'].edgeKinds, ['bundled', 'dependency']);
    assert.deepEqual(byLockPath(records)['node_modules/pe'].edgeKinds, ['dependency']);
  });

  it('rejects broken, cyclic and out-of-scope links plus invalid lock input', () => {
    const broken = run(
      {
        '': { dependencies: { a: '^1.0.0' } },
        'node_modules/a': { link: true, resolved: 'gone/nowhere' },
      },
      [rootOf('')],
    );
    assert.deepEqual(broken.records, []);
    assert.deepEqual(broken.issues, [
      { severity: 'error', code: 'WORKSPACE_LINK_INVALID', root: '', from: '', name: 'a' },
    ]);

    const cyclic = run(
      {
        '': { dependencies: { x: '^1.0.0' } },
        'node_modules/x': { link: true, resolved: 'node_modules/y' },
        'node_modules/y': { link: true, resolved: 'node_modules/x' },
      },
      [rootOf('')],
    );
    assert.deepEqual(cyclic.records, []);
    assert.deepEqual(cyclic.issues, [
      { severity: 'error', code: 'WORKSPACE_LINK_INVALID', root: '', from: '', name: 'x' },
    ]);

    const outside = run(
      {
        '': { dependencies: { o1: '^1.0.0', o2: '^1.0.0', o3: '^1.0.0' } },
        'node_modules/o1': { link: true, resolved: '../outside' },
        'node_modules/o2': { link: true, resolved: '/abs/path' },
        'node_modules/o3': { link: true, resolved: 'bad\\path' },
      },
      [rootOf('')],
    );
    assert.deepEqual(outside.records, []);
    assert.deepEqual(outside.issues, [
      { severity: 'error', code: 'WORKSPACE_LINK_INVALID', root: '', from: '', name: 'o1' },
      { severity: 'error', code: 'WORKSPACE_LINK_INVALID', root: '', from: '', name: 'o2' },
      { severity: 'error', code: 'WORKSPACE_LINK_INVALID', root: '', from: '', name: 'o3' },
    ]);

    const invalidCode = (fn) => {
      try {
        fn();
      } catch (err) {
        return err.code;
      }
      return 'NO_THROW';
    };
    const goodRoots = [rootOf('')];
    const goodPackages = { '': {} };
    const goodLock = { name: 'x', lockfileVersion: 3, packages: goodPackages };
    assert.equal(
      invalidCode(() => run({}, goodRoots)),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() =>
        collectProductionDependencies({
          lockfile: LOCKFILE,
          lock: { name: 'x', lockfileVersion: 2, packages: goodPackages },
          roots: goodRoots,
        }),
      ),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() => collectProductionDependencies({ lockfile: LOCKFILE, lock: goodLock, roots: [] })),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() => run(goodPackages, [rootOf('nope')])),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() => run(goodPackages, [rootOf('../evil')])),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() =>
        collectProductionDependencies({ lockfile: '/abs/package-lock.json', lock: goodLock, roots: goodRoots }),
      ),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() => collectProductionDependencies({ lockfile: 'a\\b.json', lock: goodLock, roots: goodRoots })),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      invalidCode(() => collectProductionDependencies({ lockfile: LOCKFILE, lock: goodLock })),
      'LOCKFILE_INVALID',
    );
  });

  it('produces identical output regardless of packages object key order', () => {
    const shared = {
      leaf: { version: '1.0.0', license: 'MIT' },
      mid: { version: '1.0.0', license: 'MIT', dependencies: { leaf: '^1.0.0' } },
    };
    const forward = run(
      {
        '': { dependencies: { mid: '^1.0.0' } },
        'node_modules/mid': shared.mid,
        'node_modules/leaf': shared.leaf,
      },
      [rootOf('')],
    );
    const reversed = run(
      {
        'node_modules/leaf': shared.leaf,
        'node_modules/mid': shared.mid,
        '': { dependencies: { mid: '^1.0.0' } },
      },
      [rootOf('')],
    );
    assert.deepEqual(reversed, forward);
  });

  it('marks nested third-party paths below a workspace as non-workspace', () => {
    const { records, issues } = run(
      {
        'apps/web': { name: 'web', version: '1.0.0', dependencies: { foo: '^1.0.0', lib: '^1.0.0' } },
        'apps/web/node_modules/foo': { version: '1.0.0', license: 'MIT' },
        'node_modules/lib': { link: true, resolved: 'packages/shared' },
        'packages/shared': { name: 'lib', version: '2.0.0', license: 'MIT' },
      },
      [rootOf('apps/web')],
    );
    assert.deepEqual(issues, []);
    assert.equal(byLockPath(records)['apps/web/node_modules/foo'].workspace, false);
    assert.deepEqual(byLockPath(records)['packages/shared'], {
      root: 'apps/web',
      lockfile: LOCKFILE,
      lockPath: 'packages/shared',
      name: 'lib',
      version: '2.0.0',
      integrity: null,
      rawLicense: 'MIT',
      workspace: true,
      edgeKinds: ['dependency'],
    });
  });

  it('rejects malformed dependency maps, bundled forms and peer meta', () => {
    const bad = (packages, roots = [rootOf('')]) => {
      try {
        run(packages, roots);
      } catch (err) {
        return err.code;
      }
      return 'NO_THROW';
    };
    assert.equal(bad({ '': { dependencies: { a: 42 } }, 'node_modules/a': { version: '1.0.0' } }), 'LOCKFILE_INVALID');
    assert.equal(bad({ '': { dependencies: ['a'] }, 'node_modules/a': { version: '1.0.0' } }), 'LOCKFILE_INVALID');
    assert.equal(
      bad({ '': { optionalDependencies: { a: null } }, 'node_modules/a': { version: '1.0.0' } }),
      'LOCKFILE_INVALID',
    );
    assert.equal(bad({ '': { dependencies: { '../evil': '^1.0.0' } } }), 'LOCKFILE_INVALID');
    assert.equal(bad({ '': { dependencies: { 'foo/bar': '^1.0.0' } } }), 'LOCKFILE_INVALID');
    for (const bundled of ['pb', { names: ['pb'] }, null]) {
      assert.equal(
        bad({
          '': { dependencies: { pa: '^1.0.0' } },
          'node_modules/pa': { version: '1.0.0', bundleDependencies: bundled },
          'node_modules/pb': { version: '1.0.0' },
        }),
        'LOCKFILE_INVALID',
      );
    }
    assert.equal(
      bad({
        '': { dependencies: { pa: '^1.0.0' } },
        'node_modules/pa': { version: '1.0.0', bundleDependencies: ['../evil'] },
      }),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      bad({
        '': { dependencies: { pa: '^1.0.0' } },
        'node_modules/pa': { version: '1.0.0', bundleDependencies: [42] },
      }),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      bad({
        '': { peerDependencies: { p: '^1.0.0' }, peerDependenciesMeta: ['p'] },
        'node_modules/p': { version: '1.0.0' },
      }),
      'LOCKFILE_INVALID',
    );
    assert.equal(
      bad({
        '': { peerDependencies: { p: '^1.0.0' }, peerDependenciesMeta: { p: { optional: 'yes' } } },
        'node_modules/p': { version: '1.0.0' },
      }),
      'LOCKFILE_INVALID',
    );
    assert.equal(bad({ '': { dependencies: { a: '^1.0.0' } }, '../evil': { version: '1.0.0' } }), 'LOCKFILE_INVALID');
    assert.equal(bad({ '': {}, '/abs/path': { version: '1.0.0' } }), 'LOCKFILE_INVALID');
    assert.equal(bad({ '': {}, 'bad\\path': { version: '1.0.0' } }), 'LOCKFILE_INVALID');
    assert.equal(bad({ '': {} }, [rootOf('', ['../evil'])]), 'LOCKFILE_INVALID');
  });

  it('keeps bundled:true off optional and peer edges', () => {
    const { records, issues } = run(
      {
        '': {
          dependencies: { d: '^1.0.0', o: '^1.0.0' },
          optionalDependencies: { o: '^1.0.0' },
          peerDependencies: { p: '^1.0.0' },
          peerDependenciesMeta: { p: { optional: true } },
          bundleDependencies: true,
        },
        'node_modules/d': { version: '1.0.0', license: 'MIT' },
        'node_modules/o': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, [{ severity: 'info', code: 'OPTIONAL_DEPENDENCY_ABSENT', root: '', from: '', name: 'p' }]);
    assert.deepEqual(byLockPath(records)['node_modules/d'].edgeKinds, ['bundled', 'dependency']);
    assert.deepEqual(byLockPath(records)['node_modules/o'].edgeKinds, ['optional']);
  });

  it('reads the npm alias spec of an explicitly named dev root extra', () => {
    const { records, issues } = run(
      {
        'apps/web': { name: 'web', version: '1.0.0', devDependencies: { aliased: 'npm:real-pkg@1.0.0' } },
        'node_modules/aliased': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('apps/web', ['aliased'])],
    );
    assert.deepEqual(issues, []);
    assert.equal(byLockPath(records)['node_modules/aliased'].name, 'real-pkg');
    assert.deepEqual(byLockPath(records)['node_modules/aliased'].edgeKinds, ['extra']);
  });

  it('rejects an unsafe present node.name', () => {
    const bad = (name) => {
      try {
        run(
          {
            '': { dependencies: { a: '^1.0.0' } },
            'node_modules/a': { name, version: '1.0.0', license: 'MIT' },
          },
          [rootOf('')],
        );
      } catch (err) {
        return err.code;
      }
      return 'NO_THROW';
    };
    assert.equal(bad('https://example.invalid/pkg'), 'LOCKFILE_INVALID');
    assert.equal(bad('../pkg'), 'LOCKFILE_INVALID');
  });

  it('rejects an npm alias with an unsafe or empty target instead of falling back', () => {
    const bad = (spec) => {
      try {
        run(
          {
            '': { dependencies: { a: spec } },
            'node_modules/a': { version: '1.0.0', license: 'MIT' },
          },
          [rootOf('')],
        );
      } catch (err) {
        return err.code;
      }
      return 'NO_THROW';
    };
    assert.equal(bad('npm:../evil@1.0.0'), 'LOCKFILE_INVALID');
    assert.equal(bad('npm:'), 'LOCKFILE_INVALID');
  });

  it('rejects a present non-string dev spec for an explicitly named extra', () => {
    let code = 'NO_THROW';
    try {
      run(
        {
          'apps/web': { name: 'web', version: '1.0.0', devDependencies: { tool: 42 } },
          'node_modules/tool': { version: '1.0.0', license: 'MIT' },
        },
        [rootOf('apps/web', ['tool'])],
      );
    } catch (err) {
      code = err.code;
    }
    assert.equal(code, 'LOCKFILE_INVALID');
  });

  it('collects every incoming edge kind for a package reached twice', () => {
    const { records, issues } = run(
      {
        '': { dependencies: { top: '^1.0.0' }, peerDependencies: { leaf: '^1.0.0' } },
        'node_modules/top': { version: '1.0.0', license: 'MIT', dependencies: { leaf: '^1.0.0' } },
        'node_modules/leaf': { version: '1.0.0', license: 'MIT' },
      },
      [rootOf('')],
    );
    assert.deepEqual(issues, []);
    assert.deepEqual(byLockPath(records)['node_modules/leaf'].edgeKinds, ['dependency', 'peer']);
  });
});
