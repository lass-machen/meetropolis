import type express from 'express';
import { logger } from '../../logger.js';

interface PublicWebBaseOptions {
  publicBaseUrl?: string | undefined;
  allowLoopback: boolean;
}

function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0' || hostname === '[::1]') {
    return true;
  }

  const octets = hostname.split('.');
  return octets.length === 4 && octets[0] === '127' && octets.every((octet) => /^\d+$/.test(octet));
}

export function publicBaseUrlProblem({
  publicBaseUrl,
  allowLoopback,
}: PublicWebBaseOptions): 'missing' | 'invalid' | 'native' | 'loopback' | null {
  const value = publicBaseUrl?.trim();
  if (!value) return 'missing';

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'invalid';
  }

  if (parsed.protocol === 'tauri:') return 'native';

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'tauri.localhost' || hostname.endsWith('.tauri.localhost')) return 'native';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'invalid';
  if (/[?#]/.test(value)) return 'invalid';
  if (!allowLoopback && isLoopbackHost(hostname)) return 'loopback';

  return null;
}

export function resolvePublicWebBase({ publicBaseUrl, allowLoopback }: PublicWebBaseOptions): string | null {
  if (publicBaseUrlProblem({ publicBaseUrl, allowLoopback }) !== null) return null;

  return publicBaseUrl?.trim().replace(/\/+$/, '') ?? null;
}

export function buildPublicWebLink(base: string, route: string): string {
  return `${base}/#/${route}`;
}

export function publicWebBase(): string | null {
  return resolvePublicWebBase({
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    allowLoopback: process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK === 'true',
  });
}

export function warnIfPublicBaseUrlUnusable(): void {
  const problem = publicBaseUrlProblem({
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    allowLoopback: process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK === 'true',
  });
  if (problem) logger.warn({ event: 'links.public_base_url_unusable', problem });
}

export function requirePublicWebBase(res: express.Response, route: string): string | null {
  const base = publicWebBase();
  if (base) return base;

  logger.error({ event: 'links.public_base_url_missing', route });
  res.status(500).json({ error: 'public_base_url_missing' });
  return null;
}
