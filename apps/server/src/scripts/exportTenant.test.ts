import { describe, expect, it } from 'vitest';
import { TenantExportError } from '../services/tenantExport/sink.js';
import { exitCodeFor, parseExportArgs } from './exportTenant.js';

describe('parseExportArgs', () => {
  it('parses tenant and out in order', () => {
    expect(parseExportArgs(['--tenant', 'acme', '--out', '/tmp/acme'])).toEqual({
      slug: 'acme',
      outDir: '/tmp/acme',
    });
  });

  it('parses tenant and out in any order', () => {
    expect(parseExportArgs(['--out', '/tmp/acme', '--tenant', 'acme'])).toEqual({
      slug: 'acme',
      outDir: '/tmp/acme',
    });
  });

  it('rejects a missing flag, a missing value and duplicates', () => {
    expect(parseExportArgs(['--tenant', 'acme'])).toHaveProperty('error');
    expect(parseExportArgs(['--out', '/tmp/acme'])).toHaveProperty('error');
    expect(parseExportArgs([])).toHaveProperty('error');
    expect(parseExportArgs(['--tenant', 'acme', '--out'])).toHaveProperty('error');
    expect(parseExportArgs(['--tenant', 'a', '--tenant', 'b', '--out', '/tmp/x'])).toHaveProperty('error');
    expect(parseExportArgs(['--unknown', 'x', '--tenant', 'a', '--out', '/tmp/x'])).toHaveProperty('error');
  });
});

describe('exitCodeFor', () => {
  it('maps tenant_not_found to 3 and output_not_empty to 4', () => {
    expect(exitCodeFor(new TenantExportError('tenant_not_found'))).toBe(3);
    expect(exitCodeFor(new TenantExportError('output_not_empty'))).toBe(4);
  });

  it('maps every other failure to 1', () => {
    expect(exitCodeFor(new TenantExportError('enterprise_export_unavailable'))).toBe(1);
    expect(exitCodeFor(new Error('boom'))).toBe(1);
    expect(exitCodeFor('boom')).toBe(1);
    expect(exitCodeFor(null)).toBe(1);
  });
});
