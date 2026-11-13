import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { runScenario } from './scenario.js';
import { parseAccounts, redactSecrets, type LoadtestAccount } from './workers/session.js';

async function main(): Promise<void> {
  const modeRaw = process.env.MODE || 'node';
  const mode: 'node' | 'browser' = modeRaw === 'browser' ? 'browser' : 'node';
  const users = Number(process.env.USERS || 20);
  const rampPerSec = Number(process.env.RAMP || 5);
  const apiBase = process.env.API_BASE || (existsSync('/.dockerenv') ? 'http://server:2567' : 'http://localhost:2567');
  const room = process.env.ROOM || 'world';
  const durationSec = Number(process.env.DURATION || 60);
  const tenant = requireEnv('LOADTEST_TENANT');
  const accounts = loadAccounts();
  await runScenario({ mode, users, rampPerSec, apiBase, room, durationSec, tenant, accounts });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loadAccounts(): LoadtestAccount[] {
  const path = requireEnv('LOADTEST_ACCOUNTS_FILE');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error('LOADTEST_ACCOUNTS_FILE could not be read');
  }
  return parseAccounts(raw);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error('Loadtest failed:', redactSecrets(message));
  process.exit(1);
});
