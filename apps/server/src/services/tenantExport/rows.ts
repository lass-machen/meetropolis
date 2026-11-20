import { TenantExportError } from './sink.js';
import type { ExportRow, ModelExportSpec } from './types.js';

/** Plain objects recurse; every other class instance passes through untouched. */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Serializes one database value for the export: dates as ISO strings, bigints
 * as decimal strings, binary data as base64 and Prisma decimals via
 * `toString`. Arrays and plain objects recurse, all else passes through.
 */
export function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return String(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('base64');
  }
  if (typeof value === 'object' && value !== null) {
    const constructorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
    if (constructorName === 'Decimal' && typeof (value as { toString?: unknown }).toString === 'function') {
      return (value as { toString(): string }).toString();
    }
    if (Array.isArray(value)) {
      return value.map((entry) => serializeValue(entry));
    }
    if (isPlainObject(value)) {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value)) {
        result[key] = serializeValue(entry);
      }
      return result;
    }
  }
  return value;
}

/** Minimal Prisma delegate surface used for paged reads. */
export interface RowDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
    orderBy: Record<string, 'asc'>[];
    skip: number;
    take: number;
  }): Promise<ExportRow[]>;
}

/** Returns the Prisma delegate for `delegate`, or throws `unknown_delegate`. */
export function getRowDelegate(prisma: unknown, delegate: string): RowDelegate {
  const candidate = (prisma as Record<string, unknown> | null | undefined)?.[delegate];
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof (candidate as { findMany?: unknown }).findMany !== 'function'
  ) {
    throw new TenantExportError('unknown_delegate');
  }
  return candidate as RowDelegate;
}

/**
 * Yields every row of `spec` for `tenantId`, one serializable page at a time.
 * Selection and ordering come from the spec; paging stops at the first short
 * page.
 */
export async function* pagedRows(
  delegate: RowDelegate,
  spec: ModelExportSpec,
  tenantId: string,
  pageSize = 500,
): AsyncGenerator<ExportRow> {
  const where = spec.where(tenantId);
  const select: Record<string, true> = {};
  for (const field of spec.fields) {
    select[field] = true;
  }
  const orderBy: Record<string, 'asc'>[] = spec.orderBy.map((field) => ({ [field]: 'asc' }));
  let skip = 0;
  for (;;) {
    const rows = await delegate.findMany({ where, select, orderBy, skip, take: pageSize });
    for (const row of rows) {
      yield serializeValue(row) as ExportRow;
    }
    if (rows.length < pageSize) {
      return;
    }
    skip += rows.length;
  }
}
