// Bound license decisions for packages whose license needs a review.
//
// The policy lists license ids that need a decision of the user before a
// package under them may ship (reviewRequired). This module reads those
// decisions from compliance/license-reviews.json. Every approval binds
// exactly one record of the production graph: lockfile, consuming root, lock
// path, package name, version, SRI and the license value. There are no
// package, path or license wide exemptions: another package, another
// version, another root or another license value stays a review finding,
// and an approval that no longer matches a record is reported as stale.
//
// The module is pure: it reads only from the given snapshot map, never opens
// a file and neither writes nor prints anything.

import { fail, isNonEmptyString, isObject, parseJsonBytes } from './dependencies-policy.mjs';

const LICENSE_REVIEWS_PATH = 'compliance/license-reviews.json';
const SCHEMA_VERSION = 1;
const DOCUMENT_KEYS = ['approvals', 'description', 'schemaVersion'];
const APPROVAL_KEYS = [
  'approvedBy',
  'decidedOn',
  'id',
  'integrity',
  'license',
  'lockPath',
  'lockfile',
  'name',
  'reason',
  'root',
  'version',
];
const BOUND_FIELDS = ['lockfile', 'lockPath', 'name', 'version', 'integrity', 'license', 'reason'];
const DECISION_ID_PATTERN = /^LICENSE-DECISION-[0-9]{3}$/;
const DATE_PATTERN = /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;

function invalid(message) {
  fail('COMPLIANCE_DATA_INVALID', `invalid data: ${message}`);
}

function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function bindingKey(lockfile, root, lockPath) {
  return JSON.stringify([lockfile, root, lockPath]);
}

// One approval with a closed set of fields. The decision belongs to the
// user, so no other approver is accepted.
function readApproval(value) {
  if (!isObject(value) || !hasExactKeys(value, APPROVAL_KEYS)) {
    invalid('every license review approval needs exactly the documented fields');
  }
  if (typeof value.id !== 'string' || !DECISION_ID_PATTERN.test(value.id)) {
    invalid('a license review approval has an invalid id');
  }
  for (const field of BOUND_FIELDS) {
    if (!isNonEmptyString(value[field])) invalid(`a license review approval has an invalid ${field}`);
  }
  if (typeof value.root !== 'string') invalid('a license review approval has an invalid root');
  if (!value.lockPath.startsWith('node_modules/')) {
    invalid('a license review approval must bind an installed package');
  }
  if (value.approvedBy !== 'user') invalid('a license review approval needs the decision of the user');
  if (typeof value.decidedOn !== 'string' || !DATE_PATTERN.test(value.decidedOn)) {
    invalid('a license review approval needs the date of the decision');
  }
  return { ...value };
}

// Approvals of the committed register. A missing register means that no
// license decision exists, which keeps every review finding open.
export function readLicenseReviews(snapshot) {
  const bytes = snapshot.get(LICENSE_REVIEWS_PATH);
  if (bytes === undefined) return [];
  const document = parseJsonBytes(bytes, LICENSE_REVIEWS_PATH, 'COMPLIANCE_DATA_INVALID');
  if (!isObject(document) || !hasExactKeys(document, DOCUMENT_KEYS)) {
    invalid('the license review register needs exactly the documented fields');
  }
  if (document.schemaVersion !== SCHEMA_VERSION) invalid('unsupported license review schema version');
  if (!Array.isArray(document.approvals)) invalid('the license review register needs an approvals list');
  const approvals = [];
  const ids = new Set();
  const bindings = new Set();
  for (const value of document.approvals) {
    const approval = readApproval(value);
    const key = bindingKey(approval.lockfile, approval.root, approval.lockPath);
    if (ids.has(approval.id)) invalid('license review approval ids must be unique');
    if (bindings.has(key)) invalid('license review approvals must bind a lockfile, root and lock path once');
    ids.add(approval.id);
    bindings.add(key);
    approvals.push(approval);
  }
  return approvals;
}

// Tracks which approvals cover a review finding of the current pass.
export function createLicenseReviewLedger(approvals) {
  const pending = new Map(
    approvals.map((approval) => [bindingKey(approval.lockfile, approval.root, approval.lockPath), approval]),
  );
  const used = new Set();
  return {
    // context: { path, root, lockPath } of the finding; record: graph record.
    // Returns true only for an approval that matches the full binding.
    approves(context, record, license) {
      const key = bindingKey(context.path, context.root, context.lockPath);
      const approval = pending.get(key);
      if (approval === undefined) return false;
      const matches =
        approval.name === record.name &&
        approval.version === record.version &&
        approval.integrity === record.integrity &&
        approval.license === license;
      if (matches) used.add(key);
      return matches;
    },
    // Approvals without a matching review finding in this pass.
    staleIssues() {
      const issues = [];
      for (const [key, approval] of pending) {
        if (used.has(key)) continue;
        issues.push({
          severity: 'error',
          code: 'LICENSE_REVIEW_STALE',
          path: approval.lockfile,
          root: approval.root,
          lockPath: approval.lockPath,
        });
      }
      return issues;
    },
  };
}
