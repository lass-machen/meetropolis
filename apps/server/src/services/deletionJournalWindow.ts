// Retention and copy lifetime settings that bound how long a deletion journal
// intent stays decidable. Kept apart from the journal file handling.

/**
 * Parses the raw retention-days setting. Only whole numbers from 1 to 13 are
 * valid: the maximum copy lifetime the journal relies on comes from
 * BACKUP_MAX_COPY_LIFETIME_DAYS. Anything else (including missing values)
 * yields undefined so the caller stays unavailable instead of inventing a default.
 */
export function parseRetentionDays(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 13) return undefined;
    return value;
  }
  if (typeof value === 'string') {
    if (!/^(?:[1-9]|1[0-3])$/.test(value.trim())) return undefined;
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

/**
 * Parses the raw maximum copy lifetime setting in days. Only whole numbers
 * from 1 to 99999 are valid, either as a number or as a digit string without
 * leading zeros. Anything else (including missing values) yields undefined so
 * the caller stays unavailable instead of inventing a default.
 */
export function parseMaxCopyLifetimeDays(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 99999) return undefined;
    return value;
  }
  if (typeof value === 'string') {
    if (!/^[1-9][0-9]{0,4}$/.test(value.trim())) return undefined;
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

/**
 * Expiry of a journal intent: the transaction time plus the configured copy
 * lifetime in days. Undefined when the transaction time is not finite or the
 * lifetime or retention settings are missing, invalid or the lifetime is
 * shorter than the retention.
 */
export function journalUntilFor(
  transactionMs: number,
  maxCopyLifetimeDays: unknown,
  retentionDays: unknown,
): Date | undefined {
  if (!Number.isFinite(transactionMs)) return undefined;
  const lifetimeDays = parseMaxCopyLifetimeDays(maxCopyLifetimeDays);
  const retention = parseRetentionDays(retentionDays);
  if (lifetimeDays === undefined || retention === undefined) return undefined;
  if (lifetimeDays < retention) return undefined;
  return new Date(transactionMs + lifetimeDays * 86_400_000);
}
