// Tests for the deterministic local metadata check.
//
// The fixtures use small self-authored byte sequences only: no repository
// file is read as a snapshot, no network or filesystem access happens
// inside the module, and the committed compliance policy is used only as
// a coherent schema reference. The frozen local profile is never read.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { checkMetadata } from './metadata.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const COMPLIANCE_DIR = path.join(REPO_ROOT, 'compliance');

const POLICY_PATH = 'compliance/policy.json';

const policyBytes = fs.readFileSync(path.join(COMPLIANCE_DIR, 'policy.json'));

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Small but fully coherent fixture policy: two areas with one root
// fallback, two manifests, one license file per area and one
// dockerfile per area.
const fixturePolicy = () => ({
  schemaVersion: 1,
  areas: [
    { id: 'agpl', description: 'Server area.', paths: ['', 'apps/server'] },
    { id: 'mit', description: 'Web area.', paths: ['apps/web'] },
  ],
  metadata: {
    licenseByArea: { agpl: 'AGPL-3.0-only', mit: 'MIT' },
    manifests: ['package.json', 'apps/server/package.json', 'apps/web/package.json'],
    licenseFiles: [
      { path: 'LICENSE', sha256: sha256Hex(Buffer.from('agpl-text\n', 'utf8')) },
      { path: 'apps/web/LICENSE', sha256: sha256Hex(Buffer.from('mit-text\n', 'utf8')) },
    ],
    dockerfiles: ['apps/server/Dockerfile', 'apps/web/Dockerfile'],
  },
});

const manifestBytes = (license, extra = {}) => jsonBytes({ name: 'fixture', version: '0.0.1', license, ...extra });

const dockerBytes = (text) => Buffer.from(text, 'utf8');

const SERVER_DOCKER = [
  'FROM node:24-bookworm-slim AS builder',
  'RUN npm run build',
  'FROM node:24-bookworm-slim AS runner',
  'LABEL org.opencontainers.image.licenses="AGPL-3.0-only"',
  'CMD ["node", "dist/index.js"]',
  '',
].join('\n');

const WEB_DOCKER = [
  'FROM node:24-bookworm-slim AS builder',
  'RUN npm run build',
  'FROM nginx:alpine AS runner',
  'LABEL org.opencontainers.image.licenses="MIT"',
  'CMD ["nginx", "-g", "daemon off;"]',
  '',
].join('\n');

// A snapshot with every configured file present and valid.
const validSnapshot = (policy = fixturePolicy()) => {
  const map = new Map();
  map.set(POLICY_PATH, jsonBytes(policy));
  map.set('package.json', manifestBytes('AGPL-3.0-only'));
  map.set('apps/server/package.json', manifestBytes('AGPL-3.0-only'));
  map.set('apps/web/package.json', manifestBytes('MIT'));
  map.set('LICENSE', Buffer.from('agpl-text\n', 'utf8'));
  map.set('apps/web/LICENSE', Buffer.from('mit-text\n', 'utf8'));
  map.set('apps/server/Dockerfile', dockerBytes(SERVER_DOCKER));
  map.set('apps/web/Dockerfile', dockerBytes(WEB_DOCKER));
  return map;
};

const policyWith = (mutate) => {
  const document = JSON.parse(JSON.stringify(fixturePolicy()));
  mutate(document);
  return document;
};

const snapshotWithPolicy = (policy) => {
  const map = validSnapshot(policy);
  return map;
};

const codesFor = (issues, filePath) =>
  issues
    .filter((issue) => issue.path === filePath)
    .map((issue) => issue.code)
    .sort();

const hasCode = (issues, code, filePath) =>
  issues.some((issue) => issue.code === code && (filePath === undefined || issue.path === filePath));

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

