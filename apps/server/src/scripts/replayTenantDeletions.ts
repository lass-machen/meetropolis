import { pathToFileURL } from 'node:url';
import { getAdminEnterpriseModule } from '../adminLoader.js';
import { createPrismaClient } from '../db.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import { deleteAccount, deleteTenantWithMembers } from '../services/accountDeletion.js';
import {
  createAccountJournalPlanResolver,
  registerAccountDeletionJournal,
} from '../services/accountDeletionJournal.js';
import { assertTenantDeletionProtocol } from '../services/tenantDeletionContract.js';
import { createJournalPlanResolver } from '../services/tenantDeletionPlanning.js';
import type { ReplayDecision } from '../services/tenantDeletionReplay.js';
import { REPLAY_EXIT, runRestoreReplay, type OAuthRefreshRevocation } from '../services/tenantDeletionReplayRun.js';
import { getTranscriptionLoadState, getTranscriptionModule, type TranscriptionModule } from '../transcriptionLoader.js';

/**
 * Restore replay tool. Run by an operator after scripts/restore.sh while the
 * server is stopped:
 *
 *   node dist/scripts/replayTenantDeletions.js [--decide <key>=delete|keep]...
 *
 * Deletes tenants and accounts again that the deletion journal records as deleted after
 * the restored copy was taken, through the same managed deletion paths as
 * DELETE /admin/tenants/:id and the account deletion. Afterwards the token step drops
 * sessions and unused reset and verification tokens. Exit codes: see services/tenantDeletionReplayRun.ts.
 */

const USAGE = 'Usage: node dist/scripts/replayTenantDeletions.js [--decide <key>=delete|keep]...';

type AdminModule = NonNullable<Awaited<ReturnType<typeof getAdminEnterpriseModule>>>;

class ReplayDeleteRejectedError extends Error {
  constructor(readonly code: string) {
    super('managed tenant deletion rejected');
    this.name = 'ReplayDeleteRejectedError';
  }
}

/** Parses repeated `--decide <key>=delete|keep`; null for any other input. */
export function parseDecisions(args: readonly string[]): Map<string, ReplayDecision> | null {
  const decisions = new Map<string, ReplayDecision>();
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== '--decide') return null;
    const match = /^([A-Za-z0-9_-]{1,128})=(delete|keep)$/.exec(args[index + 1] ?? '');
    if (!match || decisions.has(match[1])) return null;
    decisions.set(match[1], match[2] === 'delete' ? 'delete' : 'keep');
  }
  return decisions;
}

function managedDeleter(
  prisma: PrismaClient,
  journalDir: string,
  admin: AdminModule | null,
): ((tenantId: string) => Promise<void>) | undefined {
  const deleteManagedTenant = admin?.deleteManagedTenant?.bind(admin);
  if (!deleteManagedTenant) return undefined;
  let resolver: ReturnType<typeof createJournalPlanResolver> | undefined;
  const config: Parameters<typeof deleteManagedTenant>[0] = {
    prisma,
    logger,
    deleteTenantWithMembers: (tenantId, options) => {
      assertTenantDeletionProtocol(options?.deletionProtocol);
      return deleteTenantWithMembers(prisma, tenantId, options);
    },
    // Own resolver with the restore pass: while the restore marker exists the
    // shared resolver refuses every deletion, only this tool may delete.
    resolveTenantDeletionPlan: async (tx, input) => {
      resolver ??= createJournalPlanResolver({
        prisma,
        journalDir,
        retentionDays: process.env.BACKUP_RETENTION_DAYS,
        allowDuringRestoreReplay: true,
      });
      return (await resolver)(tx, input);
    },
  };
  return async (tenantId) => {
    const result = await deleteManagedTenant(config, tenantId, { actor: 'restore-replay' });
    if (!result.ok && result.status !== 404) throw new ReplayDeleteRejectedError(result.error);
  };
}

/** The loaded transcription module with its OAuth refresh revocation present. */
type RevokingTranscriptionModule = TranscriptionModule & {
  revokeOAuthRefreshTokensAfterRestore: NonNullable<TranscriptionModule['revokeOAuthRefreshTokensAfterRestore']>;
};

/** Narrows the optional OAuth refresh revocation of a loaded module to a present one. */
function hasOAuthRevocation(transcription: TranscriptionModule): transcription is RevokingTranscriptionModule {
  return typeof transcription.revokeOAuthRefreshTokensAfterRestore === 'function';
}

/** OAuth refresh token revocation of the loaded transcription module, for the token step. */
async function oauthRevocation(prisma: PrismaClient): Promise<OAuthRefreshRevocation> {
  const transcription = await getTranscriptionModule();
  if (transcription === null) {
    // Only an absent package counts as not loaded; an installed but rejected module fails the token step.
    return getTranscriptionLoadState() === 'absent' ? { kind: 'module_not_loaded' } : { kind: 'module_rejected' };
  }
  if (!hasOAuthRevocation(transcription)) return { kind: 'export_missing' };
  // Called on the module, so that the module keeps its receiver.
  return { kind: 'available', revoke: (now) => transcription.revokeOAuthRefreshTokensAfterRestore(prisma, now) };
}

async function main(): Promise<void> {
  const decisions = parseDecisions(process.argv.slice(2));
  if (!decisions) {
    console.error(USAGE);
    process.exitCode = REPLAY_EXIT.invalid;
    return;
  }
  const journalDir = process.env.DELETION_JOURNAL_DIR?.trim() ?? '';
  if (journalDir === '') {
    console.error('restore replay: DELETION_JOURNAL_DIR is not set');
    process.exitCode = REPLAY_EXIT.invalid;
    return;
  }
  const prisma = createPrismaClient();
  try {
    registerAccountDeletionJournal(
      createAccountJournalPlanResolver({
        prisma,
        journalDir,
        retentionDays: process.env.BACKUP_RETENTION_DAYS,
        allowDuringRestoreReplay: true,
      }),
    );
    const admin = await getAdminEnterpriseModule();
    const result = await runRestoreReplay({
      prisma,
      journalDir,
      decisions,
      deleteTenant: managedDeleter(prisma, journalDir, admin),
      deleteAccount: (userId) => deleteAccount(prisma, userId),
      pendingPreconditions: () => Promise.resolve(admin?.pendingRestorePreconditions?.() ?? []),
      oauthRefreshRevocation: await oauthRevocation(prisma),
    });
    for (const line of result.lines) console.log(line);
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof Error ? error.name : 'unexpected';
    console.error(`restore replay: failed (${code})`);
    process.exitCode = REPLAY_EXIT.invalid;
  });
}
