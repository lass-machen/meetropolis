import { readFile } from 'node:fs/promises';

import { expect } from '@playwright/test';

import type { FreshTenant, Role, SeedData, TenantSeed, TestUser } from '../support/api';
import type { Page } from '@playwright/test';

export const TESTSTACK_ENV_MESSAGE =
  'Teststack-Env fehlt: /Users/ricoroder/Cursor/meetropolis-deploy/scripts/teststack.sh up';

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(TESTSTACK_ENV_MESSAGE);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: ungültige Seed-JSON-Struktur.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, name: string, label: string): string {
  const value = record[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}: Feld ${name} fehlt.`);
  return value;
}

function readOptionalString(record: Record<string, unknown>, name: string, label: string): string | undefined {
  const value = record[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label}: Feld ${name} ist ungültig.`);
  return value;
}

function parseRole(value: unknown, label: string): Role {
  if (value === 'owner' || value === 'admin' || value === 'member' || value === 'guest' || value === 'operator') {
    return value;
  }
  throw new Error(`${label}: ungültige Rolle.`);
}

function parseUser(value: unknown, label: string): TestUser {
  const record = asRecord(value, label);
  const password = readOptionalString(record, 'password', label);
  const guestUrl = readOptionalString(record, 'guestUrl', label);
  return {
    userId: readString(record, 'userId', label),
    email: readString(record, 'email', label),
    displayName: readString(record, 'displayName', label),
    role: parseRole(record.role, label),
    tenantSlug: readString(record, 'tenantSlug', label),
    ...(password ? { password } : {}),
    ...(guestUrl ? { guestUrl } : {}),
  };
}

function parseTenant(value: unknown, label: string): TenantSeed {
  const record = asRecord(value, label);
  const rawUsers = asRecord(record.users, `${label}.users`);
  const users: Partial<Record<Role, TestUser>> = {};
  for (const [key, user] of Object.entries(rawUsers)) {
    const role = parseRole(key, `${label}.users`);
    users[role] = parseUser(user, `${label}.users.${role}`);
  }
  return {
    tenantId: readString(record, 'tenantId', label),
    slug: readString(record, 'slug', label),
    roomId: readString(record, 'roomId', label),
    mapId: readString(record, 'mapId', label),
    users,
  };
}

export async function readSeedFile(path: string): Promise<SeedData> {
  const content = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Seed-Datei ist kein gültiges JSON: ${path}`);
  }
  const record = asRecord(parsed, 'Seed-Datei');
  if (record.edition !== 'ee' && record.edition !== 'oss')
    throw new Error('Seed-Datei: edition muss ee oder oss sein.');
  const rawTenants = asRecord(record.tenants, 'Seed-Datei.tenants');
  const tenants: Record<string, TenantSeed> = {};
  for (const [slug, tenant] of Object.entries(rawTenants)) tenants[slug] = parseTenant(tenant, `tenants.${slug}`);
  return { edition: record.edition, operator: parseUser(record.operator, 'operator'), tenants };
}

export function appRouteUrl(baseUrl: string, route: 'app' | 'login'): string {
  const url = new URL(baseUrl);
  url.hash = `/${route}`;
  return url.toString();
}

function escapedRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function waitForParticipant(page: Page, user: TestUser): Promise<void> {
  await expect(
    page.getByRole('complementary').getByRole('button', { name: new RegExp(escapedRegex(user.displayName), 'i') }),
  ).toBeVisible({ timeout: 60_000 });
}

export function getSeedTenant(seed: SeedData): TenantSeed {
  const tenant = seed.tenants.acme ?? seed.tenants.default ?? Object.values(seed.tenants)[0];
  if (!tenant) throw new Error('Seed-Datei enthält keinen Mandanten.');
  return tenant;
}

export function pickUsers(tenant: TenantSeed | FreshTenant, n: number, roles?: Role[]): TestUser[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('roomUsers erwartet mindestens einen Nutzer.');
  const selectedRoles = roles ?? Array.from({ length: n }, (_value, index) => (index === 0 ? 'owner' : 'member'));
  if (selectedRoles.length !== n) throw new Error('roomUsers benötigt genau eine Rolle je Nutzer.');
  return selectedRoles.map((role) => {
    const user = role === 'operator' ? undefined : tenant.users[role];
    if (!user) throw new Error(`Mandant ${tenant.slug} enthält keinen Nutzer mit Rolle ${role}.`);
    return user;
  });
}

export function passwordFor(user: TestUser): string {
  if (!user.password) throw new Error(`${user.role} ${user.email} hat kein Passwort und muss den Gastweg nutzen.`);
  return user.password;
}
