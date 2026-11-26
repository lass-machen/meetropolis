// Deterministic argument parser for the license gate CLI contract.
//
// Parses a dense string array into a range or all mode with an optional
// commit and an optional JSON output path. The function is pure: it never
// touches the file system or the network, never prints, never exits the
// process and never modifies its input. Writing the JSON file belongs to
// a later writer step, not to this parser.

const ARGUMENTS_INVALID_CODE = 'COMPLIANCE_ARGUMENTS_INVALID';
const ARGUMENTS_INVALID_EXIT_CODE = 2;
const ARGUMENTS_INVALID_MESSAGE =
  'Invalid arguments. Usage: --range BASE..TARGET [--json PATH] or --all [--commit SHA] [--json PATH].';
const COMMIT_PATTERN = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

function failArguments() {
  const error = new Error(ARGUMENTS_INVALID_MESSAGE);
  error.code = ARGUMENTS_INVALID_CODE;
  error.exitCode = ARGUMENTS_INVALID_EXIT_CODE;
  throw error;
}

function isUsableValue(value) {
  if (value.length === 0 || value.trim().length === 0) return false;
  if (CONTROL_CHARACTERS.test(value)) return false;
  if (value.startsWith('-')) return false;
  return true;
}

function readValue(argv, index) {
  if (index >= argv.length) failArguments();
  const value = argv[index];
  if (!isUsableValue(value)) failArguments();
  return value;
}

function checkRange(value) {
  if (value.includes('...')) failArguments();
  const first = value.indexOf('..');
  if (first < 0 || value.lastIndexOf('..') !== first) failArguments();
  const left = value.slice(0, first);
  const right = value.slice(first + 2);
  if (left.length === 0 || right.length === 0) failArguments();
  if (/\s/.test(value)) failArguments();
}

function checkCommit(value) {
  if (!COMMIT_PATTERN.test(value)) failArguments();
}

// Parses argv into { mode, range, commit, jsonPath }. Every invalid input
// throws a constant COMPLIANCE_ARGUMENTS_INVALID error with exit code 2.
export function parseLicenseGateArgs(argv) {
  if (!Array.isArray(argv)) failArguments();
  for (let index = 0; index < argv.length; index += 1) {
    if (!(index in argv) || typeof argv[index] !== 'string') failArguments();
  }
  let range = null;
  let all = false;
  let commit = null;
  let jsonPath = null;
  let seenRange = false;
  let seenAll = false;
  let seenCommit = false;
  let seenJson = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--range') {
      if (seenRange) failArguments();
      seenRange = true;
      range = readValue(argv, index + 1);
      index += 1;
    } else if (token === '--all') {
      if (seenAll) failArguments();
      seenAll = true;
      all = true;
    } else if (token === '--commit') {
      if (seenCommit) failArguments();
      seenCommit = true;
      commit = readValue(argv, index + 1);
      index += 1;
    } else if (token === '--json') {
      if (seenJson) failArguments();
      seenJson = true;
      jsonPath = readValue(argv, index + 1);
      index += 1;
    } else {
      failArguments();
    }
  }
  if ((range !== null && all) || (range === null && !all)) failArguments();
  if (commit !== null && !all) failArguments();
  if (range !== null) checkRange(range);
  if (commit !== null) checkCommit(commit);
  if (range !== null) return { mode: 'range', range, commit: null, jsonPath };
  return { mode: 'all', range: null, commit, jsonPath };
}
