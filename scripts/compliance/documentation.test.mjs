// Tests for the deterministic offline documentation check.
//
// The fixtures use small self-authored Markdown and JSON snapshots only:
// no repository file is read as a snapshot, no network or filesystem
// access happens inside the module, and the committed compliance policy
// is used only as a coherent schema reference. The frozen local profile
// is never read.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkDocumentation } from './documentation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const COMPLIANCE_DIR = path.join(REPO_ROOT, 'compliance');

const POLICY_PATH = 'compliance/policy.json';
const LICENSING_PATH = 'LICENSING.md';
const README_PATH = 'README.md';
const ASSET_PATH = 'tools/asset-lab/README.md';

const policyBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'policy.json'));

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Versioned masked-content marker lists shared with the committed policy:
// every license id of the fixture policy plus the fixed additional ids,
// and the fixed literal keywords. Ids match case-sensitively, keywords
// case-insensitively, both with Unicode word boundaries.
const MASKED_LICENSE_IDS = [
  '0BSD',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BUSL-1.1',
  'CC-BY-NC-4.0',
  'CC-BY-NC-ND-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'EPL-2.0',
  'GPL-2.0-only',
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-only',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'OFL-1.1',
  'PROPRIETARY',
  'SSPL-1.0',
  'UNLICENSED',
  'Unlicense',
  'Zlib',
];

const MASKED_KEYWORDS = [
  'license',
  'licence',
  'licensing',
  'licenses',
  'licences',
  'lizenz',
  'lizenzen',
  'lizenzierung',
  'copyright',
  'SPDX',
  'copyleft',
  'unlicense',
  'unlicensed',
  'proprietary',
  'proprietär',
  'GNU',
  'GPL',
  'AGPL',
  'LGPL',
  'MPL',
  'EPL',
  'SSPL',
  'BUSL',
  'Commons Clause',
  'CC-NC',
  'CC-ND',
  'CC-BY-NC',
  'CC-BY-ND',
];

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const textBytes = (text) => Buffer.from(text, 'utf8');

// Reviewed masked-content exceptions of the committed policy. Every change
// to the policy allowlist needs a visible change of this list.
const COMMITTED_MASKED_ALLOWLIST = [
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: 'fc3f4d878c1f0806f764a2bf9171179242d2fad2bc6b3c868f8d30e6373fc570',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: 'b7dbb22cea8290bac6b6adc229f1b0a4ad0b903cadb2f1f8bc97be94f162961b',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: 'e51a9a55581c895b3ed5298cf16accbd24c216ae52793d5ee0b3d0ee5aa0ba8f',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: '8e4a4111ff0e07962d6d8fe9f4a4b078a779f13e4d9ae2f70f9199d3652bd066',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: '84e56e96a799c03a4362775825bcc804ecef73e98c9a21d6075de292bd94e8ff',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: '7ed5995c7af65391503b31dfa5b0c0c0c719f0f519c91a05d075363f16699f21',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: 'b80b5667136993d13878ddc46f6960f492a90fe5c647f3a713d42075bab01ee6',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: 'da64e478ed0515651fc3709870b3e824bc1057316d64303f9d2c8d970b6ccf0a',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: '33f932748922fb33b33896b820b95777f0f36cf99d309b416c157e82a03ec8af',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: 'b7c02632af3827c390fe842ac003839c08003832c677353bda357d52fc62f8b5',
    occurrence: 1,
  },
  {
    path: 'LICENSING.md',
    kind: 'code-span',
    contextSha256: '616973c27e13c898b5d910218ae75c26b36b71fd66cb6c87f468272d61ea2968',
    occurrence: 1,
  },
  {
    path: 'README.md',
    kind: 'code-span',
    contextSha256: '10f884e1847445facecf2895d69f72d8ad9ef90ecc51036e77d30b0472d9bd44',
    occurrence: 1,
  },
  {
    path: 'tools/asset-lab/README.md',
    kind: 'code-span',
    contextSha256: 'b61ff051ca274a66fe7323717380d1d3bc00e9ed66bf536c10d02512e70b02d2',
    occurrence: 1,
  },
  {
    path: 'tools/asset-lab/README.md',
    kind: 'code-span',
    contextSha256: 'c2d24150eef0f7200e88e2e17e1b4d7a67a5471e9cc3dfde8c2cbee12d4eb559',
    occurrence: 1,
  },
];

// Drops the free-text reason so that the pinned fields compare exactly.
const pinnedAllowlistFields = (allowlist) =>
  allowlist.map(({ path: entryPath, kind, contextSha256, occurrence }) => ({
    path: entryPath,
    kind,
    contextSha256,
    occurrence,
  }));

// Explicit exceptions for the fixed baseline lines that carry evaluated
// SPDX claims inside code spans: each entry pins the exact raw line of the
// fixed baseline text, so inserting lines above stays valid while changing
// a masked line needs a new exception.
const baselineMaskedAllowlist = () => {
  const licensing = LICENSING_DOC.split('\n');
  const readme = README_DOC.split('\n');
  const entry = (allowPath, lines, index, reason) => ({
    path: allowPath,
    kind: 'code-span',
    contextSha256: sha256(lines[index]),
    occurrence: 1,
    reason,
  });
  return [
    entry(
      LICENSING_PATH,
      licensing,
      6,
      'Fixed baseline table row for the repository root: evaluated AGPL-3.0-only claim.',
    ),
    entry(LICENSING_PATH, licensing, 7, 'Fixed baseline table row for apps/server: evaluated AGPL-3.0-only claim.'),
    entry(LICENSING_PATH, licensing, 8, 'Fixed baseline table row for apps/web: evaluated MIT claim.'),
    entry(LICENSING_PATH, licensing, 9, 'Fixed baseline table row for tools/asset-lab: evaluated MIT claim.'),
    entry(
      LICENSING_PATH,
      licensing,
      11,
      'Fixed baseline prose line mentioning licenses next to an unrelated code span.',
    ),
    entry(README_PATH, readme, 12, 'Fixed baseline readme item: evaluated MIT claim for apps/web.'),
  ];
};

