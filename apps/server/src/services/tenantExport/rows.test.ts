import { describe, expect, it } from 'vitest';
import { getRowDelegate, pagedRows, serializeValue } from './rows.js';
import { TenantExportError } from './sink.js';
import type { ExportRow, ModelExportSpec } from './types.js';

class Decimal {
  private readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

function testSpec(): ModelExportSpec {
  return {
    model: 'Map',
    delegate: 'map',
    file: 'db/Map.json',
    fields: ['id', 'name', 'createdAt'],
    omitted: {},
    orderBy: ['id'],
    where: (tenantId: string) => ({ tenantId }),
  };
}

describe('serializeValue', () => {
  it('serializes dates, bigints, binary data and decimals', () => {
    expect(serializeValue(new Date('2026-03-04T05:06:07.000Z'))).toBe('2026-03-04T05:06:07.000Z');
    expect(serializeValue(9007199254740993n)).toBe('9007199254740993');
    expect(serializeValue(new Uint8Array([1, 2, 3]))).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(serializeValue(Buffer.from([4, 5]))).toBe(Buffer.from([4, 5]).toString('base64'));
    expect(serializeValue(new Decimal('12.50'))).toBe('12.50');
  });

  it('recurses into arrays and plain objects', () => {
    expect(
      serializeValue({
        when: new Date('2026-01-01T00:00:00.000Z'),
        big: 7n,
        list: [new Decimal('1.5'), { raw: new Uint8Array([9]) }],
      }),
    ).toEqual({
      when: '2026-01-01T00:00:00.000Z',
      big: '7',
      list: ['1.5', { raw: Buffer.from([9]).toString('base64') }],
    });
  });

  it('leaves primitives and null untouched', () => {
    for (const value of ['text', 42, true, null]) {
      expect(serializeValue(value)).toBe(value);
    }
  });
});

describe('getRowDelegate', () => {
  it('returns the delegate when it exposes findMany', () => {
    const findMany = (): Promise<ExportRow[]> => Promise.resolve([]);
    const delegate = getRowDelegate({ map: { findMany } }, 'map');
    expect(delegate.findMany).toBe(findMany);
  });

  it('throws unknown_delegate for a missing or invalid delegate', () => {
    for (const prisma of [{}, { map: {} }, { map: null }, null, undefined]) {
      try {
        getRowDelegate(prisma, 'map');
      } catch (error) {
        expect(error).toBeInstanceOf(TenantExportError);
        expect((error as TenantExportError).code).toBe('unknown_delegate');
        continue;
      }
      throw new Error('expected TenantExportError');
    }
  });
});

describe('pagedRows', () => {
  it('pages 1201 rows with page size 500 exactly once and in order', async () => {
    const stored: ExportRow[] = Array.from({ length: 1201 }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    const calls: { skip: number; take: number }[] = [];
    let seenSelect: Record<string, true> = {};
    let seenOrderBy: Record<string, 'asc'>[] = [];
    let seenWhere: Record<string, unknown> = {};
    const delegate = {
      findMany(args: {
        where: Record<string, unknown>;
        select: Record<string, true>;
        orderBy: Record<string, 'asc'>[];
        skip: number;
        take: number;
      }): Promise<ExportRow[]> {
        calls.push({ skip: args.skip, take: args.take });
        seenSelect = args.select;
        seenOrderBy = args.orderBy;
        seenWhere = args.where;
        return Promise.resolve(stored.slice(args.skip, args.skip + args.take));
      },
    };
    const seen: ExportRow[] = [];
    for await (const row of pagedRows(delegate, testSpec(), 'tenant-1', 500)) {
      seen.push(row);
    }
    expect(seen).toHaveLength(1201);
    expect(seen.map((row) => row.id)).toEqual(stored.map((row) => row.id));
    expect(new Set(seen.map((row) => row.id))).toHaveLength(1201);
    expect(calls).toEqual([
      { skip: 0, take: 500 },
      { skip: 500, take: 500 },
      { skip: 1000, take: 500 },
    ]);
    expect(seenSelect).toEqual({ id: true, name: true, createdAt: true });
    expect(seenOrderBy).toEqual([{ id: 'asc' }]);
    expect(seenWhere).toEqual({ tenantId: 'tenant-1' });
    expect(seen[0]?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
