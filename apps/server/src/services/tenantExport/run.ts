/**
 * Operator tenant export orchestration (OSS tables plus optional hooks).
 *
 * Runs the fixed OSS table specs first, then the tenant maps as TMJ
 * documents, then the tenant files, then every enterprise hook that is
 * present. Aborts before touching the output directory when the specs are
 * unsafe, an enterprise module is loaded without its export hook, or the
 * tenant slug is unknown.
 */
import type { PrismaClient } from '../../generated/prisma/index.js';
import { getAdminEnterpriseModule } from '../../adminLoader.js';
import { getTranscriptionModule } from '../../transcriptionLoader.js';
import { buildTmjDocument } from '../../api/routes/tmj.js';
import { collectTenantFiles } from './files.js';
import { getRowDelegate, pagedRows } from './rows.js';
import { TenantExportError, createExportSink, prepareExportDir, type ExportTotals } from './sink.js';
import { OSS_EXCLUDED_MODELS, OSS_EXPORT_SPECS } from './spec.js';
import { assertSpecsSafe } from './specCheck.js';
import type { EnterpriseExportResult, TenantExportSink } from './types.js';

/** Enterprise export hooks available to the tenant export. */
export interface EnterpriseExportHooks {
  adminLoaded: boolean;
  exportManagedTenant?: (
    config: { prisma: PrismaClient },
    tenantId: string,
    sink: TenantExportSink,
  ) => Promise<EnterpriseExportResult>;
  transcriptionLoaded: boolean;
  exportTenantTranscripts?: (
    config: { prisma: PrismaClient },
    tenantId: string,
    sink: TenantExportSink,
  ) => Promise<EnterpriseExportResult>;
}

/** Loads the enterprise export hooks through the optional module loaders. */
export async function loadEnterpriseExportHooks(): Promise<EnterpriseExportHooks> {
  const admin = await getAdminEnterpriseModule();
  const transcription = await getTranscriptionModule();
  const managedExport = admin?.exportManagedTenant;
  const transcriptExport = transcription?.exportTenantTranscripts;
  return {
    adminLoaded: admin !== null,
    exportManagedTenant:
      managedExport === undefined ? undefined : (config, tenantId, sink) => managedExport(config, tenantId, sink),
    transcriptionLoaded: transcription !== null,
    exportTenantTranscripts:
      transcriptExport === undefined ? undefined : (config, tenantId, sink) => transcriptExport(config, tenantId, sink),
  };
}

/**
 * Rejects a loaded enterprise module that misses its export hook. Older
 * enterprise builds cannot contribute their tables, so the export aborts
 * instead of writing a silently partial directory.
 */
export function assertEnterpriseHooks(hooks: EnterpriseExportHooks): void {
  if (hooks.adminLoaded && typeof hooks.exportManagedTenant !== 'function') {
    throw new TenantExportError('enterprise_export_unavailable');
  }
  if (hooks.transcriptionLoaded && typeof hooks.exportTenantTranscripts !== 'function') {
    throw new TenantExportError('enterprise_export_unavailable');
  }
}

interface ExportTenant {
  id: string;
  slug: string;
  name: string;
}

/** Reads the tenant by slug, or throws `tenant_not_found`. */
async function loadTenantBySlug(prisma: PrismaClient, slug: string): Promise<ExportTenant> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    throw new TenantExportError('tenant_not_found');
  }
  return tenant;
}

/** Exports every OSS table spec into the sink, one JSON file per table. */
async function exportSpecTables(
  prisma: PrismaClient,
  tenantId: string,
  sink: TenantExportSink,
  log: (line: string) => void,
): Promise<void> {
  for (const spec of OSS_EXPORT_SPECS) {
    const rows = await sink.writeJsonRows(spec.file, pagedRows(getRowDelegate(prisma, spec.delegate), spec, tenantId));
    sink.recordTable({ model: spec.model, file: spec.file, rows, omittedFields: Object.keys(spec.omitted) });
    log(`table ${spec.file} rows=${rows}`);
  }
  sink.recordExcluded(OSS_EXCLUDED_MODELS);
}

interface ExportMapEntry {
  id: string;
  name: string;
  file: string;
}

/** Exports every map of the tenant as a TMJ document. */
async function exportTenantMaps(
  prisma: PrismaClient,
  tenant: ExportTenant,
  sink: TenantExportSink,
): Promise<ExportMapEntry[]> {
  const maps = await prisma.map.findMany({ where: { tenantId: tenant.id }, select: { id: true, name: true } });
  const entries: ExportMapEntry[] = [];
  for (const map of maps) {
    const document = await buildTmjDocument(prisma, tenant.id, map.id, { includeZones: true, includeSpawn: true });
    if (!document) {
      continue;
    }
    const file = `maps/${map.id}.tmj`;
    await sink.writeText(file, JSON.stringify(document, null, 2));
    entries.push({ id: map.id, name: map.name, file });
  }
  return entries;
}

/** Runs every present enterprise hook; returns true when at least one ran. */
async function runEnterpriseHooks(
  prisma: PrismaClient,
  tenantId: string,
  sink: TenantExportSink,
  hooks: EnterpriseExportHooks,
): Promise<boolean> {
  let ran = false;
  if (hooks.exportManagedTenant) {
    await hooks.exportManagedTenant({ prisma }, tenantId, sink);
    ran = true;
  }
  if (hooks.exportTenantTranscripts) {
    await hooks.exportTenantTranscripts({ prisma }, tenantId, sink);
    ran = true;
  }
  return ran;
}

/** Input of `runTenantExport`. */
export interface RunTenantExportInput {
  prisma: PrismaClient;
  slug: string;
  outDir: string;
  hooks: EnterpriseExportHooks;
  log: (line: string) => void;
  now?: () => Date;
}

/**
 * Exports one tenant into `outDir` and returns the totals. Validates the
 * specs and hooks and resolves the tenant before creating the directory.
 */
export async function runTenantExport(input: RunTenantExportInput): Promise<ExportTotals> {
  assertSpecsSafe(OSS_EXPORT_SPECS);
  assertEnterpriseHooks(input.hooks);
  const tenant = await loadTenantBySlug(input.prisma, input.slug);
  await prepareExportDir(input.outDir);
  const created = createExportSink(input.outDir);
  const sink = created.sink;
  const clock = input.now ?? (() => new Date());
  await exportSpecTables(input.prisma, tenant.id, sink, input.log);
  const maps = await exportTenantMaps(input.prisma, tenant, sink);
  const { tilesetsNotFound } = await collectTenantFiles(input.prisma, tenant, sink);
  const enterprise = await runEnterpriseHooks(input.prisma, tenant.id, sink, input.hooks);
  const exportedAt = clock().toISOString();
  const totals = await created.finalize({ exportedAt, tenant, enterprise, maps, tilesetsNotFound });
  input.log(
    `tenant export: slug=${tenant.slug} tables=${totals.tables} rows=${totals.rows} ` +
      `files=${totals.files} missing=${totals.missing}`,
  );
  return totals;
}
