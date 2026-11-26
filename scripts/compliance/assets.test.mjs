// Tests for the deterministic local asset check.
//
// The fixtures use small self-authored byte sequences only: no repository
// asset is read, no image is produced or converted, and the committed
// compliance files are used as schema reference.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { checkAssets } from './assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const COMPLIANCE_DIR = path.join(REPO_ROOT, 'compliance');

const POLICY_PATH = 'compliance/policy.json';
const ASSETS_PATH = 'compliance/assets.json';
const FORBIDDEN_PATH = 'compliance/forbidden-characters.json';

const policyBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'policy.json'));
const committedForbiddenBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'forbidden-characters.json'));
const committedManifestBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'assets.json'));

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitBlobSha1 = (bytes) =>
  createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');

// Six harmless byte sequences that form the test deny table.
const DENY_SEQUENCES = [
  'meetropolis-test-character-0-alpha\n',
  'meetropolis-test-character-1-beta\n',
  'meetropolis-test-character-2-gamma\n',
  'meetropolis-test-character-3-delta\n',
  'meetropolis-test-character-4-epsilon\n',
  'meetropolis-test-character-5-zeta\n',
];

const denyBytes = (index) => Buffer.from(DENY_SEQUENCES[index], 'utf8');

const forbiddenTable = () => ({
  schemaVersion: 1,
  source: {
    url: 'https://example.invalid/meetropolis-test-characters',
    revision: 'a'.repeat(40),
  },
  entries: DENY_SEQUENCES.map((sequence, index) => {
    const bytes = Buffer.from(sequence, 'utf8');
    return { id: `char_${index}`, gitBlob: gitBlobSha1(bytes), sha256: sha256Hex(bytes) };
  }),
});

// Same table, but the second entry only matches through its git blob digest.
const forbiddenTableWithBlobOnly = () => {
  const table = forbiddenTable();
  table.entries[1] = {
    id: 'char_1',
    gitBlob: gitBlobSha1(denyBytes(1)),
    sha256: sha256Hex(Buffer.from('unrelated-digest-content\n', 'utf8')),
  };
  return table;
};

const manifestEntry = (overrides = {}) => ({
  path: 'apps/web/public/assets/hero.png',
  sha256: sha256Hex(Buffer.from('hero-bytes\n', 'utf8')),
  type: '.png',
  license: 'MIT',
  copyright: 'Tiamat UG',
  origin: {
    kind: 'upstream',
    source: 'https://example.invalid/upstream-asset',
    revision: 'b'.repeat(40),
    evidence: 'Byte comparison with the upstream state',
  },
  verification: 'verified',
  note: 'Test entry',
  ...overrides,
});

// Entry with the digest of the given content.
const withBytes = (entry, content) => {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return { entry: { ...entry, sha256: sha256Hex(bytes) }, bytes };
};

const snapshot = ({
  entries = [],
  files = [],
  policy = policyBytes,
  forbidden = forbiddenTable(),
  manifest = null,
} = {}) => {
  const map = new Map();
  map.set(POLICY_PATH, policy);
  map.set(ASSETS_PATH, manifest ?? jsonBytes({ schemaVersion: 1, snapshot: { revision: 'c'.repeat(40) }, entries }));
  map.set(FORBIDDEN_PATH, jsonBytes(forbidden));
  for (const [key, value] of files) map.set(key, value);
  return map;
};

// Copy of the committed policy with one changed rule.
const policyWith = (mutate) => {
  const document = JSON.parse(policyBytes.toString('utf8'));
  mutate(document);
  return jsonBytes(document);
};

const codesFor = (issues, filePath) =>
  issues
    .filter((issue) => issue.path === filePath)
    .map((issue) => issue.code)
    .sort();

const hasCode = (issues, code, filePath) =>
  issues.some((issue) => issue.code === code && (filePath === undefined || issue.path === filePath));

const severityOf = (issues, code, filePath) =>
  issues.find((issue) => issue.code === code && issue.path === filePath)?.severity;

const dataInvalid = (run) => {
  let thrown = null;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof Error, 'expected an Error');
  assert.equal(thrown.code, 'COMPLIANCE_DATA_INVALID');
  return thrown;
};

