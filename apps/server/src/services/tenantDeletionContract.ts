import type { Prisma } from '../generated/prisma/index.js';

/**
 * Version token for the tenant deletion contract between host and callback.
 *
 * The OSS host checks the token before it calls the enterprise preparation,
 * and the enterprise callback checks the passed context before its first
 * DELETE; any other value (including `undefined`) aborts the deletion
 * with `TenantDeletionContractError`. Bare OSS calls without enterprise options
 * are exempt and keep the previous behavior.
 */
export const TENANT_DELETION_PROTOCOL = 'tenant-delete-v2' as const;

/** A single internal deletion task with a stable object identity. */
export interface TenantDeletionTaskPlan {
  kind: string;
  targetSystem: string;
  objectId: string;
  objectGeneration: string;
  storageKey?: string;
}

/** Internal plan input; `journalUntil` is checked as a real date at runtime. */
export interface TenantDeletionPlanInput {
  idempotencyKey: string;
  policyVersion: string;
  journalUntil: unknown;
  tasks: readonly TenantDeletionTaskPlan[];
}

/** Context that the host passes as the second argument to `prepareInTx`. */
export interface TenantDeletionPreparationContext {
  deletionProtocol: typeof TENANT_DELETION_PROTOCOL;
  transactionTime: Date;
}

/** Context that the host passes as the second argument to `cleanupInTx`. */
export interface TenantDeletionContext extends TenantDeletionPreparationContext {
  journalId: string;
}

/** Options accepted by `deleteTenantWithMembers`. */
export interface TenantDeletionOptions {
  deletionProtocol?: typeof TENANT_DELETION_PROTOCOL;
  prepareInTx?: (
    tx: Prisma.TransactionClient,
    context: TenantDeletionPreparationContext,
  ) => Promise<TenantDeletionPlanInput | undefined>;
  cleanupInTx?: (tx: Prisma.TransactionClient, context?: TenantDeletionContext) => Promise<void>;
  /** Internal test input for the transaction time only, not a production path. */
  transactionTime?: Date;
}

export class TenantDeletionContractError extends Error {
  readonly code = 'tenant_deletion_contract_required' as const;

  constructor() {
    super('tenant deletion requires deletionProtocol tenant-delete-v2');
    this.name = 'TenantDeletionContractError';
  }
}

/** Sanitized plan validation error without input data; maps to HTTP 409. */
export class TenantDeletionJournalUnavailableError extends Error {
  readonly code = 'retention_journal_unavailable' as const;

  constructor() {
    super('tenant deletion blocked: no valid retention plan available');
    this.name = 'TenantDeletionJournalUnavailableError';
  }
}

/** Throws `TenantDeletionContractError` unless `value` is the exact token. */
export function assertTenantDeletionProtocol(value: unknown): void {
  if (value !== TENANT_DELETION_PROTOCOL) throw new TenantDeletionContractError();
}
