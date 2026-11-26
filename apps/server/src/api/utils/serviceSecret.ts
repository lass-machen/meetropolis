import crypto from 'crypto';
import type { IncomingMessage } from 'node:http';
import { logger } from '../../logger.js';

// Comparison constant only: this value never passes validation.
const KNOWN_DEFAULT_SECRET = 'dev-npc-secret';

const MIN_SECRET_LENGTH = 32;

const warnedKeys = new Set<string>();

function isUsableSecret(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= MIN_SECRET_LENGTH &&
    value.trim().length > 0 &&
    value !== KNOWN_DEFAULT_SECRET
  );
}

function warnInvalidOnce(envKey: string): void {
  if (warnedKeys.has(envKey)) return;
  warnedKeys.add(envKey);
  logger.warn({ event: 'service_secret.invalid', key: envKey });
}

export function usableServiceSecret(envKey: string): string | null {
  const raw = process.env[envKey];
  if (raw === undefined) return null;
  if (isUsableSecret(raw)) return raw;
  warnInvalidOnce(envKey);
  return null;
}

function headerValueOnce(req: IncomingMessage, headerName: string): string | null {
  const distinct = req.headersDistinct?.[headerName];
  const raw = req.headers[headerName];
  if (!Array.isArray(distinct) || distinct.length !== 1 || typeof raw !== 'string') {
    return null;
  }
  return raw;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

/** True when the header is present once and matches a usable configured secret. */
export function requestMatchesServiceSecret(req: IncomingMessage, envKey: string, headerName: string): boolean {
  const expected = usableServiceSecret(envKey);
  if (expected === null) return false;
  const provided = headerValueOnce(req, headerName);
  if (provided === null) return false;
  return timingSafeEqualStrings(provided, expected);
}