// Small but fully coherent fixture policy: two areas with one root
// fallback, four manifest components, two readme groups and the
// asset-lab component outside the groups.
const fixturePolicy = () => ({
  schemaVersion: 1,
  commonAllowedLicenses: [
    '0BSD',
    'Apache-2.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'ISC',
    'MIT',
    'MIT-0',
    'Unlicense',
    'Zlib',
  ],
  areas: [
    {
      id: 'agpl',
      description: 'Server area.',
      paths: ['', 'apps/server'],
      additionalAllowedLicenses: ['AGPL-3.0-only'],
    },
    { id: 'mit', description: 'Web area.', paths: ['apps/web', 'tools/asset-lab'], additionalAllowedLicenses: [] },
  ],
  reviewRequired: [
    { id: 'MPL-2.0', reason: 'Weak copyleft, not yet assessed.' },
    { id: 'EPL-2.0', reason: 'Weak copyleft, not yet assessed.' },
  ],
  assets: { fontLicenses: ['OFL-1.1'] },
  metadata: {
    licenseByArea: { agpl: 'AGPL-3.0-only', mit: 'MIT' },
    manifests: ['package.json', 'apps/server/package.json', 'apps/web/package.json', 'tools/asset-lab/package.json'],
  },
  documentation: {
    componentTable: { path: LICENSING_PATH, heading: 'Per-component breakdown', rootAlias: '/LICENSE' },
    readme: {
      path: README_PATH,
      heading: 'License',
      rootMarker: 'repository root',
      badges: ['AGPL-3.0-only', 'MIT'],
      groups: [
        {
          components: ['', 'apps/server'],
          license: 'AGPL-3.0-only',
          licenseTarget: 'LICENSE',
        },
        {
          components: ['apps/web'],
          license: 'MIT',
          licenseTarget: 'apps/web/LICENSE',
        },
      ],
    },
    assetLab: { path: ASSET_PATH, license: 'MIT', licenseTarget: 'LICENSE' },
    maskedContent: {
      licenseIds: [...MASKED_LICENSE_IDS],
      keywords: [...MASKED_KEYWORDS],
      allowlist: baselineMaskedAllowlist(),
    },
  },
});

const LICENSING_DOC = [
  '# Licensing',
  '',
  '## Per-component breakdown',
  '',
  '| Scope | License | Note |',
  '| --- | --- | --- |',
  '| Root (`/LICENSE`) | `AGPL-3.0-only` | default scope |',
  '| `apps/server` | **AGPL-3.0-only** | server area |',
  '| `apps/web` | `MIT` | web area |',
  '| `tools/asset-lab` | `MIT` | lab tool |',
  '',
  'The optional modules under `packages/brand` carry their own licenses.',
  '',
  '## Other',
  '',
  'Unrelated prose.',
  '',
].join('\n');

const README_DOC = [
  '# Fixture Project',
  '',
  '![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-red.svg)',
  '![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)',
  '![Build](https://example.com/build.svg)',
  '',
  '## License',
  '',
  'The project is dual-licensed:',
  '',
  '- Server parts (`apps/server`',
  '  and the Repository Root) are licensed under [AGPL-3.0-only](LICENSE).',
  '- Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE).',
  '',
  'A commercial license is available on request.',
  '',
].join('\n');

const ASSET_DOC = [
  '# Asset Lab',
  '',
  'The Atelier is a local tool and is licensed under [MIT](LICENSE).',
  '',
  '## Start',
  '',
  '`npm run dev` starts the Atelier.',
  '',
].join('\n');

// A snapshot with every configured document present and valid.
const validSnapshot = (policy = fixturePolicy()) => {
  const map = new Map();
  map.set(POLICY_PATH, jsonBytes(policy));
  map.set(LICENSING_PATH, textBytes(LICENSING_DOC));
  map.set(README_PATH, textBytes(README_DOC));
  map.set(ASSET_PATH, textBytes(ASSET_DOC));
  return map;
};

const snapshotWithPolicy = (policy) => validSnapshot(policy);

const policyWith = (mutate) => {
  const document = JSON.parse(JSON.stringify(fixturePolicy()));
  mutate(document);
  return document;
};

const setDoc = (map, docPath, text) => {
  map.set(docPath, textBytes(text));
};

const hasCode = (issues, code, docPath) =>
  issues.some((issue) => issue.code === code && (docPath === undefined || issue.path === docPath));

const DATA_INVALID_MESSAGE = 'invalid data: the compliance data is missing, incomplete or violates the expected schema';

const dataInvalid = (run) => {
  let thrown = null;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, 'expected an Error');
  assert.equal(thrown.code, 'COMPLIANCE_DATA_INVALID');
  assert.equal(thrown.message, DATA_INVALID_MESSAGE);
  return thrown;
};

