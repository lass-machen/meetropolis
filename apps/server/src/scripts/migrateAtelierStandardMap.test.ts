import { describe, expect, it } from 'vitest';
import { ATELIER_STANDARD_MAP_NAME, parseMigrationOptions, planTenantMigration } from './migrateAtelierStandardMap.js';

describe('parseMigrationOptions', () => {
  it('defaults to dry-run for all tenants', () => {
    expect(parseMigrationOptions(['--all'])).toEqual({ apply: false, all: true });
  });

  it('accepts one tenant and explicit apply', () => {
    expect(parseMigrationOptions(['--tenant', 'acme', '--apply'])).toEqual({
      apply: true,
      all: false,
      tenant: 'acme',
    });
  });

  it('requires exactly one scope', () => {
    expect(() => parseMigrationOptions([])).toThrow('Choose exactly one scope');
    expect(() => parseMigrationOptions(['--all', '--tenant', 'acme'])).toThrow('Choose exactly one scope');
  });
});

describe('planTenantMigration', () => {
  it('copies a missing map and switches the entry map', () => {
    expect(planTenantMigration(false, 'office')).toEqual({ copyMap: true, setDefault: true });
  });

  it('does not overwrite an existing map', () => {
    expect(planTenantMigration(true, 'office')).toEqual({ copyMap: false, setDefault: true });
  });

  it('is a no-op after a completed run', () => {
    expect(planTenantMigration(true, ATELIER_STANDARD_MAP_NAME)).toEqual({ copyMap: false, setDefault: false });
  });
});