describe('checkAssets', () => {
  it('reads the asset rules from the committed policy', () => {
    const policy = JSON.parse(policyBytes.toString('utf8'));
    assert.equal(policy.schemaVersion, 1);
    assert.ok(Array.isArray(policy.assets.extensions));
    assert.ok(policy.assets.extensions.includes('.png'));
    assert.ok(policy.assets.extensions.includes('.svg'));
    assert.ok(policy.assets.fontExtensions.includes('.woff2'));
    assert.deepEqual(policy.assets.allowedLicensesByArea.agpl, ['AGPL-3.0-only', 'MIT']);
    assert.deepEqual(policy.assets.allowedLicensesByArea.mit, ['MIT']);
    assert.deepEqual(policy.assets.fontLicenses, ['OFL-1.1']);
    assert.deepEqual(policy.assets.fontLicenseTexts, ['apps/web/public/fonts/PressStart2P-OFL.txt']);
    // The license areas, the dependency ids and the review locks stay untouched.
    assert.equal(policy.areas.length, 2);
    assert.deepEqual(policy.commonAllowedLicenses, [
      '0BSD',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
      'MIT',
      'MIT-0',
      'Unlicense',
      'Zlib',
    ]);
    assert.deepEqual(
      policy.reviewRequired.map((entry) => entry.id),
      ['MPL-2.0', 'EPL-2.0'],
    );
    // The area structure of the policy stays valid: one root fallback and
    // exactly the declared area ids in the license lists.
    assert.equal(policy.areas.filter((area) => area.paths.includes('')).length, 1);
    assert.deepEqual(Object.keys(policy.assets.allowedLicensesByArea).sort(), ['agpl', 'mit']);
    for (const fontExtension of policy.assets.fontExtensions) {
      assert.ok(policy.assets.extensions.includes(fontExtension), fontExtension);
    }
  });

  it('accepts a known MIT asset', () => {
    const asset = withBytes(manifestEntry(), 'hero-bytes\n');
    const { records, issues } = checkAssets({
      files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
    });
    assert.deepEqual(issues, []);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      path: 'apps/web/public/assets/hero.png',
      sha256: asset.entry.sha256,
      verification: 'verified',
      selectedLicenses: ['MIT'],
    });
    assert.deepEqual(Object.keys(records[0]).sort(), ['path', 'selectedLicenses', 'sha256', 'verification']);
  });

  it('flags new media files and new binary files without an entry', () => {
    const files = [
      ['apps/web/public/new.png', Buffer.from('new-png-bytes\n', 'utf8')],
      ['apps/web/public/new.svg', Buffer.from('<svg></svg>\n', 'utf8')],
      ['apps/web/public/blob.dat', Buffer.from([0x00, 0x01, 0x02, 0x00])],
    ];
    const { issues } = checkAssets({ files: snapshot({ files }) });
    for (const [filePath] of files) {
      assert.ok(hasCode(issues, 'ASSET_PROVENANCE_MISSING', filePath), filePath);
    }
    assert.equal(issues.length, 3);
  });

  it('flags a changed file and a stale manifest entry', () => {
    const asset = withBytes(manifestEntry(), 'hero-bytes\n');
    const { issues } = checkAssets({
      files: snapshot({
        entries: [asset.entry],
        files: [[asset.entry.path, Buffer.from('changed-bytes\n', 'utf8')]],
      }),
    });
    assert.ok(hasCode(issues, 'ASSET_DIGEST_MISMATCH', asset.entry.path));
  });

  it('flags an entry without a file as stale', () => {
    const asset = withBytes(manifestEntry(), 'hero-bytes\n');
    const { issues } = checkAssets({ files: snapshot({ entries: [asset.entry] }) });
    assert.deepEqual(codesFor(issues, asset.entry.path), ['ASSET_MANIFEST_STALE']);
  });

  it('flags a renamed file with a forbidden character digest', () => {
    const filePath = 'apps/web/public/renamed.png';
    const { issues } = checkAssets({
      files: snapshot({ files: [[filePath, denyBytes(0)]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_FORBIDDEN_CHARACTER', filePath));
    assert.ok(hasCode(issues, 'ASSET_PROVENANCE_MISSING', filePath));
  });

  it('flags a forbidden character through the git blob digest', () => {
    const filePath = 'apps/web/public/blob-only.bin';
    const { issues } = checkAssets({
      files: snapshot({ forbidden: forbiddenTableWithBlobOnly(), files: [[filePath, denyBytes(1)]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_FORBIDDEN_CHARACTER', filePath));
  });

  it('flags a forbidden character in a file without media extension', () => {
    const filePath = 'apps/web/public/notes.txt';
    const { issues } = checkAssets({
      files: snapshot({ files: [[filePath, denyBytes(2)]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_FORBIDDEN_CHARACTER', filePath));
    // A text file is no asset candidate, so no provenance issue is expected.
    assert.ok(!hasCode(issues, 'ASSET_PROVENANCE_MISSING', filePath));
  });

  it('flags a declared origin on the forbidden character collection', () => {
    const asset = withBytes(
      manifestEntry({
        origin: {
          kind: 'upstream',
          source: 'https://github.com/example/pixel-agents/tree/main/characters/char_0.png',
          revision: 'b'.repeat(40),
          evidence: 'Byte comparison with the upstream state',
        },
      }),
      'hero-bytes\n',
    );
    const { issues } = checkAssets({
      files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_FORBIDDEN_ORIGIN', asset.entry.path));
  });

  it('keeps an upstream source without character reference free', () => {
    const asset = withBytes(
      manifestEntry({
        origin: {
          kind: 'upstream',
          source: 'https://github.com/pablodelucca/pixel-agents',
          revision: 'b'.repeat(40),
          evidence: 'Byte comparison with the upstream state',
        },
      }),
      'hero-bytes\n',
    );
    const { issues } = checkAssets({
      files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
    });
    assert.deepEqual(issues, []);
  });

  it('accepts an empty placeholder and flags a filled one', () => {
    const placeholder = withBytes(
      manifestEntry({
        path: 'apps/web/public/placeholder.png',
        type: '.png',
        origin: {
          kind: 'empty-placeholder',
          source: 'Empty 0-byte placeholder in the repository, without image content',
          revision: 'b'.repeat(40),
          evidence: 'File content has 0 bytes and contains no third-party content',
        },
      }),
      Buffer.alloc(0),
    );
    const empty = checkAssets({
      files: snapshot({
        entries: [placeholder.entry],
        files: [[placeholder.entry.path, placeholder.bytes]],
      }),
    });
    assert.deepEqual(empty.issues, []);

    const filled = checkAssets({
      files: snapshot({
        entries: [placeholder.entry],
        files: [[placeholder.entry.path, Buffer.from('filled-bytes\n', 'utf8')]],
      }),
    });
    assert.ok(hasCode(filled.issues, 'ASSET_PLACEHOLDER_CHANGED', placeholder.entry.path));
  });

  it('flags an empty media file without a declared placeholder', () => {
    const asset = withBytes(manifestEntry({ path: 'apps/web/public/empty.png' }), Buffer.alloc(0));
    const { issues } = checkAssets({
      files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_EMPTY_UNDECLARED', asset.entry.path));
  });

  it('requires a review for documented media and documents documented text', () => {
    const media = withBytes(
      manifestEntry({ path: 'apps/web/public/documented.png', verification: 'documented' }),
      'documented-bytes\n',
    );
    const mediaResult = checkAssets({
      files: snapshot({ entries: [media.entry], files: [[media.entry.path, media.bytes]] }),
    });
    assert.ok(hasCode(mediaResult.issues, 'ASSET_REVIEW_REQUIRED', media.entry.path));
    assert.equal(severityOf(mediaResult.issues, 'ASSET_REVIEW_REQUIRED', media.entry.path), 'error');

    const text = withBytes(
      manifestEntry({ path: 'docs/guide.txt', type: '.txt', verification: 'documented' }),
      'documented-text\n',
    );
    const textResult = checkAssets({
      files: snapshot({ entries: [text.entry], files: [[text.entry.path, text.bytes]] }),
    });
    assert.deepEqual(codesFor(textResult.issues, text.entry.path), ['ASSET_SOURCE_DOCUMENTED']);
    assert.equal(severityOf(textResult.issues, 'ASSET_SOURCE_DOCUMENTED', text.entry.path), 'info');
  });

  it('requires a review for a documented origin kind and for review-required status', () => {
    const kind = withBytes(
      manifestEntry({
        path: 'apps/web/public/kind.png',
        origin: {
          kind: 'documented',
          source: 'In-repo documentation',
          revision: 'b'.repeat(40),
          evidence: 'Documented state without a byte comparison',
        },
      }),
      'kind-bytes\n',
    );
    const kindResult = checkAssets({
      files: snapshot({ entries: [kind.entry], files: [[kind.entry.path, kind.bytes]] }),
    });
    assert.ok(hasCode(kindResult.issues, 'ASSET_REVIEW_REQUIRED', kind.entry.path));

    const review = withBytes(
      manifestEntry({ path: 'apps/web/public/review.png', verification: 'review-required' }),
      'review-bytes\n',
    );
    const reviewResult = checkAssets({
      files: snapshot({ entries: [review.entry], files: [[review.entry.path, review.bytes]] }),
    });
    assert.ok(hasCode(reviewResult.issues, 'ASSET_REVIEW_REQUIRED', review.entry.path));
  });

  it('flags a missing revision even when the owner confirmed the file', () => {
    const asset = withBytes(
      manifestEntry({
        path: 'apps/web/public/owner.png',
        verification: 'owner-confirmed',
        origin: {
          kind: 'owner-confirmed',
          source: 'Own project file by lass machen',
          revision: null,
          evidence: 'Copyright confirmed by the project owner',
        },
      }),
      'owner-bytes\n',
    );
    const { issues } = checkAssets({
      files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_SOURCE_UNPINNED', asset.entry.path));
    assert.equal(severityOf(issues, 'ASSET_SOURCE_UNPINNED', asset.entry.path), 'error');
  });

  it('separates the AGPL and the MIT area', () => {
    const web = withBytes(manifestEntry({ path: 'apps/web/public/agpl.png', license: 'AGPL-3.0-only' }), 'web-bytes\n');
    const webResult = checkAssets({
      files: snapshot({ entries: [web.entry], files: [[web.entry.path, web.bytes]] }),
    });
    assert.ok(hasCode(webResult.issues, 'ASSET_LICENSE_NOT_ALLOWED', web.entry.path));

    const server = withBytes(
      manifestEntry({ path: 'apps/server/public/agpl.png', license: 'AGPL-3.0-only' }),
      'server-bytes\n',
    );
    const serverResult = checkAssets({
      files: snapshot({ entries: [server.entry], files: [[server.entry.path, server.bytes]] }),
    });
    assert.deepEqual(serverResult.issues, []);

    const root = withBytes(manifestEntry({ path: 'docs/agpl.png', license: 'AGPL-3.0-only' }), 'root-bytes\n');
    const rootResult = checkAssets({
      files: snapshot({ entries: [root.entry], files: [[root.entry.path, root.bytes]] }),
    });
    assert.deepEqual(rootResult.issues, []);
  });

  it('allows the font license for fonts and for the listed font license text', () => {
    const font = withBytes(
      manifestEntry({ path: 'apps/web/public/fonts/Test.woff2', type: '.woff2', license: 'OFL-1.1' }),
      'font-bytes\n',
    );
    const fontResult = checkAssets({
      files: snapshot({ entries: [font.entry], files: [[font.entry.path, font.bytes]] }),
    });
    assert.deepEqual(fontResult.issues, []);

    const licenseText = withBytes(
      manifestEntry({
        path: 'apps/web/public/fonts/PressStart2P-OFL.txt',
        type: '.txt',
        license: 'OFL-1.1',
      }),
      'license-text-bytes\n',
    );
    const licenseTextResult = checkAssets({
      files: snapshot({
        entries: [licenseText.entry],
        files: [[licenseText.entry.path, licenseText.bytes]],
      }),
    });
    assert.deepEqual(licenseTextResult.issues, []);

    const image = withBytes(
      manifestEntry({ path: 'apps/web/public/images/font.png', license: 'OFL-1.1' }),
      'image-bytes\n',
    );
    const imageResult = checkAssets({
      files: snapshot({ entries: [image.entry], files: [[image.entry.path, image.bytes]] }),
    });
    assert.ok(hasCode(imageResult.issues, 'ASSET_LICENSE_NOT_ALLOWED', image.entry.path));
  });

  it('keeps an unknown license red even when the owner confirmed the file', () => {
    const unknown = withBytes(
      manifestEntry({
        path: 'apps/web/public/logo.png',
        license: 'unbekannt (rights proof missing)',
        verification: 'owner-confirmed',
        origin: {
          kind: 'owner-confirmed',
          source: 'Own project file by lass machen',
          revision: 'b'.repeat(40),
          evidence: 'Copyright confirmed by the project owner',
        },
      }),
      'logo-bytes\n',
    );
    const { issues } = checkAssets({
      files: snapshot({ entries: [unknown.entry], files: [[unknown.entry.path, unknown.bytes]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_LICENSE_UNKNOWN', unknown.entry.path));

    const missing = withBytes(manifestEntry({ path: 'apps/web/public/void.png', license: null }), 'void-bytes\n');
    const missingResult = checkAssets({
      files: snapshot({ entries: [missing.entry], files: [[missing.entry.path, missing.bytes]] }),
    });
    assert.ok(hasCode(missingResult.issues, 'ASSET_LICENSE_UNKNOWN', missing.entry.path));
  });

  it('evaluates license expressions with and without alternatives', () => {
    const or = withBytes(
      manifestEntry({ path: 'apps/web/public/or.png', license: 'MIT OR GPL-3.0-only' }),
      'or-bytes\n',
    );
    const orResult = checkAssets({
      files: snapshot({ entries: [or.entry], files: [[or.entry.path, or.bytes]] }),
    });
    assert.deepEqual(orResult.issues, []);
    assert.deepEqual(orResult.records[0].selectedLicenses, ['MIT']);

    const and = withBytes(
      manifestEntry({ path: 'apps/web/public/and.png', license: 'MIT AND GPL-3.0-only' }),
      'and-bytes\n',
    );
    const andResult = checkAssets({
      files: snapshot({ entries: [and.entry], files: [[and.entry.path, and.bytes]] }),
    });
    assert.ok(hasCode(andResult.issues, 'ASSET_LICENSE_NOT_ALLOWED', and.entry.path));

    const invalid = withBytes(
      manifestEntry({ path: 'apps/web/public/invalid.png', license: 'MIT AND' }),
      'invalid-bytes\n',
    );
    const invalidResult = checkAssets({
      files: snapshot({ entries: [invalid.entry], files: [[invalid.entry.path, invalid.bytes]] }),
    });
    assert.ok(hasCode(invalidResult.issues, 'ASSET_LICENSE_INVALID', invalid.entry.path));
  });

  it('flags internal finding codes and temporary paths in public free text', () => {
    const sources = [
      'F-DOC-17',
      'F-OPEN-3',
      'In-repo note under .vord/child-reports/plan.md',
      'File under /Users/example/Desktop/asset.png',
      'Copy under /tmp/asset.png',
    ];
    for (const source of sources) {
      const asset = withBytes(
        manifestEntry({
          path: 'apps/web/public/internal.png',
          origin: {
            kind: 'repository',
            source,
            revision: 'b'.repeat(40),
            evidence: 'Byte comparison with the repository state',
          },
        }),
        'internal-bytes\n',
      );
      const { issues } = checkAssets({
        files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
      });
      assert.ok(
        hasCode(issues, 'ASSET_INTERNAL_REFERENCE', asset.entry.path),
        `expected an internal reference issue for ${source}`,
      );
      const issue = issues.find((entry) => entry.code === 'ASSET_INTERNAL_REFERENCE');
      assert.deepEqual(Object.keys(issue).sort(), ['code', 'path', 'severity']);
      assert.ok(!issue.message);
      assert.ok(!JSON.stringify(issue).includes(source));
    }
  });

  it('flags a media entry whose type does not match the extension', () => {
    const asset = withBytes(manifestEntry({ path: 'apps/web/public/wrong.png', type: '.svg' }), 'wrong-bytes\n');
    const { issues } = checkAssets({
      files: snapshot({ entries: [asset.entry], files: [[asset.entry.path, asset.bytes]] }),
    });
    assert.ok(hasCode(issues, 'ASSET_TYPE_MISMATCH', asset.entry.path));
  });

  it('treats a registered binary file with an unknown extension as an asset candidate', () => {
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0x00]);
    const documented = withBytes(
      manifestEntry({ path: 'apps/web/public/data.bin', type: '.bin', verification: 'documented' }),
      bytes,
    );
    const documentedResult = checkAssets({
      files: snapshot({
        entries: [documented.entry],
        files: [[documented.entry.path, documented.bytes]],
      }),
    });
    assert.ok(hasCode(documentedResult.issues, 'ASSET_REVIEW_REQUIRED', documented.entry.path));
    assert.equal(severityOf(documentedResult.issues, 'ASSET_REVIEW_REQUIRED', documented.entry.path), 'error');

    const verified = withBytes(
      manifestEntry({ path: 'apps/web/public/data.bin', type: '.bin', verification: 'verified' }),
      bytes,
    );
    const verifiedResult = checkAssets({
      files: snapshot({
        entries: [verified.entry],
        files: [[verified.entry.path, verified.bytes]],
      }),
    });
    assert.deepEqual(verifiedResult.issues, []);
  });

  it('checks registered metadata and license texts as well', () => {
    const metadata = withBytes(
      manifestEntry({ path: 'apps/web/public/assets/atelier/v1/catalog.json', type: '.json' }),
      'catalog-bytes\n',
    );
    const licenseText = withBytes(
      manifestEntry({ path: 'THIRD_PARTY_LICENSES/README.md', type: '.md', license: 'AGPL-3.0-only' }),
      'readme-bytes\n',
    );
    const { issues } = checkAssets({
      files: snapshot({
        entries: [metadata.entry, licenseText.entry],
        files: [
          [metadata.entry.path, metadata.bytes],
          [licenseText.entry.path, licenseText.bytes],
        ],
      }),
    });
    assert.deepEqual(issues, []);
  });

  it('rejects broken compliance data with a constant hint', () => {
    const asset = withBytes(manifestEntry(), 'hero-bytes\n');
    const broken = [
      () =>
        checkAssets({
          files: snapshot({
            entries: [asset.entry, { ...asset.entry }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, path: '../escape.png' }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, sha256: 'not-a-digest' }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, origin: { ...asset.entry.origin, kind: 'guess' } }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, verification: 'assumed' }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, copyright: '' }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, origin: { ...asset.entry.origin, evidence: '' } }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            entries: [{ ...asset.entry, origin: { ...asset.entry.origin, revision: 'abc' } }],
            files: [[asset.entry.path, asset.bytes]],
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            manifest: jsonBytes({ schemaVersion: 2, entries: [] }),
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            forbidden: { ...forbiddenTable(), entries: forbiddenTable().entries.slice(0, 5) },
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            forbidden: {
              ...forbiddenTable(),
              entries: forbiddenTable().entries.map((entry, index) =>
                index === 1 ? { ...entry, sha256: forbiddenTable().entries[0].sha256 } : entry,
              ),
            },
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            forbidden: { schemaVersion: 1, entries: forbiddenTable().entries },
          }),
        }),
      () =>
        checkAssets({
          files: snapshot({
            forbidden: {
              ...forbiddenTable(),
              entries: forbiddenTable().entries.map((entry, index) =>
                index === 0 ? { ...entry, bytes: 'BASE64' } : entry,
              ),
            },
          }),
        }),
    ];
    const messages = broken.map((run) => dataInvalid(run).message);
    for (const message of messages) {
      assert.equal(message, messages[0]);
      assert.ok(!message.includes('hero-bytes'));
      assert.ok(!message.includes('escape.png'));
    }
  });

  it('rejects an asset policy without exactly one root fallback', () => {
    const font = withBytes(
      manifestEntry({
        path: 'docs/fonts/Test.woff2',
        type: '.woff2',
        license: 'OFL-1.1',
      }),
      'font-bytes\n',
    );
    const policy = policyWith((document) => {
      document.areas = document.areas.map((area) => ({
        ...area,
        paths: area.paths.filter((candidate) => candidate !== ''),
      }));
    });
    dataInvalid(() =>
      checkAssets({
        files: snapshot({
          policy,
          entries: [font.entry],
          files: [[font.entry.path, font.bytes]],
        }),
      }),
    );
  });

  it('rejects an asset policy with a missing area license list', () => {
    const font = withBytes(
      manifestEntry({ path: 'apps/web/public/fonts/Test.woff2', type: '.woff2', license: 'OFL-1.1' }),
      'font-bytes\n',
    );
    const policy = policyWith((document) => {
      delete document.assets.allowedLicensesByArea.mit;
    });
    dataInvalid(() =>
      checkAssets({
        files: snapshot({
          policy,
          entries: [font.entry],
          files: [[font.entry.path, font.bytes]],
        }),
      }),
    );
  });

  it('rejects an asset policy with an unknown area in the license lists', () => {
    const font = withBytes(
      manifestEntry({ path: 'apps/web/public/fonts/Test.woff2', type: '.woff2', license: 'OFL-1.1' }),
      'font-bytes\n',
    );
    const policy = policyWith((document) => {
      document.assets.allowedLicensesByArea.mitt = ['MIT'];
    });
    dataInvalid(() =>
      checkAssets({
        files: snapshot({
          policy,
          entries: [font.entry],
          files: [[font.entry.path, font.bytes]],
        }),
      }),
    );
  });

  it('rejects an asset policy with a font extension outside the media list', () => {
    const font = withBytes(
      manifestEntry({ path: 'apps/web/public/fonts/Test.woff2', type: '.woff2', license: 'OFL-1.1' }),
      'font-bytes\n',
    );
    const policy = policyWith((document) => {
      document.assets.fontExtensions = [...document.assets.fontExtensions, '.xyz'];
    });
    dataInvalid(() =>
      checkAssets({
        files: snapshot({
          policy,
          entries: [font.entry],
          files: [[font.entry.path, font.bytes]],
        }),
      }),
    );
  });

  it('rejects a source pin with credentials, query, hash or a foreign scheme', () => {
    const markers = [
      'https://marker-user:marker-secret@example.invalid/characters',
      'https://example.invalid/characters?token=marker-query',
      'https://example.invalid/characters#marker-hash',
      'http://example.invalid/characters',
      'not-a-url-marker',
    ];
    for (const url of markers) {
      const forbidden = forbiddenTable();
      forbidden.source.url = url;
      const error = dataInvalid(() => checkAssets({ files: snapshot({ forbidden }) }));
      assert.ok(!error.message.includes('marker'), url);
      assert.ok(!error.message.includes('example.invalid'), url);
    }
  });

  it('rejects an unusable snapshot', () => {
    dataInvalid(() => checkAssets({ files: 'not-a-map' }));
    dataInvalid(() => checkAssets({ files: snapshot({ files: [['/etc/passwd', Buffer.alloc(1)]] }) }));
    dataInvalid(() => checkAssets({ files: snapshot({ files: [['a/../b.png', Buffer.alloc(1)]] }) }));
    dataInvalid(() => checkAssets({ files: snapshot({ files: [['a/b.png', 'text-value']] }) }));
    const withoutPolicy = snapshot();
    withoutPolicy.delete(POLICY_PATH);
    dataInvalid(() => checkAssets({ files: withoutPolicy }));
    const withoutManifest = snapshot();
    withoutManifest.delete(ASSETS_PATH);
    dataInvalid(() => checkAssets({ files: withoutManifest }));
    const withoutForbidden = snapshot();
    withoutForbidden.delete(FORBIDDEN_PATH);
    dataInvalid(() => checkAssets({ files: withoutForbidden }));
  });

  it('accepts the committed manifest and the committed deny table as schema', () => {
    const files = new Map();
    files.set(POLICY_PATH, policyBytes);
    files.set(ASSETS_PATH, committedManifestBytes);
    files.set(FORBIDDEN_PATH, committedForbiddenBytes);
    const { issues } = checkAssets({ files });
    const committed = JSON.parse(committedManifestBytes.toString('utf8'));
    for (const entry of committed.entries) {
      assert.ok(hasCode(issues, 'ASSET_MANIFEST_STALE', entry.path), entry.path);
    }
    for (const issue of issues) {
      assert.deepEqual(Object.keys(issue).sort(), ['code', 'path', 'severity']);
    }
  });

  it('is deterministic for reordered inputs', () => {
    const first = withBytes(manifestEntry({ path: 'apps/web/public/a.png' }), 'a-bytes\n');
    const second = withBytes(manifestEntry({ path: 'apps/web/public/b.png', license: 'AGPL-3.0-only' }), 'b-bytes\n');
    const third = withBytes(
      manifestEntry({
        path: 'apps/web/public/c.txt',
        type: '.txt',
        verification: 'documented',
      }),
      'c-bytes\n',
    );
    const entries = [first.entry, second.entry, third.entry];
    const files = [
      [first.entry.path, first.bytes],
      [second.entry.path, second.bytes],
      [third.entry.path, third.bytes],
    ];
    const forward = checkAssets({ files: snapshot({ entries, files }) });
    const backward = checkAssets({ files: snapshot({ entries: [...entries].reverse(), files: [...files].reverse() }) });
    assert.deepEqual(backward.issues, forward.issues);
    assert.deepEqual(backward.records, forward.records);
    assert.ok(forward.issues.length > 0);
  });
});
