import type { PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import { runDeletionTasksOnce } from './tenantDeletionPlanning.js';
import { purgeExpiredAuthEvents } from './authEvents.js';

const DEFAULT_INTERVAL_MS = 60_000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'NonError';
}

/**
 * Starts the periodic pass over the deletion tasks. The first pass runs at once and later passes follow
 * every `intervalMs`; a tick is skipped while a pass is still running. A failed pass is logged by its
 * error name only and does not end the schedule. The timer is unref'd, so it never keeps the process alive.
 */
export function startDeletionTaskWorker(options: { prisma: PrismaClient; journalDir: string; intervalMs?: number }): {
  stop(): Promise<void>;
} {
  let running: Promise<void> | undefined;

  const runPass = async (): Promise<void> => {
    const now = new Date();
    try {
      await runDeletionTasksOnce({ prisma: options.prisma, journalDir: options.journalDir, now });
    } catch (error) {
      logger.error({ event: 'tenant_deletion.worker_run_failed', errorName: errorName(error) });
    }
    try {
      await purgeExpiredAuthEvents(options.prisma, now);
    } catch (error) {
      logger.error({ event: 'auth_event.retention_failed', errorName: errorName(error) });
    }
  };

  const tick = (): void => {
    if (running) return;
    running = runPass().finally(() => {
      running = undefined;
    });
  };

  tick();
  const timer = setInterval(tick, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();

  return {
    async stop(): Promise<void> {
      clearInterval(timer);
      await running;
    },
  };
}
