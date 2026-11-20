// Contract for the current OSS template. Fixture values remain in memory;
// assertion diagnostics contain only booleans, keys and counts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEnvExamples } from './env-examples.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLE = '.env.example';
const POLICY = 'compliance/policy.json';
const VALUE_NOT_EMPTY = 'ENV_EXAMPLE_VALUE_NOT_EMPTY';
const TARGETS = [
  {
    key: 'NODE_ENV',
    mode: 'commented',
    instruction: '# Configure a runtime mode locally only when needed.',
  },
  {
    key: 'HOST_IP',
    mode: 'commented',
    instruction: '# Configure the host address locally if needed.',
  },
  {
    key: 'VITE_APP_TITLE',
    mode: 'commented',
    instruction: '# Set the browser page title locally if desired.',
  },
  {
    key: 'VITE_DEBUG_AUTOLOGIN_EMAIL',
    mode: 'commented',
    instruction: '# Configure a local development test account before enabling autologin.',
  },
  {
    key: 'VITE_DEBUG_AUTOLOGIN_PASSWORD',
    mode: 'commented',
    instruction: '# Set the local development test account password before enabling autologin.',
  },
  {
    key: 'DEFAULT_TENANT_SLUG',
    mode: 'commented',
    instruction: '# Set a default tenant slug locally only when overriding the built-in fallback.',
  },
  {
    key: 'TEMPLATE_TENANT_SLUG',
    mode: 'commented',
    instruction: '# Set a template tenant slug locally only when overriding the built-in fallback.',
  },
  {
    key: 'SPRITE_CATALOG_PATH',
    mode: 'commented',
    instruction: '# Set a catalog path locally only to override the packaged catalog.',
  },
  {
    key: 'BILLING_PUBLIC_URL',
    mode: 'commented',
    instruction: '# Configure a public billing base address locally when enabling billing links.',
  },
  {
    key: 'MAIL_BRAND_NAME',
    mode: 'commented',
    instruction: '# Set the email brand label locally if desired.',
  },
  {
    key: 'RESEND_FROM',
    mode: 'commented',
    instruction: '# Configure a verified sender locally before enabling this email provider.',
  },
  {
    key: 'BRAND_NAME',
    mode: 'commented',
    instruction: '# Set the optional brand label locally if desired.',
  },
  {
    key: 'BRAND_DESCRIPTION_DE',
    mode: 'commented',
    instruction: '# Set the optional German brand description locally if desired.',
  },
  {
    key: 'SUPPORT_EMAIL',
    mode: 'commented',
    instruction: '# Configure an optional public support contact locally.',
  },
  {
    key: 'NPC_SERVICE_SECRET',
    mode: 'active',
    instruction: '# Set a local service credential before enabling NPC integration.',
  },
  {
    key: 'SEED_ADMIN_EMAIL',
    mode: 'active',
    instruction: '# Set a local seed administrator email before running the seed step.',
  },
  {
    key: 'SEED_ADMIN_PASSWORD',
    mode: 'active',
    instruction: '# Set a local seed administrator password before running the seed step.',
  },
  {
    key: 'SEED_ADMIN_NAME',
    mode: 'active',
    instruction: '# Set an optional local seed administrator display label.',
  },
];

function readFixture(name) {
  try {
    const filename = path.join(ROOT, name);
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
    return fs.readFileSync(filename);
  } catch {
    throw new Error('ENV_EXAMPLE_FIXTURE_INVALID');
  }
}

function splitLines(bytes) {
  const result = [];
  let start = 0;
  let end = bytes.indexOf(10, start);
  while (end !== -1) {
    result.push(bytes.subarray(start, end + 1));
    start = end + 1;
    end = bytes.indexOf(10, start);
  }
  if (start < bytes.length) result.push(bytes.subarray(start));
  return result;
}

function body(line) {
  let end = line.length;
  if (end > 0 && line[end - 1] === 10) {
    end -= 1;
    if (end > 0 && line[end - 1] === 13) end -= 1;
  }
  return line.subarray(0, end).toString('utf8');
}

function assignment(line) {
  let text = body(line).trimStart();
  let mode = 'active';
  if (text.startsWith('#')) {
    mode = 'commented';
    text = text.slice(1).trimStart();
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(text);
  return match === null ? null : { key: match[1], mode, value: match[2] };
}

function matching(lines, key, mode) {
  const matches = [];
  lines.forEach((line, index) => {
    const found = assignment(line);
    if (found !== null && found.key === key && found.mode === mode) {
      matches.push({ ...found, index });
    }
  });
  return matches;
}

const candidate = readFixture(EXAMPLE);
const policy = readFixture(POLICY);
const candidateLines = splitLines(candidate);
const checked = checkEnvExamples({
  files: new Map([
    [POLICY, policy],
    [EXAMPLE, candidate],
  ]),
});

function empty(key, mode) {
  const matches = matching(candidateLines, key, mode);
  return matches.length === 1 && matches[0].value === '';
}

describe('current env example: empty documented assignments', () => {
  for (const target of TARGETS) {
    it(`keeps ${target.mode} ${target.key} empty`, () => {
      assert.equal(empty(target.key, target.mode), true, VALUE_NOT_EMPTY);
      const entry = matching(candidateLines, target.key, target.mode)[0];
      assert.equal(
        entry.index > 0 && body(candidateLines[entry.index - 1]) === target.instruction,
        true,
        'ENV_EXAMPLE_INSTRUCTION_MISSING',
      );
      assert.equal(
        checked.issues.some(
          (issue) =>
            issue.path === EXAMPLE &&
            issue.severity === 'error' &&
            (issue.line === entry.index || issue.line === entry.index + 1),
        ),
        false,
        'ENV_EXAMPLE_REVIEW_REMAINS',
      );
    });
  }
});
