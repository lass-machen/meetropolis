/**
 * Keeps one plan resolver per process for one journal directory. Creating a
 * resolver reconciles undecided journal intents, so every caller in the
 * process shares the same instance instead of creating its own.
 */
export function createSharedPlanResolver<R>(
  create: (journalDir: string) => Promise<R>,
  onError: (error: unknown) => void,
): (journalDir: string) => Promise<R | undefined> {
  let cached: Promise<R | undefined> | undefined;
  let cachedDir: string | undefined;
  return (journalDir) => {
    // A second, different journal directory in the same process is refused.
    if (cachedDir !== undefined && cachedDir !== journalDir) return Promise.resolve(undefined);
    cachedDir = journalDir;
    cached ??= create(journalDir).catch((error: unknown) => {
      cached = undefined;
      onError(error);
      return undefined;
    });
    return cached;
  };
}
