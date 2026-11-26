import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDependencyLicense } from './dependency-evidence.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPLIANCE_DIR = path.resolve(HERE, '..', '..', 'compliance');
const EVIDENCE_JSON = path.join(COMPLIANCE_DIR, 'dependency-evidence.json');

const loadEntries = () => JSON.parse(fs.readFileSync(EVIDENCE_JSON, 'utf8')).entries;

// Real evidence bytes from compliance/licenses, keyed by the relative path
// stored in dependency-evidence.json.
const loadFiles = (entries) => {
  const files = new Map();
  for (const entry of entries) {
    for (const file of entry.files) {
      const abs = path.join(COMPLIANCE_DIR, file.path);
      files.set(file.path, fs.readFileSync(abs));
    }
  }
  return files;
};

const recordOf = (entry) => ({
  lockfile: entry.lockfile,
  lockPath: entry.lockPath,
  name: entry.name,
  version: entry.version,
  integrity: entry.integrity,
  rawLicense: entry.rawLicense,
});

describe('resolveDependencyLicense', () => {
  it('maps all seven accepted primary evidences', () => {
    const entries = loadEntries();
    assert.equal(entries.length, 7);
    const files = loadFiles(entries);
    const expected = {
      '@better-fetch/fetch': 'MIT',
      '@colyseus/playground': 'MIT',
      'seq-queue': 'MIT',
      busboy: 'MIT',
      streamsearch: 'MIT',
      '@pm2/io': 'Apache-2.0',
      '@visx/vendor': 'MIT AND ISC',
    };
    for (const entry of entries) {
      const res = resolveDependencyLicense(recordOf(entry), entries, files);
      assert.deepEqual(res.issues, [], entry.lockPath);
      assert.equal(res.evidenceId, entry.id, entry.lockPath);
      assert.equal(res.license, expected[entry.name], entry.lockPath);
      assert.equal(res.license, entry.license, entry.lockPath);
    }
  });

  it('rejects a changed version without reusing the mapping', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    const entry = entries[0];
    const res = resolveDependencyLicense({ ...recordOf(entry), version: '9.9.9' }, entries, files);
    assert.equal(res.license, entry.rawLicense);
    assert.equal(res.evidenceId, null);
    assert.equal(res.issues.length, 1);
    assert.equal(res.issues[0].code, 'DEPENDENCY_EVIDENCE_MISMATCH');
  });

  it('rejects a changed SRI without reusing the mapping', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    const entry = entries[0];
    const res = resolveDependencyLicense(
      {
        ...recordOf(entry),
        integrity: 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      },
      entries,
      files,
    );
    assert.equal(res.license, entry.rawLicense);
    assert.equal(res.issues.length, 1);
    assert.equal(res.issues[0].code, 'DEPENDENCY_EVIDENCE_MISMATCH');
  });

  it('rejects a changed raw license value, including a future GPL field', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    // Entry with a missing raw field must not accept a later GPL field.
    const nullRaw = entries.find((e) => e.rawLicense === null);
    const gpl = resolveDependencyLicense({ ...recordOf(nullRaw), rawLicense: 'GPL-3.0-only' }, entries, files);
    assert.equal(gpl.license, 'GPL-3.0-only');
    assert.equal(gpl.evidenceId, null);
    assert.equal(gpl.issues[0].code, 'DEPENDENCY_EVIDENCE_MISMATCH');
    // Entry with an exact raw value must not accept null either.
    const exactRaw = entries.find((e) => e.rawLicense !== null);
    const nulled = resolveDependencyLicense({ ...recordOf(exactRaw), rawLicense: null }, entries, files);
    assert.equal(nulled.license, null);
    assert.equal(nulled.issues[0].code, 'DEPENDENCY_EVIDENCE_MISMATCH');
  });

  it('rejects changed license text bytes', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    const entry = entries[0];
    const tampered = new Map(files);
    const firstPath = entry.files[0].path;
    const buf = Buffer.from(tampered.get(firstPath));
    buf[buf.length - 1] ^= 0xff;
    tampered.set(firstPath, buf);
    const res = resolveDependencyLicense(recordOf(entry), entries, tampered);
    assert.equal(res.license, entry.rawLicense);
    assert.equal(res.evidenceId, null);
    assert.equal(res.issues.length, 1);
    assert.equal(res.issues[0].code, 'EVIDENCE_FILE_MISMATCH');
  });

  it('rejects missing evidence files', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    const entry = entries.find((e) => e.name === '@visx/vendor');
    const reduced = new Map(files);
    reduced.delete(entry.files[entry.files.length - 1].path);
    const res = resolveDependencyLicense(recordOf(entry), entries, reduced);
    assert.equal(res.license, entry.rawLicense);
    assert.equal(res.issues[0].code, 'EVIDENCE_FILE_MISMATCH');
  });

  it('rejects bound entries without evidence files', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    for (const variant of [[], undefined]) {
      const bound = [{ ...entries[0], files: variant }];
      const res = resolveDependencyLicense(recordOf(entries[0]), bound, files);
      assert.equal(res.license, entries[0].rawLicense);
      assert.equal(res.evidenceId, null);
      assert.equal(res.issues.length, 1);
      assert.equal(res.issues[0].code, 'EVIDENCE_FILE_MISMATCH');
    }
  });

  it('passes unaffected packages through unchanged', () => {
    const entries = loadEntries();
    const files = loadFiles(entries);
    for (const rawLicense of ['MIT', 'GPL-3.0-only', null]) {
      const res = resolveDependencyLicense(
        {
          lockfile: 'package-lock.json',
          lockPath: 'node_modules/left-pad',
          name: 'left-pad',
          version: '1.3.0',
          integrity: 'sha512-XI5MPzVNApjAyhQzphX8BkmKsKUxD4LdyK24iZe0BwHRzHM65qyshgg+cJqXBM/5sqpdhpDL5a5RNFWsWBciQ==',
          rawLicense,
        },
        entries,
        files,
      );
      assert.equal(res.license, rawLicense);
      assert.equal(res.evidenceId, null);
      assert.deepEqual(res.issues, []);
    }
  });
});