describe('checkMetadata', () => {
  it('reads the metadata rules from the committed policy', () => {
    const policy = JSON.parse(policyBytes.toString('utf8'));
    assert.equal(policy.schemaVersion, 1);
    assert.ok(policy.metadata, 'committed policy carries metadata rules');
    assert.deepEqual(policy.metadata.licenseByArea, { agpl: 'AGPL-3.0-only', mit: 'MIT' });
    assert.deepEqual(policy.metadata.manifests, [
      'package.json',
      'apps/server/package.json',
      'apps/npc-service/package.json',
      'apps/loadtest/package.json',
      'apps/web/package.json',
      'packages/shared/package.json',
      'tools/asset-lab/package.json',
    ]);
    assert.deepEqual(
      policy.metadata.licenseFiles.map((entry) => entry.path),
      ['LICENSE', 'apps/web/LICENSE', 'packages/shared/LICENSE', 'tools/asset-lab/LICENSE'],
    );
    for (const entry of policy.metadata.licenseFiles) {
      assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    }
    assert.deepEqual(policy.metadata.dockerfiles, [
      'apps/server/Dockerfile',
      'apps/web/Dockerfile',
      'apps/npc-service/Dockerfile',
      'apps/loadtest/Dockerfile',
    ]);
    // The metadata rules cover exactly the declared areas.
    assert.deepEqual(Object.keys(policy.metadata.licenseByArea).sort(), ['agpl', 'mit']);
    assert.deepEqual(policy.areas.map((area) => area.id).sort(), ['agpl', 'mit']);
    assert.equal(policy.areas.filter((area) => area.paths.includes('')).length, 1);
  });

  it('accepts a valid minimal snapshot with sorted records', () => {
    const { records, issues } = checkMetadata({ files: validSnapshot() });
    assert.deepEqual(issues, []);
    assert.deepEqual(records, [
      { kind: 'license-file', path: 'LICENSE', expectedLicense: 'AGPL-3.0-only' },
      { kind: 'dockerfile', path: 'apps/server/Dockerfile', expectedLicense: 'AGPL-3.0-only', finalStage: 2 },
      { kind: 'manifest', path: 'apps/server/package.json', expectedLicense: 'AGPL-3.0-only' },
      { kind: 'dockerfile', path: 'apps/web/Dockerfile', expectedLicense: 'MIT', finalStage: 2 },
      { kind: 'license-file', path: 'apps/web/LICENSE', expectedLicense: 'MIT' },
      { kind: 'manifest', path: 'apps/web/package.json', expectedLicense: 'MIT' },
      { kind: 'manifest', path: 'package.json', expectedLicense: 'AGPL-3.0-only' },
    ]);
    for (const record of records) {
      assert.equal(record.severity, undefined);
      if (record.kind === 'dockerfile') {
        assert.deepEqual(Object.keys(record).sort(), ['expectedLicense', 'finalStage', 'kind', 'path']);
        assert.equal(typeof record.finalStage, 'number');
      } else {
        assert.deepEqual(Object.keys(record).sort(), ['expectedLicense', 'kind', 'path']);
      }
    }
  });

  it('sorts issues deterministically and never mutates the input', () => {
    const map = validSnapshot();
    // Insert findings in reverse order: order of discovery must not matter.
    map.set('apps/web/package.json', manifestBytes('GPL-3.0-only'));
    map.set('apps/server/Dockerfile', dockerBytes('FROM node:24\n'));
    const before = [...map.keys()];
    const { records, issues } = checkMetadata({ files: map });
    assert.deepEqual([...map.keys()], before);
    assert.deepEqual(
      issues.map((issue) => `${issue.path}|${issue.code}`),
      [...issues].map((issue) => `${issue.path}|${issue.code}`).sort(),
    );
    assert.deepEqual(
      records.map((record) => record.path),
      [...records.map((record) => record.path)].sort(),
    );
    assert.ok(hasCode(issues, 'METADATA_MANIFEST_LICENSE_MISMATCH', 'apps/web/package.json'));
    assert.ok(hasCode(issues, 'METADATA_DOCKER_LICENSE_MISSING', 'apps/server/Dockerfile'));
    for (const issue of issues) {
      assert.deepEqual(Object.keys(issue).sort(), ['code', 'path', 'severity']);
      assert.equal(issue.severity, 'error');
    }
  });

  it('rejects unsafe snapshot paths and non-buffer values', () => {
    for (const bad of ['/abs/path.json', './rel.json', '../up.json', 'a//b.json', 'a\\b.json', 'a\0b.json']) {
      const map = validSnapshot();
      map.set(bad, Buffer.from('x', 'utf8'));
      dataInvalid(() => checkMetadata({ files: map }));
    }
    const nonBuffer = validSnapshot();
    nonBuffer.set('package.json', '{"license":"AGPL-3.0-only"}');
    dataInvalid(() => checkMetadata({ files: nonBuffer }));
    dataInvalid(() => checkMetadata({ files: [] }));
    dataInvalid(() => checkMetadata({}));
  });

  it('rejects an incoherent policy without leaking raw values', () => {
    const cases = [
      (doc) => delete doc.metadata,
      (doc) => delete doc.metadata.licenseByArea,
      (doc) => delete doc.metadata.licenseByArea.mit,
      (doc) => {
        doc.metadata.licenseByArea.unknown = 'MIT';
      },
      (doc) => {
        doc.metadata.licenseByArea.mit = '';
      },
      (doc) => {
        doc.metadata.licenseByArea.mit = 'MIT OR Apache-2.0';
      },
      (doc) => {
        doc.areas[0].paths = ['apps/server'];
      },
      (doc) => {
        doc.areas[1].paths.push('apps/server');
      },
      (doc) => {
        doc.metadata.manifests = [];
      },
      (doc) => {
        doc.metadata.manifests.push('apps/server/package.json');
      },
      (doc) => {
        doc.metadata.manifests.push('apps/server/not-a-manifest.json');
      },
      (doc) => {
        doc.metadata.manifests.push('/abs/package.json');
      },
      (doc) => {
        doc.metadata.licenseFiles = [];
      },
      (doc) => {
        doc.metadata.licenseFiles[0].sha256 = 'xyz';
      },
      (doc) => {
        doc.metadata.licenseFiles.push({ path: 'apps/server/notes.txt', sha256: 'a'.repeat(64) });
      },
      (doc) => {
        doc.metadata.dockerfiles = [];
      },
      (doc) => {
        doc.metadata.dockerfiles.push('apps/server/Dockerfile');
      },
      (doc) => {
        doc.metadata.dockerfiles.push('apps/server/docker-compose.yml');
      },
    ];
    for (const mutate of cases) {
      const thrown = dataInvalid(() => checkMetadata({ files: snapshotWithPolicy(policyWith(mutate)) }));
      assert.ok(!thrown.message.includes('GPL'), 'no raw license value in the message');
    }
    // A missing policy file is invalid data as well.
    const missing = validSnapshot();
    missing.delete(POLICY_PATH);
    dataInvalid(() => checkMetadata({ files: missing }));
  });

  it('flags a GPL web package but ignores private:true', () => {
    const map = validSnapshot();
    map.set('apps/web/package.json', manifestBytes('GPL-3.0-only'));
    const { issues } = checkMetadata({ files: map });
    assert.deepEqual(codesFor(issues, 'apps/web/package.json'), ['METADATA_MANIFEST_LICENSE_MISMATCH']);

    const withPrivate = validSnapshot();
    withPrivate.set('apps/web/package.json', manifestBytes('MIT', { private: true }));
    assert.deepEqual(checkMetadata({ files: withPrivate }).issues, []);

    const privateWithoutLicense = validSnapshot();
    privateWithoutLicense.set('apps/web/package.json', jsonBytes({ name: 'fixture', private: true }));
    const missed = checkMetadata({ files: privateWithoutLicense });
    assert.deepEqual(codesFor(missed.issues, 'apps/web/package.json'), ['METADATA_MANIFEST_LICENSE_MISMATCH']);
  });

  it('flags missing and new manifests and invalid json', () => {
    const missing = validSnapshot();
    missing.delete('apps/server/package.json');
    assert.ok(
      hasCode(checkMetadata({ files: missing }).issues, 'METADATA_MANIFEST_MISSING', 'apps/server/package.json'),
    );

    const extra = validSnapshot();
    extra.set('tools/extra/package.json', manifestBytes('MIT'));
    assert.ok(
      hasCode(checkMetadata({ files: extra }).issues, 'METADATA_MANIFEST_UNCONFIGURED', 'tools/extra/package.json'),
    );

    for (const broken of [Buffer.from('not json', 'utf8'), jsonBytes([1, 2]), jsonBytes(null)]) {
      const map = validSnapshot();
      map.set('apps/web/package.json', broken);
      assert.ok(hasCode(checkMetadata({ files: map }).issues, 'METADATA_MANIFEST_INVALID', 'apps/web/package.json'));
    }

    for (const brokenLicense of [undefined, 42, 'mit']) {
      const map = validSnapshot();
      const document = { name: 'fixture' };
      if (brokenLicense !== undefined) document.license = brokenLicense;
      map.set('apps/web/package.json', jsonBytes(document));
      assert.ok(
        hasCode(checkMetadata({ files: map }).issues, 'METADATA_MANIFEST_LICENSE_MISMATCH', 'apps/web/package.json'),
      );
    }
  });

  it('flags a changed or missing license text but ignores third-party texts', () => {
    const changed = validSnapshot();
    changed.set('LICENSE', Buffer.from('changed-text\n', 'utf8'));
    assert.ok(hasCode(checkMetadata({ files: changed }).issues, 'METADATA_LICENSE_FILE_CHANGED', 'LICENSE'));

    const missing = validSnapshot();
    missing.delete('apps/web/LICENSE');
    const missed = checkMetadata({ files: missing });
    assert.ok(hasCode(missed.issues, 'METADATA_LICENSE_FILE_MISSING', 'apps/web/LICENSE'));
    assert.ok(!missed.records.some((record) => record.path === 'apps/web/LICENSE'));

    const extra = validSnapshot();
    extra.set('compliance/licenses/example/LICENSE', Buffer.from('third-party\n', 'utf8'));
    extra.set('apps/web/NOTICE.md', Buffer.from('third-party\n', 'utf8'));
    assert.deepEqual(checkMetadata({ files: extra }).issues, []);

    const { records } = checkMetadata({ files: validSnapshot() });
    assert.deepEqual(
      records.find((record) => record.path === 'apps/web/LICENSE'),
      { kind: 'license-file', path: 'apps/web/LICENSE', expectedLicense: 'MIT' },
    );
  });

  it('flags missing and new dockerfiles', () => {
    const missing = validSnapshot();
    missing.delete('apps/web/Dockerfile');
    assert.ok(hasCode(checkMetadata({ files: missing }).issues, 'METADATA_DOCKER_MISSING', 'apps/web/Dockerfile'));

    const extra = validSnapshot();
    extra.set('apps/server/Dockerfile.dev', dockerBytes('FROM node:24\n'));
    assert.ok(
      hasCode(checkMetadata({ files: extra }).issues, 'METADATA_DOCKER_UNCONFIGURED', 'apps/server/Dockerfile.dev'),
    );

    const plain = validSnapshot();
    plain.set('apps/server/notes.txt', dockerBytes('FROM node:24\n'));
    assert.deepEqual(checkMetadata({ files: plain }).issues, []);
  });

  it('checks only the final stage and never inherits builder labels', () => {
    const wrongWeb = validSnapshot();
    wrongWeb.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM node:24 AS builder',
          'LABEL org.opencontainers.image.licenses="MIT"',
          'FROM nginx:alpine',
          'LABEL org.opencontainers.image.licenses="Apache-2.0"',
          '',
        ].join('\n'),
      ),
    );
    const webIssues = checkMetadata({ files: wrongWeb }).issues;
    assert.deepEqual(codesFor(webIssues, 'apps/web/Dockerfile'), ['METADATA_DOCKER_LICENSE_MISMATCH']);
    assert.ok(!JSON.stringify(checkMetadata({ files: wrongWeb })).includes('Apache-2.0'));

    const builderOnly = validSnapshot();
    builderOnly.set(
      'apps/server/Dockerfile',
      dockerBytes(
        ['FROM node:24 AS builder', 'LABEL org.opencontainers.image.licenses="AGPL-3.0-only"', 'FROM node:24', ''].join(
          '\n',
        ),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: builderOnly }).issues, 'apps/server/Dockerfile'), [
      'METADATA_DOCKER_LICENSE_MISSING',
    ]);

    const builderWrongFinalRight = validSnapshot();
    builderWrongFinalRight.set(
      'apps/server/Dockerfile',
      dockerBytes(
        [
          'FROM node:24 AS builder',
          'LABEL org.opencontainers.image.licenses="MIT"',
          'FROM node:24',
          'LABEL org.opencontainers.image.licenses="AGPL-3.0-only"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(checkMetadata({ files: builderWrongFinalRight }).issues, []);
  });

  it('supports multiline, quoted and paired labels plus the legacy form', () => {
    const map = validSnapshot();
    map.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'from node:24 AS builder',
          'RUN npm run build',
          'FROM nginx:alpine AS runner',
          'LABEL "org.opencontainers.image.licenses"="MIT" \\',
          "      org.opencontainers.image.title='meetropolis web' \\",
          '      org.opencontainers.image.source=https://example.invalid/web',
          '',
        ].join('\n'),
      ),
    );
    const { records, issues } = checkMetadata({ files: map });
    assert.deepEqual(codesFor(issues, 'apps/web/Dockerfile'), []);
    assert.deepEqual(
      records.find((record) => record.path === 'apps/web/Dockerfile'),
      { kind: 'dockerfile', path: 'apps/web/Dockerfile', expectedLicense: 'MIT', finalStage: 2 },
    );
    assert.ok(!JSON.stringify({ records, issues }).includes('example.invalid'));

    const legacy = validSnapshot();
    legacy.set(
      'apps/server/Dockerfile',
      dockerBytes('FROM node:24\nLABEL org.opencontainers.image.licenses AGPL-3.0-only\n'),
    );
    assert.deepEqual(checkMetadata({ files: legacy }).issues, []);
  });

  it('ignores commented and fake labels inside run instructions', () => {
    const map = validSnapshot();
    map.set(
      'apps/server/Dockerfile',
      dockerBytes(
        [
          'FROM node:24 AS builder',
          '# LABEL org.opencontainers.image.licenses="AGPL-3.0-only"',
          'RUN echo "LABEL org.opencontainers.image.licenses=AGPL-3.0-only" > /tmp/note',
          'FROM node:24',
          'RUN echo done \\',
          '  && echo "LABEL org.opencontainers.image.licenses=MIT"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: map }).issues, 'apps/server/Dockerfile'), [
      'METADATA_DOCKER_LICENSE_MISSING',
    ]);
  });

  it('flags duplicate final labels and variable values as mismatch', () => {
    const duplicate = validSnapshot();
    duplicate.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM nginx:alpine',
          'LABEL org.opencontainers.image.licenses="MIT" org.opencontainers.image.licenses="MIT"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: duplicate }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_LICENSE_DUPLICATE',
    ]);

    const split = validSnapshot();
    split.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM nginx:alpine',
          'LABEL org.opencontainers.image.licenses="MIT"',
          'LABEL org.opencontainers.image.title="web" org.opencontainers.image.licenses="MIT"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: split }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_LICENSE_DUPLICATE',
    ]);

    for (const variable of ['$LICENSE', '${LICENSE}', '"$LICENSE"']) {
      const map = validSnapshot();
      map.set(
        'apps/web/Dockerfile',
        dockerBytes(`FROM nginx:alpine\nLABEL org.opencontainers.image.licenses=${variable}\n`),
      );
      assert.deepEqual(codesFor(checkMetadata({ files: map }).issues, 'apps/web/Dockerfile'), [
        'METADATA_DOCKER_LICENSE_MISMATCH',
      ]);
    }
  });

  it('removes comment lines before joining continuations', () => {
    const continued = validSnapshot();
    continued.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM nginx:alpine',
          'LABEL org.opencontainers.image.licenses="MIT"',
          '# Comment with a trailing backslash \\',
          'LABEL org.opencontainers.image.licenses="GPL-3.0-only"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: continued }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_LICENSE_DUPLICATE',
    ]);

    const single = validSnapshot();
    single.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM nginx:alpine',
          '# Comment with a trailing backslash \\',
          'LABEL org.opencontainers.image.licenses="GPL-3.0-only"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: single }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_LICENSE_MISMATCH',
    ]);

    const interleaved = validSnapshot();
    interleaved.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM nginx:alpine',
          'LABEL org.opencontainers.image.licenses="MIT" \\',
          '# Comment between continuation lines',
          '  org.opencontainers.image.title="web"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(checkMetadata({ files: interleaved }).issues, []);
  });

  it('rejects empty continuations as unsupported syntax', () => {
    const emptyAfterRun = validSnapshot();
    emptyAfterRun.set(
      'apps/web/Dockerfile',
      dockerBytes(
        ['FROM nginx:alpine', 'RUN echo noop \\', '', 'LABEL org.opencontainers.image.licenses="MIT"', ''].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: emptyAfterRun }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_SYNTAX_UNSUPPORTED',
    ]);

    const blankAfterRun = validSnapshot();
    blankAfterRun.set(
      'apps/web/Dockerfile',
      dockerBytes(
        ['FROM nginx:alpine', 'RUN echo noop \\', '   ', 'LABEL org.opencontainers.image.licenses="MIT"', ''].join(
          '\n',
        ),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: blankAfterRun }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_SYNTAX_UNSUPPORTED',
    ]);

    const emptyBetweenArgs = validSnapshot();
    emptyBetweenArgs.set(
      'apps/web/Dockerfile',
      dockerBytes(
        [
          'FROM nginx:alpine',
          'LABEL org.opencontainers.image.licenses="MIT" \\',
          '',
          '  org.opencontainers.image.title="web"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: emptyBetweenArgs }).issues, 'apps/web/Dockerfile'), [
      'METADATA_DOCKER_SYNTAX_UNSUPPORTED',
    ]);
  });

  it('rejects non-id license values without leaking markers', () => {
    for (const bad of ['MIT$', 'MIT(GPL)', 'AND', 'OR', 'WITH']) {
      const thrown = dataInvalid(() =>
        checkMetadata({
          files: snapshotWithPolicy(
            policyWith((doc) => {
              doc.metadata.licenseByArea.mit = bad;
            }),
          ),
        }),
      );
      assert.ok(!thrown.message.includes(bad), bad);
    }
  });

  it('rejects heredoc and non-backslash escapes as unsupported syntax', () => {
    const heredoc = validSnapshot();
    heredoc.set(
      'apps/server/Dockerfile',
      dockerBytes(
        [
          'FROM node:24',
          'RUN <<EOF',
          'echo hello',
          'EOF',
          'LABEL org.opencontainers.image.licenses="AGPL-3.0-only"',
          '',
        ].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: heredoc }).issues, 'apps/server/Dockerfile'), [
      'METADATA_DOCKER_SYNTAX_UNSUPPORTED',
    ]);

    const escape = validSnapshot();
    escape.set(
      'apps/server/Dockerfile',
      dockerBytes(
        ['# escape=`', 'FROM node:24', 'LABEL org.opencontainers.image.licenses="AGPL-3.0-only"', ''].join('\n'),
      ),
    );
    assert.deepEqual(codesFor(checkMetadata({ files: escape }).issues, 'apps/server/Dockerfile'), [
      'METADATA_DOCKER_SYNTAX_UNSUPPORTED',
    ]);
  });

  it('rejects malformed dockerfiles as invalid', () => {
    const cases = {
      empty: '',
      noFrom: 'RUN echo hello\n',
      labelBeforeFrom: 'LABEL org.opencontainers.image.licenses="MIT"\nFROM node:24\n',
      unterminatedQuote: 'FROM node:24\nLABEL org.opencontainers.image.licenses="MIT\n',
      legacyTriple: 'FROM node:24\nLABEL a b c\n',
      strayWord: 'FROM node:24\nLABEL org.opencontainers.image.licenses="MIT" stray\n',
      bareLabel: 'FROM node:24\nLABEL\n',
      bareFrom: 'FROM\nLABEL org.opencontainers.image.licenses="MIT"\n',
    };
    for (const [name, text] of Object.entries(cases)) {
      const map = validSnapshot();
      map.set('apps/web/Dockerfile', dockerBytes(text));
      assert.deepEqual(
        codesFor(checkMetadata({ files: map }).issues, 'apps/web/Dockerfile'),
        ['METADATA_DOCKER_INVALID'],
        name,
      );
    }
  });

  it('handles crlf and case-insensitive instructions', () => {
    const map = validSnapshot();
    map.set(
      'apps/web/Dockerfile',
      Buffer.from('from nginx:alpine\r\nlabel org.opencontainers.image.licenses="MIT"\r\n', 'utf8'),
    );
    assert.deepEqual(checkMetadata({ files: map }).issues, []);
  });
});
