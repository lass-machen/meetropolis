import { startAvAccessReconciler } from './avAccessReconciler.js';
import { stopAvPendingRevocations } from './avPendingRevocations.js';

type ReconcilerPrisma = Parameters<typeof startAvAccessReconciler>[0];

export interface AvAccessServices {
  /** Stop the reconciler, wait for a running round, then drop the revocation backlog. */
  stop(): Promise<void>;
}

/**
 * Server wiring for tenant-call access: starts the periodic reconciler at boot.
 * `stop()` is idempotent and keeps the order reconciler first, backlog second, so
 * a round that is still running cannot enqueue into a stopped backlog.
 */
export function startAvAccessServices(prisma: ReconcilerPrisma): AvAccessServices {
  const reconciler = startAvAccessReconciler(prisma);
  let stopping: Promise<void> | null = null;
  return {
    stop: () => {
      stopping ??= (async () => {
        try {
          await reconciler.stop();
        } finally {
          await stopAvPendingRevocations();
        }
      })();
      return stopping;
    },
  };
}
