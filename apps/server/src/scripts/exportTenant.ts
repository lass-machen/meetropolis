import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../db.js';
import { loadEnterpriseExportHooks, runTenantExport } from '../services/tenantExport/run.js';
import { TenantExportError } from '../services/tenantExport/sink.js';

/**
 * Operator tenant export. Run by an operator while the server is stopped:
 *
 *   node dist/scripts/exportTenant.js --tenant <slug> --out <dir>
 *
 * Writes one export directory per tenant (see services/tenantExport) and
 * reports only progress lines on stdout. Failures print a single stable
 * machine-readable code on stderr. Exit codes: 0 ok, 2 wrong invocation,
 * 3 unknown tenant, 4 output directory not empty, 1 anything else.
 */

const USAGE = 'Usage: node dist/scripts/exportTenant.js --tenant <slug> --out <dir>';

/** Parses `--tenant <slug> --out <dir>` in any order; either flag missing or invalid yields the usage error. */
export function parseExportArgs(argv: readonly string[]): { slug: string; outDir: string } | { error: string } {
  let slug: string | undefined;
  let outDir: string | undefined;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== '--tenant' && flag !== '--out') || value === undefined || value.length === 0) {
      return { error: USAGE };
    }
    if (flag === '--tenant') {
      if (slug !== undefined) return { error: USAGE };
      slug = value;
    } else {
      if (outDir !== undefined) return { error: USAGE };
      outDir = value;
    }
  }
  if (slug === undefined || outDir === undefined) {
    return { error: USAGE };
  }
  return { slug, outDir };
}

/** Maps an export failure to its process exit code. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof TenantExportError) {
    if (error.code === 'tenant_not_found') return 3;
    if (error.code === 'output_not_empty') return 4;
  }
  return 1;
}

/** Reduces an export failure to its stable code, never its message or environment values. */
function errorCodeOf(error: unknown): string {
  if (error instanceof TenantExportError) return error.code;
  return error instanceof Error ? error.name : 'unexpected';
}

async function main(): Promise<void> {
  const parsed = parseExportArgs(process.argv.slice(2));
  if ('error' in parsed) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const hadDir = existsSync(parsed.outDir);
  const prisma = createPrismaClient();
  try {
    const hooks = await loadEnterpriseExportHooks();
    await runTenantExport({
      prisma,
      slug: parsed.slug,
      outDir: parsed.outDir,
      hooks,
      log: (line) => console.log(line),
    });
  } catch (error: unknown) {
    console.error(`tenant export: failed (${errorCodeOf(error)})`);
    if (!hadDir && existsSync(parsed.outDir)) {
      console.error(`tenant export: incomplete output left in ${parsed.outDir}`);
    }
    process.exitCode = exitCodeFor(error);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(`tenant export: failed (${errorCodeOf(error)})`);
    process.exitCode = exitCodeFor(error);
  });
}
