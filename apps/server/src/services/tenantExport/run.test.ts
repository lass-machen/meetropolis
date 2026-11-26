import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { TenantExportError } from './sink.js';
import { assertEnterpriseHooks, runTenantExport, type EnterpriseExportHooks } from './run.js';

let tmpBase = '';

async function makeTmpBase(): Promise<string> {
  tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), 'tenant-export-run-'));
  return tmpBase;
}

afterEach(async () => {
  if (tmpBase.length > 0) {
    await fsp.rm(tmpBase, { recursive: true, force: true });
    tmpBase = '';
  }
});

function hooksWithoutModules(): EnterpriseExportHooks {
  return { adminLoaded: false, transcriptionLoaded: false };
}

function unknownTenantPrisma(): PrismaClient {
  return {
    tenant: { findUnique: () => Promise.resolve(null) },
  } as unknown as PrismaClient;
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TenantExportError);
    return (error as TenantExportError).code;
  }
  throw new Error('expected TenantExportError');
}

describe('assertEnterpriseHooks', () => {
  it('accepts unloaded modules without hooks', () => {
    expect(() => assertEnterpriseHooks(hooksWithoutModules())).not.toThrow();
  });

  it('accepts loaded modules with their hooks', () => {
    const hooks: EnterpriseExportHooks = {
      adminLoaded: true,
      exportManagedTenant: () => Promise.resolve({ tables: 0, rows: 0 }),
      transcriptionLoaded: true,
      exportTenantTranscripts: () => Promise.resolve({ tables: 0, rows: 0 }),
    };
    expect(() => assertEnterpriseHooks(hooks)).not.toThrow();
  });

  it('rejects a loaded admin module without its hook', () => {
    const hooks: EnterpriseExportHooks = { adminLoaded: true, transcriptionLoaded: false };
    expect(() => assertEnterpriseHooks(hooks)).toThrow(TenantExportError);
    expect(() => assertEnterpriseHooks(hooks)).toThrowError('enterprise_export_unavailable');
  });

  it('rejects a loaded transcription module without its hook', () => {
    const hooks: EnterpriseExportHooks = { adminLoaded: false, transcriptionLoaded: true };
    expect(() => assertEnterpriseHooks(hooks)).toThrow(TenantExportError);
    expect(() => assertEnterpriseHooks(hooks)).toThrowError('enterprise_export_unavailable');
  });
});

describe('runTenantExport', () => {
  it('throws tenant_not_found without creating the output directory', async () => {
    const outDir = path.join(await makeTmpBase(), 'out');
    const code = await codeOf(
      runTenantExport({
        prisma: unknownTenantPrisma(),
        slug: 'ghost',
        outDir,
        hooks: hooksWithoutModules(),
        log: () => {},
      }),
    );
    expect(code).toBe('tenant_not_found');
    expect(existsSync(outDir)).toBe(false);
  });

  it('aborts before creating the directory when a hook is missing', async () => {
    const outDir = path.join(await makeTmpBase(), 'out');
    const code = await codeOf(
      runTenantExport({
        prisma: unknownTenantPrisma(),
        slug: 'ghost',
        outDir,
        hooks: { adminLoaded: true, transcriptionLoaded: false },
        log: () => {},
      }),
    );
    expect(code).toBe('enterprise_export_unavailable');
    expect(existsSync(outDir)).toBe(false);
  });
});
