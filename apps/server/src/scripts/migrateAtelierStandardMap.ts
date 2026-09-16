import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/index.js';
import { copyMapToTenant } from '../api/routes/adminMaps.copy.js';
import { ATELIER_STANDARD_MAP_NAME } from '../services/atelierStandardMap.js';
import { resolveTemplateTenantSlug } from '../services/templateTenant.js';

export { ATELIER_STANDARD_MAP_NAME };

export interface MigrationOptions {
  apply: boolean;
  all: boolean;
  tenant?: string;
}

export interface TenantMigrationPlan {
  copyMap: boolean;
  setDefault: boolean;
}

interface TenantTarget {
  id: string;
  slug: string;
  defaultMapName: string | null;
}

export function parseMigrationOptions(args: string[]): MigrationOptions {
  let apply = false;
  let all = false;
  let tenant: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--all') all = true;
    else if (arg === '--tenant') {
      tenant = args[++index];
      if (!tenant) throw new Error('--tenant requires a tenant slug or id.');
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('usage');
    } else {
      throw new Error(`Unknown option '${arg}'.`);
    }
  }
  if (all === Boolean(tenant)) throw new Error('Choose exactly one scope: --all or --tenant <slug-or-id>.');
  return { apply, all, ...(tenant ? { tenant } : {}) };
}

export function planTenantMigration(hasMap: boolean, defaultMapName: string | null): TenantMigrationPlan {
  return {
    copyMap: !hasMap,
    setDefault: defaultMapName !== ATELIER_STANDARD_MAP_NAME,
  };
}

function usage(): string {
  return [
    'Usage:',
    '  npm -w @meetropolis/server run map:atelier:migrate -- --all [--apply]',
    '  npm -w @meetropolis/server run map:atelier:migrate -- --tenant <slug-or-id> [--apply]',
    '',
    'Without --apply the command performs a dry run. Existing maps are never overwritten or deleted.',
  ].join('\n');
}

async function loadTargets(prisma: PrismaClient, options: MigrationOptions): Promise<TenantTarget[]> {
  if (options.all) {
    return prisma.tenant.findMany({
      select: { id: true, slug: true, defaultMapName: true },
      orderBy: { slug: 'asc' },
    });
  }
  const selector = options.tenant;
  if (!selector) return [];
  const tenant = await prisma.tenant.findFirst({
    where: { OR: [{ id: selector }, { slug: selector }] },
    select: { id: true, slug: true, defaultMapName: true },
  });
  if (!tenant) throw new Error(`Tenant '${selector}' was not found.`);
  return [tenant];
}

function describePlan(plan: TenantMigrationPlan): string {
  const actions: string[] = [];
  if (plan.copyMap) actions.push(`copy '${ATELIER_STANDARD_MAP_NAME}'`);
  if (plan.setDefault) actions.push(`set default to '${ATELIER_STANDARD_MAP_NAME}'`);
  return actions.length > 0 ? actions.join(', ') : 'already current';
}

export async function migrateAtelierStandardMap(prisma: PrismaClient, options: MigrationOptions): Promise<void> {
  const templateSlug = resolveTemplateTenantSlug();
  const template = await prisma.tenant.findUnique({ where: { slug: templateSlug }, select: { id: true } });
  if (!template) throw new Error(`Template tenant '${templateSlug}' was not found. Run the seed first.`);
  const sourceMap = await prisma.map.findUnique({
    where: { tenantId_name: { tenantId: template.id, name: ATELIER_STANDARD_MAP_NAME } },
    select: { id: true },
  });
  if (!sourceMap) throw new Error(`Template map '${ATELIER_STANDARD_MAP_NAME}' was not found. Run the seed first.`);

  const targets = await loadTargets(prisma, options);
  let copied = 0;
  let switched = 0;
  let unchanged = 0;
  for (const tenant of targets) {
    const existing = await prisma.map.findUnique({
      where: { tenantId_name: { tenantId: tenant.id, name: ATELIER_STANDARD_MAP_NAME } },
      select: { id: true },
    });
    const plan = planTenantMigration(Boolean(existing), tenant.defaultMapName);
    console.log(`[${options.apply ? 'APPLY' : 'DRY-RUN'}] ${tenant.slug}: ${describePlan(plan)}`);
    if (!plan.copyMap && !plan.setDefault) {
      unchanged++;
      continue;
    }
    if (plan.copyMap) copied++;
    if (plan.setDefault) switched++;
    if (!options.apply) continue;

    if (plan.copyMap) {
      const copiedMap = await copyMapToTenant(prisma, sourceMap.id, tenant.id, ATELIER_STANDARD_MAP_NAME);
      if (copiedMap.name !== ATELIER_STANDARD_MAP_NAME) {
        throw new Error(`Tenant '${tenant.slug}' received unexpected map name '${copiedMap.name}'.`);
      }
    }
    if (plan.setDefault) {
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { defaultMapName: ATELIER_STANDARD_MAP_NAME },
      });
    }
  }
  console.log(
    `[SUMMARY] mode=${options.apply ? 'apply' : 'dry-run'} tenants=${targets.length} maps=${copied} defaults=${switched} unchanged=${unchanged}`,
  );
}

async function main(): Promise<void> {
  let options: MigrationOptions;
  try {
    options = parseMigrationOptions(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error && error.message !== 'usage' ? error.message : usage());
    if (error instanceof Error && error.message !== 'usage') console.error(usage());
    process.exitCode = error instanceof Error && error.message === 'usage' ? 0 : 2;
    return;
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  try {
    await migrateAtelierStandardMap(prisma, options);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
