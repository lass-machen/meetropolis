import crypto from 'node:crypto';

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function bindingMatches(entry, record) {
  return (
    entry.name === record.name &&
    entry.version === record.version &&
    entry.integrity === record.integrity &&
    entry.rawLicense === record.rawLicense
  );
}

// Resolves the effective license for one lockfile entry.
// record: { lockfile, lockPath, name, version, integrity, rawLicense }.
// entries: evidence entries from compliance/dependency-evidence.json.
// files: Map of evidence path (relative to compliance/) to Buffer.
// Packages without a matching lockfile+lockPath entry pass through
// unchanged. A bound entry with a diverging version, SRI, or raw value,
// or with missing/defective evidence bytes, never reuses the mapping:
// the raw value is returned together with an issue.
export function resolveDependencyLicense(record, entries, files) {
  const rawLicense = record.rawLicense ?? null;
  const entry = entries.find(
    (e) => e.lockfile === record.lockfile && e.lockPath === record.lockPath,
  );
  if (entry === undefined) {
    return { license: rawLicense, evidenceId: null, issues: [] };
  }
  if (!bindingMatches(entry, record)) {
    return {
      license: rawLicense,
      evidenceId: null,
      issues: [
        {
          code: 'DEPENDENCY_EVIDENCE_MISMATCH',
          message: `evidence binding mismatch for ${record.lockfile}:${record.lockPath}`,
        },
      ],
    };
  }
  if (!Array.isArray(entry.files) || entry.files.length === 0) {
    return {
      license: rawLicense,
      evidenceId: null,
      issues: [
        {
          code: 'EVIDENCE_FILE_MISMATCH',
          message: `evidence file mismatch for ${record.lockfile}:${record.lockPath}: no evidence files bound`,
        },
      ],
    };
  }
  for (const file of entry.files) {
    const bytes = files.get(file.path);
    if (!Buffer.isBuffer(bytes) || sha256Hex(bytes) !== file.sha256) {
      return {
        license: rawLicense,
        evidenceId: null,
        issues: [
          {
            code: 'EVIDENCE_FILE_MISMATCH',
            message: `evidence file mismatch for ${record.lockfile}:${record.lockPath}:${file.path}`,
          },
        ],
      };
    }
  }
  return { license: entry.license, evidenceId: entry.id, issues: [] };
}