describe('checkDocumentation', () => {
  it('matches the documentation rules of the committed policy', () => {
    const policy = JSON.parse(policyBytes.toString('utf8'));
    assert.equal(policy.schemaVersion, 1);
    const { maskedContent, ...rest } = policy.documentation;
    const { allowlist, ...maskedRules } = maskedContent;
    assert.deepEqual(maskedRules, {
      licenseIds: [...MASKED_LICENSE_IDS],
      keywords: [...MASKED_KEYWORDS],
    });
    assert.equal(allowlist.length, COMMITTED_MASKED_ALLOWLIST.length);
    for (const entry of allowlist) {
      assert.deepEqual(Object.keys(entry).sort(), ['contextSha256', 'kind', 'occurrence', 'path', 'reason']);
      assert.equal(typeof entry.reason, 'string');
      assert.ok(entry.reason.trim().length > 0, 'every allowlist entry needs a reason');
    }
    assert.deepEqual(pinnedAllowlistFields(allowlist), COMMITTED_MASKED_ALLOWLIST);
    assert.deepEqual(rest, {
      componentTable: {
        path: 'LICENSING.md',
        heading: 'Per-component breakdown',
        rootAlias: '/LICENSE',
      },
      readme: {
        path: 'README.md',
        heading: 'License',
        rootMarker: 'repository root',
        badges: ['AGPL-3.0-only', 'MIT'],
        groups: [
          {
            components: ['', 'apps/server', 'apps/npc-service', 'apps/loadtest'],
            license: 'AGPL-3.0-only',
            licenseTarget: 'LICENSE',
          },
          {
            components: ['apps/web', 'packages/shared'],
            license: 'MIT',
            licenseTarget: 'apps/web/LICENSE',
          },
        ],
      },
      assetLab: { path: 'tools/asset-lab/README.md', license: 'MIT', licenseTarget: 'LICENSE' },
    });
  });

  it('rejects an additional allowlist entry next to the committed list', () => {
    const policy = JSON.parse(policyBytes.toString('utf8'));
    const allowlist = [
      ...policy.documentation.maskedContent.allowlist,
      {
        path: 'README.md',
        kind: 'code-span',
        contextSha256: sha256('An unreviewed MIT line.'),
        occurrence: 1,
        reason: 'Unreviewed extra entry.',
      },
    ];
    assert.throws(
      () => assert.deepEqual(pinnedAllowlistFields(allowlist), COMMITTED_MASKED_ALLOWLIST),
      assert.AssertionError,
    );
  });

  it('accepts a valid minimal snapshot with sorted records', () => {
    const { records, issues } = checkDocumentation({ files: validSnapshot() });
    assert.deepEqual(issues, []);
    // The evaluated SPDX claims inside code spans stay allowed through the
    // explicit baseline exceptions and remain auditable as allowlisted hits.
    const licensing = LICENSING_DOC.split('\n');
    const readme = README_DOC.split('\n');
    const maskedHit = (hitPath, maskedKind, context, occurrence, line) => ({
      kind: 'masked-license-hit',
      path: hitPath,
      maskedKind,
      contextSha256: sha256(context),
      occurrence,
      line,
      allowlisted: true,
    });
    assert.deepEqual(records, [
      { kind: 'component-table', path: LICENSING_PATH, components: ['', 'apps/server', 'apps/web', 'tools/asset-lab'] },
      maskedHit(LICENSING_PATH, 'code-span', licensing[6], 1, 7),
      maskedHit(LICENSING_PATH, 'code-span', licensing[7], 1, 8),
      maskedHit(LICENSING_PATH, 'code-span', licensing[8], 1, 9),
      maskedHit(LICENSING_PATH, 'code-span', licensing[9], 1, 10),
      maskedHit(LICENSING_PATH, 'code-span', licensing[11], 1, 12),
      maskedHit(README_PATH, 'code-span', readme[12], 1, 13),
      { kind: 'readme', path: README_PATH, components: ['', 'apps/server', 'apps/web'] },
      { kind: 'asset-readme', path: ASSET_PATH, components: ['tools/asset-lab'], expectedLicense: 'MIT' },
    ]);
    for (const record of records) {
      assert.equal(record.severity, undefined);
      assert.ok(['component-table', 'readme', 'asset-readme', 'masked-license-hit'].includes(record.kind));
      for (const key of Object.keys(record)) {
        assert.ok(
          [
            'kind',
            'path',
            'components',
            'expectedLicense',
            'maskedKind',
            'contextSha256',
            'occurrence',
            'line',
            'allowlisted',
          ].includes(key),
          `unexpected key ${key}`,
        );
      }
      if (record.kind === 'masked-license-hit') {
        assert.equal(record.allowlisted, true);
        assert.match(record.contextSha256, /^[0-9a-f]{64}$/);
        assert.ok(Number.isInteger(record.occurrence) && record.occurrence >= 1);
        assert.ok(Number.isInteger(record.line) && record.line >= 1);
      }
    }
  });

  it('sorts issues deterministically and never mutates the input', () => {
    const map = validSnapshot();
    map.delete(ASSET_PATH);
    setDoc(
      map,
      LICENSING_PATH,
      LICENSING_DOC.replace('| `apps/web` | `MIT` | web area |', '| `apps/web` | `GPL-3.0-only` | web area |'),
    );
    const before = [...map.keys()];
    const beforeBytes = [...map.values()].map((value) => value.toString('hex'));
    const { records, issues } = checkDocumentation({ files: map });
    assert.deepEqual([...map.keys()], before);
    assert.deepEqual(
      [...map.values()].map((value) => value.toString('hex')),
      beforeBytes,
    );
    assert.deepEqual(
      issues.map((issue) => `${issue.path}|${issue.code}`),
      [...issues].map((issue) => `${issue.path}|${issue.code}`).sort(),
    );
    assert.deepEqual(
      records.map((record) => record.path),
      [...records.map((record) => record.path)].sort(),
    );
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', LICENSING_PATH));
    assert.ok(hasCode(issues, 'DOCUMENTATION_FILE_MISSING', ASSET_PATH));
    // The rewritten MIT row is a changed masked context without an exception,
    // so the stricter masked scan reports it with a diagnostic line as well.
    assert.ok(
      issues.some(
        (issue) =>
          issue.code === 'DOCUMENTATION_MARKDOWN_UNSUPPORTED' && issue.path === LICENSING_PATH && issue.line === 9,
      ),
    );
    for (const issue of issues) {
      // Masked hits carry an additional 1-based diagnostic line; no raw
      // content, URLs, tokens or reasons may leak into any issue.
      assert.deepEqual(
        Object.keys(issue)
          .sort()
          .filter((key) => key !== 'line'),
        ['code', 'path', 'severity'],
      );
      assert.equal(issue.severity, 'error');
      if ('line' in issue) {
        assert.ok(Number.isInteger(issue.line) && issue.line >= 1);
      }
    }
  });

  it('reports a wrong table license in an MIT scope', () => {
    const map = validSnapshot();
    setDoc(
      map,
      LICENSING_PATH,
      LICENSING_DOC.replace('| `apps/web` | `MIT` | web area |', '| `apps/web` | `GPL-3.0-only` | web area |'),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', LICENSING_PATH));
  });

  it('reports a missing table row', () => {
    const map = validSnapshot();
    setDoc(
      map,
      LICENSING_PATH,
      LICENSING_DOC.split('\n')
        .filter((line) => !line.includes('`tools/asset-lab`'))
        .join('\n'),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_TABLE_COMPONENT_MISSING', LICENSING_PATH));
  });

  it('reports an unconfigured table scope', () => {
    const map = validSnapshot();
    setDoc(
      map,
      LICENSING_PATH,
      LICENSING_DOC.replace(
        '| `tools/asset-lab` | `MIT` | lab tool |',
        '| `tools/asset-lab` | `MIT` | lab tool |\n| `apps/extra` | `MIT` | unknown scope |',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_TABLE_COMPONENT_UNCONFIGURED', LICENSING_PATH));
  });

  it('reports a duplicated table row', () => {
    const map = validSnapshot();
    setDoc(
      map,
      LICENSING_PATH,
      LICENSING_DOC.replace(
        '| `apps/web` | `MIT` | web area |',
        '| `apps/web` | `MIT` | web area |\n| `apps/web` | `MIT` | repeated |',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_TABLE_COMPONENT_DUPLICATE', LICENSING_PATH));
  });

  it('blocks reformatted masked rows until they carry their own exception', () => {
    // Reformatting keeps the claim parsing tolerant (no mismatch or missing
    // codes), but every rewritten masked line is a new context without an
    // exception, so the fail-closed scan blocks exactly those four lines.
    // The five baseline exceptions of the replaced table lose their context
    // and are reported as stale instead of silently lingering.
    const reordered = [
      '# Licensing',
      '',
      '## Per-component breakdown',
      '',
      '|Scope|License|',
      '|---|---|',
      '|   `tools/asset-lab`   |   MIT   |   reworded note, still fine   |',
      '| `apps/web` | **MIT** | reworded |',
      '| Root (`/LICENSE`) | AGPL-3.0-only | reworded |',
      '| `apps/server` | `AGPL-3.0-only` | reworded |',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, LICENSING_PATH, reordered);
    const { issues } = checkDocumentation({ files: map });
    const numeric = (a, b) => a.line - b.line;
    assert.deepEqual(
      issues
        .filter((issue) => issue.code === 'DOCUMENTATION_MARKDOWN_UNSUPPORTED')
        .map((issue) => ({ path: issue.path, code: issue.code, line: issue.line }))
        .sort(numeric),
      [7, 8, 9, 10].map((line) => ({
        path: LICENSING_PATH,
        code: 'DOCUMENTATION_MARKDOWN_UNSUPPORTED',
        line,
      })),
    );
    assert.equal(
      issues.filter((issue) => issue.code === 'DOCUMENTATION_MASKED_ALLOWLIST_STALE' && issue.path === LICENSING_PATH)
        .length,
      5,
    );
    assert.ok(
      issues.every((issue) =>
        ['DOCUMENTATION_MARKDOWN_UNSUPPORTED', 'DOCUMENTATION_MASKED_ALLOWLIST_STALE'].includes(issue.code),
      ),
    );
  });

  it('accepts the wrapped readme list of the valid fixture', () => {
    const { issues } = checkDocumentation({ files: validSnapshot() });
    assert.deepEqual(issues, []);
  });

  it('reports a readme item with a missing scope', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '- Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE).',
        '- Web client is licensed under [MIT](apps/web/LICENSE).',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', README_PATH));
  });

  it('reports a readme scope claimed twice', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '- Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE).',
        '- Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE).\n- Also (`apps/web`) under [MIT](apps/web/LICENSE).',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_DUPLICATE', README_PATH));
  });

  it('reports a wrong readme license link target', () => {
    const map = validSnapshot();
    setDoc(map, README_PATH, README_DOC.replace('[MIT](apps/web/LICENSE)', '[MIT](LICENSE)'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', README_PATH));
  });

  it('reports an AGPL-only claim widened to or-later', () => {
    const map = validSnapshot();
    setDoc(map, README_PATH, README_DOC.replace('[AGPL-3.0-only](LICENSE)', '[AGPL-3.0-or-later](LICENSE)'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', README_PATH));
  });

  it('reports a badge alt and image contradiction', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)',
        '![License: MIT](https://img.shields.io/badge/License-AGPL--3.0--only-red.svg)',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_BADGE_MISMATCH', README_PATH));
  });

  it('reports an imprecise AGPL-3.0 badge', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-red.svg)',
        '![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-red.svg)',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_BADGE_MISMATCH', README_PATH));
  });

  it('reports a missing license badge', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.split('\n')
        .filter((line) => !line.startsWith('![License: MIT]'))
        .join('\n'),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_BADGE_MISSING', README_PATH));
  });

  it('ignores claims inside comments and fenced code blocks', () => {
    const untrusted = [
      '# Licensing',
      '',
      '<!--',
      '## Per-component breakdown',
      '| Root (`/LICENSE`) | `AGPL-3.0-only` |',
      '-->',
      '',
      '```md',
      '## Per-component breakdown',
      '| `apps/server` | `AGPL-3.0-only` |',
      '```',
      '',
      '~~~md',
      '| `apps/web` | `MIT` |',
      '~~~',
      '',
      '## Other',
      '',
      'No table here.',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, LICENSING_PATH, untrusted);
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_SECTION_INVALID', LICENSING_PATH));
    assert.ok(hasCode(issues, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED', LICENSING_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_TABLE_COMPONENT_UNCONFIGURED', LICENSING_PATH));
  });

  it('ignores a commented readme claim', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '- Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE).',
        '<!-- - Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE). -->',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', README_PATH));
    assert.ok(hasCode(issues, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED', README_PATH));
  });

  it('reports a missing asset-lab MIT link', () => {
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, ['# Asset Lab', '', 'The Atelier is a local tool without a link.', ''].join('\n'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', ASSET_PATH));
  });

  it('reports a wrong asset-lab license link', () => {
    const map = validSnapshot();
    setDoc(
      map,
      ASSET_PATH,
      ['# Asset Lab', '', 'The Atelier is licensed under [GPL-3.0-only](LICENSE).', ''].join('\n'),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', ASSET_PATH));
  });

  it('reports a missing configured document', () => {
    const map = validSnapshot();
    map.delete(LICENSING_PATH);
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_FILE_MISSING', LICENSING_PATH));
  });

  it('reports a missing or duplicated section heading', () => {
    const missing = validSnapshot();
    setDoc(missing, LICENSING_PATH, ['# Licensing', '', 'No breakdown section here.', ''].join('\n'));
    assert.ok(hasCode(checkDocumentation({ files: missing }).issues, 'DOCUMENTATION_SECTION_INVALID', LICENSING_PATH));
    const duplicated = validSnapshot();
    setDoc(duplicated, LICENSING_PATH, `${LICENSING_DOC}\n## Per-component breakdown\n\nDuplicate section.\n`);
    assert.ok(
      hasCode(checkDocumentation({ files: duplicated }).issues, 'DOCUMENTATION_SECTION_INVALID', LICENSING_PATH),
    );
  });

  it('rejects an asset-lab license outside its area license', () => {
    const policy = policyWith((doc) => {
      doc.documentation.assetLab.license = 'GPL-3.0-only';
    });
    const thrown = dataInvalid(() => checkDocumentation({ files: snapshotWithPolicy(policy) }));
    assert.ok(!thrown.message.includes('GPL-3.0-only'), 'error message must not leak raw values');
  });

  it('accepts a neutral license link next to the asset-lab MIT claim', () => {
    const map = validSnapshot();
    setDoc(
      map,
      ASSET_PATH,
      ASSET_DOC.replace(
        'The Atelier is a local tool and is licensed under [MIT](LICENSE).',
        'The Atelier is a local tool and is licensed under [MIT](LICENSE), see [LICENSE](LICENSE).',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(issues, []);
  });

  it('ignores a readme license link shown only as inline code', () => {
    const map = validSnapshot();
    setDoc(map, README_PATH, README_DOC.replace('[AGPL-3.0-only](LICENSE)', '`[AGPL-3.0-only](LICENSE)`'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', README_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', README_PATH));
  });

  it('ignores an asset-lab MIT link shown only as inline code', () => {
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, ASSET_DOC.replace('[MIT](LICENSE)', '`[MIT](LICENSE)`'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', ASSET_PATH));
  });

  it('ignores a license badge shown only as inline code', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)',
        '`![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)`',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_BADGE_MISSING', README_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_LICENSE_BADGE_MISMATCH', README_PATH));
  });

  it('still reports a real wrong link next to escaped backticks', () => {
    const map = validSnapshot();
    setDoc(
      map,
      ASSET_PATH,
      ['# Asset Lab', '', 'The Atelier uses \\`example\\` under [GPL-3.0-only](LICENSE).', ''].join('\n'),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', ASSET_PATH));
  });

  it('hides a valid table behind an unclosed comment', () => {
    // The open block stays separately unsupported, and the swallowed table
    // lines form no verifiable context, so their five baseline exceptions
    // are reported as stale instead of silently lingering.
    const map = validSnapshot();
    setDoc(map, LICENSING_PATH, ['# Licensing', '', '<!-- notes start, never closed', '', LICENSING_DOC].join('\n'));
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [
        `${LICENSING_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`,
        `${LICENSING_PATH}|DOCUMENTATION_MASKED_ALLOWLIST_STALE`,
        `${LICENSING_PATH}|DOCUMENTATION_MASKED_ALLOWLIST_STALE`,
        `${LICENSING_PATH}|DOCUMENTATION_MASKED_ALLOWLIST_STALE`,
        `${LICENSING_PATH}|DOCUMENTATION_MASKED_ALLOWLIST_STALE`,
        `${LICENSING_PATH}|DOCUMENTATION_MASKED_ALLOWLIST_STALE`,
        `${LICENSING_PATH}|DOCUMENTATION_SECTION_INVALID`,
      ],
    );
  });

  it('reports a real wrong asset-lab link after a fence with a comment marker', () => {
    const fenced = [
      '# Asset Lab',
      '',
      'The Atelier is licensed under [MIT](LICENSE).',
      '',
      '```md',
      '<!--',
      '```',
      '',
      '[GPL-3.0-only](LICENSE)',
      '',
      '<!-- end -->',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, fenced);
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', ASSET_PATH));
  });

  it('keeps later claims when a fence opener sits inside a real comment', () => {
    const commented = [
      '# Asset Lab',
      '',
      '<!-- ```',
      'commented fence, still a comment',
      '-->',
      '',
      'The Atelier is licensed under [MIT](LICENSE).',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, commented);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('reports an unclosed fence as unsupported instead of silent green', () => {
    const map = validSnapshot();
    setDoc(map, LICENSING_PATH, `${LICENSING_DOC}\n\`\`\`md\nunclosed example\n`);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${LICENSING_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('ignores a readme link stitched across inline code', () => {
    const map = validSnapshot();
    setDoc(map, README_PATH, README_DOC.replace('[MIT](apps/web/LICENSE)', '[MIT]`example`(apps/web/LICENSE)'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', README_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', README_PATH));
  });

  it('ignores an asset-lab link stitched across inline code', () => {
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, ASSET_DOC.replace('[MIT](LICENSE)', '[MI`example`T](LICENSE)'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', ASSET_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', ASSET_PATH));
  });

  it('treats two backslashes before a code-only readme link as a real opener', () => {
    const map = validSnapshot();
    setDoc(map, README_PATH, README_DOC.replace('[MIT](apps/web/LICENSE)', '\\\\`[MIT](apps/web/LICENSE)`'));
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', README_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', README_PATH));
  });

  it('reports a real link after a span closed through backslash and backtick', () => {
    const fenced = [
      '# Asset Lab',
      '',
      'The Atelier is licensed under [MIT](LICENSE).',
      '',
      '`example\\` [GPL-3.0-only](LICENSE) `ignored`',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, fenced);
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', ASSET_PATH));
  });

  it('reports a real claim after a comment marker inside inline code', () => {
    const masked = [
      '# Asset Lab',
      '',
      'The Atelier is licensed under [MIT](LICENSE).',
      '',
      '`<!--`',
      '[GPL-3.0-only](LICENSE)',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, masked);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${ASSET_PATH}|DOCUMENTATION_LICENSE_MISMATCH`],
    );
  });

  it('blocks a multiline code span instead of silent green', () => {
    const map = validSnapshot();
    setDoc(
      map,
      README_PATH,
      README_DOC.replace(
        '- Web client (`apps/web`) is licensed under [MIT](apps/web/LICENSE).',
        '- Web client (`apps/web`) is licensed under `\n  [MIT](apps/web/LICENSE)\n  `.',
      ),
    );
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED', README_PATH));
  });

  it('closes a comment with backticks around its end marker on one line', () => {
    const fenced = [
      '# Asset Lab',
      '',
      'The Atelier is licensed under [MIT](LICENSE).',
      '',
      '<!-- ` --> `',
      '[GPL-3.0-only](LICENSE)',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, fenced);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${ASSET_PATH}|DOCUMENTATION_LICENSE_MISMATCH`, `${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('closes a comment with backticks around its end marker on the next line', () => {
    const fenced = [
      '# Asset Lab',
      '',
      'The Atelier is licensed under [MIT](LICENSE).',
      '',
      '<!--',
      '` --> `',
      '[GPL-3.0-only](LICENSE)',
      '',
    ].join('\n');
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, fenced);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${ASSET_PATH}|DOCUMENTATION_LICENSE_MISMATCH`, `${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('blocks an unclosed comment even with all claims before it', () => {
    const map = validSnapshot();
    setDoc(map, LICENSING_PATH, `${LICENSING_DOC}\n<!-- trailing notes never closed\n`);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${LICENSING_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('blocks a closed comment carrying backticks', () => {
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, `${ASSET_DOC}\n<!-- \`example\` -->\n`);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('blocks an unmatched backtick span instead of literal green', () => {
    const map = validSnapshot();
    setDoc(map, README_PATH, `${README_DOC}\n\`unfinished example\n`);
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(
      issues.map((entry) => `${entry.path}|${entry.code}`),
      [`${README_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED`],
    );
  });

  it('rejects unsafe snapshot paths and non-buffer values', () => {
    for (const bad of ['/abs/path.md', './rel.md', '../up.md', 'a//b.md', 'a\\b.md', 'a\0b.md']) {
      const map = validSnapshot();
      map.set(bad, Buffer.from('x', 'utf8'));
      dataInvalid(() => checkDocumentation({ files: map }));
    }
    const nonBuffer = validSnapshot();
    nonBuffer.set(README_PATH, '# License\n');
    dataInvalid(() => checkDocumentation({ files: nonBuffer }));
    dataInvalid(() => checkDocumentation({ files: [] }));
    dataInvalid(() => checkDocumentation({}));
  });

  it('rejects an incoherent policy without leaking raw values', () => {
    const marker = 'MARKER-9F3A';
    const cases = [
      (doc) => delete doc.documentation,
      (doc) => delete doc.documentation.componentTable,
      (doc) => {
        doc.documentation.readme.badges = [marker];
      },
      (doc) => {
        doc.documentation.readme.badges = ['MIT', 'MIT'];
      },
      (doc) => {
        doc.documentation.readme.badges = ['MIT'];
      },
      (doc) => {
        doc.documentation.readme.groups[0].components.push('apps/web');
      },
      (doc) => {
        doc.documentation.readme.groups[0].components.push(marker);
      },
      (doc) => {
        doc.documentation.readme.groups[1].license = 'GPL-3.0-only';
      },
      (doc) => {
        doc.documentation.readme.groups.push({
          components: ['tools/asset-lab'],
          license: 'MIT',
          licenseTarget: 'LICENSE',
        });
      },
      (doc) => {
        doc.documentation.readme.groups[0].license = 'MIT OR Apache-2.0';
      },
      (doc) => {
        doc.documentation.readme.groups[0].license = 'AND';
      },
      (doc) => {
        doc.documentation.assetLab.path = '/abs/README.md';
      },
      (doc) => {
        doc.documentation.componentTable.path = '';
      },
      (doc) => {
        doc.areas[0].paths = ['apps/server'];
      },
      (doc) => {
        doc.areas[1].paths.push('apps/server');
      },
      (doc) => {
        doc.metadata.licenseByArea.unknown = 'MIT';
      },
      (doc) => delete doc.metadata.licenseByArea.mit,
      (doc) => {
        doc.metadata.manifests = [];
      },
      (doc) => {
        doc.metadata.manifests.push('apps/extra/package.json');
      },
      (doc) => {
        doc.documentation.assetLab.licenseTarget = '../LICENSE';
      },
    ];
    for (const mutate of cases) {
      const thrown = dataInvalid(() => checkDocumentation({ files: snapshotWithPolicy(policyWith(mutate)) }));
      assert.ok(!thrown.message.includes(marker), 'error message must not leak raw values');
    }
  });

  it('blocks a license id inside a code-span link label', () => {
    // The valid MIT Atelier paragraph stays intact, but the GPL marker
    // hidden in the code-span link label must fail closed.
    const map = validSnapshot();
    const changed = ASSET_DOC.replace(
      'is licensed under [MIT](LICENSE).',
      'is licensed under [MIT](LICENSE), see [`GPL-3.0-only`](LICENSE).',
    );
    setDoc(map, ASSET_PATH, changed);
    const { issues, records } = checkDocumentation({ files: map });
    assert.ok(!hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', ASSET_PATH));
    assert.ok(!hasCode(issues, 'DOCUMENTATION_LICENSE_MISMATCH', ASSET_PATH));
    const hits = records.filter((record) => record.kind === 'masked-license-hit' && record.path === ASSET_PATH);
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0], {
      kind: 'masked-license-hit',
      path: ASSET_PATH,
      maskedKind: 'code-span',
      contextSha256: sha256(changed.split('\n')[2]),
      occurrence: 1,
      line: 3,
      allowlisted: false,
    });
    assert.deepEqual(
      issues.map((issue) => `${issue.path}|${issue.code}|${issue.line}`),
      [`${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED|3`],
    );
  });

  it('blocks a license id inside a fenced block', () => {
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, `${ASSET_DOC}\n\`\`\`text\nInternal note: GPL-3.0-only applies here.\n\`\`\`\n`);
    const { issues, records } = checkDocumentation({ files: map });
    assert.ok(!hasCode(issues, 'DOCUMENTATION_README_CLAIM_MISSING', ASSET_PATH));
    const hits = records.filter((record) => record.kind === 'masked-license-hit' && record.path === ASSET_PATH);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].maskedKind, 'fence');
    assert.equal(hits[0].occurrence, 1);
    assert.equal(hits[0].allowlisted, false);
    assert.match(hits[0].contextSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(
      issues.map((issue) => `${issue.path}|${issue.code}|${issue.line}`),
      [`${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED|9`],
    );
  });

  it('blocks license prose inside a closed comment without code', () => {
    const map = validSnapshot();
    setDoc(map, ASSET_PATH, `${ASSET_DOC}\n<!-- Copyright notice: MIT applies internally -->\n`);
    const { issues, records } = checkDocumentation({ files: map });
    const hits = records.filter((record) => record.kind === 'masked-license-hit' && record.path === ASSET_PATH);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].maskedKind, 'comment');
    assert.equal(hits[0].allowlisted, false);
    assert.deepEqual(
      issues.map((issue) => `${issue.path}|${issue.code}|${issue.line}`),
      [`${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED|9`],
    );
  });

  it('blocks a bare inline-code license marker or keyword', () => {
    for (const marker of ['`MIT`', '`copyright`']) {
      const map = validSnapshot();
      setDoc(map, ASSET_PATH, `${ASSET_DOC}\n${marker}\n`);
      const { issues } = checkDocumentation({ files: map });
      assert.ok(hasCode(issues, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED', ASSET_PATH), `expected block for ${marker}`);
    }
  });

  it('accepts an exactly scoped exception with an auditable record', () => {
    const note = '<!-- Internal SPDX note: MIT -->';
    const doc = `${ASSET_DOC}\n${note}\n`;
    const policy = policyWith((document) => {
      document.documentation.maskedContent.allowlist.push({
        path: ASSET_PATH,
        kind: 'comment',
        contextSha256: sha256(note),
        occurrence: 1,
        reason: 'Fixed test note restating the evaluated MIT claim for the asset lab.',
      });
    });
    const map = snapshotWithPolicy(policy);
    setDoc(map, ASSET_PATH, doc);
    const { issues, records } = checkDocumentation({ files: map });
    assert.deepEqual(issues, []);
    const hits = records.filter((record) => record.kind === 'masked-license-hit' && record.path === ASSET_PATH);
    assert.equal(hits.length, 1);
    assert.deepEqual(hits[0], {
      kind: 'masked-license-hit',
      path: ASSET_PATH,
      maskedKind: 'comment',
      contextSha256: sha256(note),
      occurrence: 1,
      line: 9,
      allowlisted: true,
    });
  });

  it('keeps an exception valid when unrelated lines are inserted above', () => {
    const note = '<!-- Internal SPDX note: MIT -->';
    const shifted = `${ASSET_DOC}\n${note}\n`.replace('# Asset Lab\n', '# Asset Lab\n\nNeutral intro line.\n');
    const policy = policyWith((document) => {
      document.documentation.maskedContent.allowlist.push({
        path: ASSET_PATH,
        kind: 'comment',
        contextSha256: sha256(note),
        occurrence: 1,
        reason: 'Fixed test note restating the evaluated MIT claim for the asset lab.',
      });
    });
    const map = snapshotWithPolicy(policy);
    setDoc(map, ASSET_PATH, shifted);
    const { issues, records } = checkDocumentation({ files: map });
    assert.deepEqual(issues, []);
    const hits = records.filter((record) => record.kind === 'masked-license-hit' && record.path === ASSET_PATH);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].line, 11);
    assert.equal(hits[0].allowlisted, true);
  });

  it('rejects an exception when the masked context changed', () => {
    const policy = policyWith((document) => {
      document.documentation.maskedContent.allowlist.push({
        path: ASSET_PATH,
        kind: 'comment',
        contextSha256: sha256('<!-- Internal SPDX note: MIT -->'),
        occurrence: 1,
        reason: 'Fixed test note restating the evaluated MIT claim for the asset lab.',
      });
    });
    const map = snapshotWithPolicy(policy);
    setDoc(map, ASSET_PATH, `${ASSET_DOC}\n<!-- Internal SPDX note: MIT. -->\n`);
    const { issues } = checkDocumentation({ files: map });
    assert.ok(hasCode(issues, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED', ASSET_PATH));
    assert.ok(hasCode(issues, 'DOCUMENTATION_MASKED_ALLOWLIST_STALE', ASSET_PATH));
  });

  it('rejects an exception bound to the wrong path, kind, hash or occurrence', () => {
    const digest = sha256('<!-- Internal SPDX note: MIT -->');
    const doc = `${ASSET_DOC}\n<!-- Internal SPDX note: MIT -->\n`;
    const variants = [
      { path: README_PATH, kind: 'comment', contextSha256: digest, occurrence: 1 },
      { path: ASSET_PATH, kind: 'fence', contextSha256: digest, occurrence: 1 },
      {
        path: ASSET_PATH,
        kind: 'comment',
        contextSha256: (digest[0] === '0' ? '1' : '0') + digest.slice(1),
        occurrence: 1,
      },
      { path: ASSET_PATH, kind: 'comment', contextSha256: digest, occurrence: 2 },
    ];
    for (const variant of variants) {
      const policy = policyWith((document) => {
        document.documentation.maskedContent.allowlist.push({
          ...variant,
          reason: 'Fixed test entry with a deliberately wrong binding.',
        });
      });
      const map = snapshotWithPolicy(policy);
      setDoc(map, ASSET_PATH, doc);
      const { issues } = checkDocumentation({ files: map });
      assert.ok(
        hasCode(issues, 'DOCUMENTATION_MARKDOWN_UNSUPPORTED', ASSET_PATH),
        `expected block for ${JSON.stringify(variant)}`,
      );
      assert.ok(
        hasCode(issues, 'DOCUMENTATION_MASKED_ALLOWLIST_STALE', variant.path),
        `expected stale entry for ${JSON.stringify(variant)}`,
      );
    }
  });

  it('requires one exception per identical masked context', () => {
    const doc = `${ASSET_DOC}\n\`MIT\`\n\`MIT\`\n`;
    const firstLine = ASSET_DOC.split('\n').length + 1;
    const digest = sha256('`MIT`');
    const allow = (occurrence) => ({
      path: ASSET_PATH,
      kind: 'code-span',
      contextSha256: digest,
      occurrence,
      reason: `Fixed test marker covering identical line ${occurrence} of two.`,
    });
    const single = snapshotWithPolicy(
      policyWith((document) => {
        document.documentation.maskedContent.allowlist.push(allow(1));
      }),
    );
    setDoc(single, ASSET_PATH, doc);
    const partial = checkDocumentation({ files: single });
    assert.deepEqual(
      partial.issues.map((issue) => `${issue.path}|${issue.code}|${issue.line}`),
      [`${ASSET_PATH}|DOCUMENTATION_MARKDOWN_UNSUPPORTED|${firstLine + 1}`],
    );
    assert.deepEqual(
      partial.records
        .filter((record) => record.kind === 'masked-license-hit' && record.path === ASSET_PATH)
        .map((hit) => [hit.occurrence, hit.line, hit.allowlisted]),
      [
        [1, firstLine, true],
        [2, firstLine + 1, false],
      ],
    );
    const both = snapshotWithPolicy(
      policyWith((document) => {
        document.documentation.maskedContent.allowlist.push(allow(1), allow(2));
      }),
    );
    setDoc(both, ASSET_PATH, doc);
    assert.deepEqual(checkDocumentation({ files: both }).issues, []);
  });

  it('reports an unused exception as stale', () => {
    const policy = policyWith((document) => {
      document.documentation.maskedContent.allowlist.push({
        path: ASSET_PATH,
        kind: 'comment',
        contextSha256: '0'.repeat(64),
        occurrence: 1,
        reason: 'Fixed test entry for a context that does not exist.',
      });
    });
    const { issues } = checkDocumentation({ files: snapshotWithPolicy(policy) });
    assert.deepEqual(issues, [{ severity: 'error', code: 'DOCUMENTATION_MASKED_ALLOWLIST_STALE', path: ASSET_PATH }]);
  });

  it('rejects malformed allowlist entries without leaking raw values', () => {
    const marker = 'MARKER-9F3A';
    const base = {
      path: ASSET_PATH,
      kind: 'comment',
      contextSha256: '0'.repeat(64),
      occurrence: 1,
      reason: 'Fixed test entry.',
    };
    const cases = [
      (entry) => delete entry.contextSha256,
      (entry) => {
        entry.contextSha256 = 'zz';
      },
      (entry) => {
        entry.contextSha256 = 'AB'.repeat(32);
      },
      (entry) => {
        entry.path = 'OTHER.md';
      },
      (entry) => {
        entry.path = 'tools/*';
      },
      (entry) => {
        entry.kind = 'inline';
      },
      (entry) => {
        entry.occurrence = 0;
      },
      (entry) => {
        entry.occurrence = 1.5;
      },
      (entry) => {
        entry.occurrence = '1';
      },
      (entry) => {
        entry.reason = '';
      },
      (entry) => {
        entry.reason = '   ';
      },
      (entry) => {
        entry.keyword = marker;
      },
      (entry) => {
        delete entry.path;
        entry.reason = marker;
      },
    ];
    for (const mutate of cases) {
      const entry = { ...base };
      mutate(entry);
      const thrown = dataInvalid(() =>
        checkDocumentation({
          files: snapshotWithPolicy(
            policyWith((document) => {
              document.documentation.maskedContent.allowlist.push(entry);
            }),
          ),
        }),
      );
      assert.ok(!thrown.message.includes(marker), 'error message must not leak raw values');
    }
    const duplicate = dataInvalid(() =>
      checkDocumentation({
        files: snapshotWithPolicy(
          policyWith((document) => {
            document.documentation.maskedContent.allowlist.push(
              { ...base, reason: marker },
              { ...base, reason: marker },
            );
          }),
        ),
      }),
    );
    assert.ok(!duplicate.message.includes(marker), 'error message must not leak raw values');
  });

  it('rejects incomplete masked-content policy without leaking raw values', () => {
    const marker = 'MARKER-9F3A';
    const cases = [
      (document) => delete document.documentation.maskedContent,
      (document) => {
        document.documentation.maskedContent.licenseIds = [];
      },
      (document) => {
        document.documentation.maskedContent.licenseIds.push('MIT');
      },
      (document) => {
        document.documentation.maskedContent.licenseIds.push(`NOT AN ID ${marker}`);
      },
      (document) => {
        document.documentation.maskedContent.licenseIds = document.documentation.maskedContent.licenseIds.filter(
          (id) => id !== 'MIT',
        );
      },
      (document) => {
        document.documentation.maskedContent.keywords = [];
      },
      (document) => {
        document.documentation.maskedContent.keywords.push('');
      },
      (document) => {
        document.documentation.maskedContent.keywords.push('LICENSE');
      },
      (document) => {
        document.documentation.maskedContent[marker] = [];
      },
      (document) => {
        document.documentation.maskedContent.allowlist = {};
      },
      (document) => {
        document.documentation.maskedContent.extra = [];
      },
    ];
    for (const mutate of cases) {
      const thrown = dataInvalid(() => checkDocumentation({ files: snapshotWithPolicy(policyWith(mutate)) }));
      assert.ok(!thrown.message.includes(marker), 'error message must not leak raw values');
    }
  });

  it('leaves normal masked text and near-miss words alone', () => {
    // No license id or keyword hides here: plain tooling commands, ordinary
    // prose, 'example' (which merely contains 'mpl') and lowercase German
    // 'mit' (which is not the canonical MIT id) must stay silent.
    const map = validSnapshot();
    setDoc(
      map,
      ASSET_PATH,
      `${ASSET_DOC}\n\`npm run dev --port 3000\`\n<!-- plain editorial note -->\n\`\`\`text\nplain example config\n\`\`\`\n\`example\`\n\`npm run dev\` helps with the start.\n`,
    );
    const { issues } = checkDocumentation({ files: map });
    assert.deepEqual(issues, []);
  });
});
