import crypto from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npcServiceStatus } from './npcServiceClient.js';

const SECRET_KEY = 'NPC_SERVICE_SECRET';
const URL_KEY = 'NPC_SERVICE_URL';
const SECRET_HEADER = 'x-npc-secret';
const CONFIG_ERROR = 'NPC service is not configured: NPC_SERVICE_SECRET is missing or invalid';

let server: http.Server;
let requestCount = 0;
let receivedSecrets: string[] = [];
let previousSecret: string | undefined;
let previousUrl: string | undefined;

function readKnownDefaultSecret(): string {
  const source = readFileSync(fileURLToPath(new URL('../../../../npc-service/src/config.ts', import.meta.url)), 'utf8');
  const named = source.match(/KNOWN_DEFAULT_SECRET\s*=\s*'([^']+)'/);
  if (named?.[1]) return named[1];
  const fallback = source.match(/NPC_SERVICE_SECRET[^\n]*\|\|\s*'([^']+)'/);
  if (fallback?.[1]) return fallback[1];
  throw new Error('NPC service config does not declare a documented secret placeholder');
}

function startServer(): Promise<string> {
  server = http.createServer((req, res) => {
    requestCount += 1;
    const secret = req.headers[SECRET_HEADER];
    receivedSecrets.push(typeof secret === 'string' ? secret : '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('listening server has no port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

beforeEach(async () => {
  previousSecret = process.env[SECRET_KEY];
  previousUrl = process.env[URL_KEY];
  requestCount = 0;
  receivedSecrets = [];
  delete process.env[SECRET_KEY];
  process.env[URL_KEY] = await startServer();
});

afterEach(async () => {
  if (previousSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = previousSecret;
  if (previousUrl === undefined) delete process.env[URL_KEY];
  else process.env[URL_KEY] = previousUrl;
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

describe('npc service client', () => {
  it('does not call the npc service when the secret is missing', async () => {
    await expect(npcServiceStatus()).rejects.toThrow(CONFIG_ERROR);
    expect(requestCount).toBe(0);
  });

  it('does not call the npc service with the known default secret', async () => {
    process.env[SECRET_KEY] = readKnownDefaultSecret();
    await expect(npcServiceStatus()).rejects.toThrow(CONFIG_ERROR);
    expect(requestCount).toBe(0);
  });

  it('sends the configured secret once when it is valid', async () => {
    const secret = crypto.randomBytes(16).toString('hex');
    process.env[SECRET_KEY] = secret;
    await expect(npcServiceStatus()).resolves.toEqual({});
    expect(requestCount).toBe(1);
    expect(receivedSecrets).toEqual([secret]);
  });
});
