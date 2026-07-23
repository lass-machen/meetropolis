/**
 * Unit tests for the reset-token primitives. The route-level flow is covered in
 * routes/auth.flow.test.ts; this pins the properties the flow relies on —
 * hashed at rest, single-use under concurrency, and bound to one user.
 */
import crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_TOKEN_PEPPER = 'reset-token-test-pepper';
  process.env.NODE_ENV = 'test';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  issuePasswordResetToken,
  claimPasswordResetToken,
  invalidatePasswordResetTokens,
  PASSWORD_RESET_TTL_MS,
  PASSWORD_RESET_TTL_MINUTES,
} from './passwordResetTokens.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

interface ResetRow {
  token: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
}

let resets: ResetRow[];
let users: Array<{ id: string; email: string }>;

function makePrisma(): PrismaClient {
  return {
    passwordReset: {
      create: ({ data }: { data: Omit<ResetRow, 'usedAt'> }) => {
        const row: ResetRow = { usedAt: null, ...data };
        resets.push(row);
        return Promise.resolve({ ...row });
      },
      findUnique: ({ where }: { where: { token: string } }) => {
        const row = resets.find((r) => r.token === where.token);
        return Promise.resolve(row ? { ...row } : null);
      },
      deleteMany: ({ where }: { where: { userId: string; usedAt: null } }) => {
        const before = resets.length;
        resets = resets.filter((r) => !(r.userId === where.userId && r.usedAt === null));
        return Promise.resolve({ count: before - resets.length });
      },
      // Models the atomicity of a single conditional UPDATE: rows are matched
      // and flipped without an interleaving point.
      updateMany: ({
        where,
        data,
      }: {
        where: { token: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const matched = resets.filter(
          (r) => r.token === where.token && r.usedAt === null && r.expiresAt > where.expiresAt.gt,
        );
        matched.forEach((r) => (r.usedAt = data.usedAt));
        return Promise.resolve({ count: matched.length });
      },
    },
    user: {
      findUnique: ({ where }: { where: { id: string } }) => {
        const row = users.find((u) => u.id === where.id);
        return Promise.resolve(row ? { ...row } : null);
      },
    },
  } as unknown as PrismaClient;
}

const expectedHash = (raw: string) =>
  crypto
    .createHash('sha256')
    .update(process.env.API_TOKEN_PEPPER + raw)
    .digest('hex');

beforeEach(() => {
  resets = [];
  users = [{ id: 'user-1', email: 'user@example.test' }];
});

describe('issuePasswordResetToken', () => {
  it('stores the peppered hash, never the token', async () => {
    const prisma = makePrisma();

    const { token } = await issuePasswordResetToken(prisma, 'user-1');

    expect(resets).toHaveLength(1);
    expect(resets[0].token).toBe(expectedHash(token));
    expect(resets[0].token).not.toBe(token);
    // 32 random bytes in, one SHA-256 out.
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(resets[0].token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('mints a different token every time', async () => {
    const prisma = makePrisma();

    const a = await issuePasswordResetToken(prisma, 'user-1');
    const b = await issuePasswordResetToken(prisma, 'user-1');

    expect(a.token).not.toBe(b.token);
  });

  it('expires the token after the documented TTL', async () => {
    const prisma = makePrisma();

    const { expiresAt } = await issuePasswordResetToken(prisma, 'user-1');

    expect(PASSWORD_RESET_TTL_MINUTES).toBe(30);
    const ttl = expiresAt.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(PASSWORD_RESET_TTL_MS - 5_000);
    expect(ttl).toBeLessThanOrEqual(PASSWORD_RESET_TTL_MS);
  });

  it('drops the previous unused token of the same user', async () => {
    const prisma = makePrisma();

    const first = await issuePasswordResetToken(prisma, 'user-1');
    await issuePasswordResetToken(prisma, 'user-1');

    expect(resets).toHaveLength(1);
    expect(await claimPasswordResetToken(prisma, first.token)).toBeNull();
  });

  it('leaves another user tokens alone', async () => {
    const prisma = makePrisma();
    users.push({ id: 'user-2', email: 'two@example.test' });

    const other = await issuePasswordResetToken(prisma, 'user-2');
    await issuePasswordResetToken(prisma, 'user-1');

    expect(await claimPasswordResetToken(prisma, other.token)).toEqual({ userId: 'user-2' });
  });
});

describe('claimPasswordResetToken', () => {
  it('returns the owner and burns the token', async () => {
    const prisma = makePrisma();
    const { token } = await issuePasswordResetToken(prisma, 'user-1');

    expect(await claimPasswordResetToken(prisma, token)).toEqual({ userId: 'user-1' });
    expect(resets[0].usedAt).toBeInstanceOf(Date);
    expect(await claimPasswordResetToken(prisma, token)).toBeNull();
  });

  it('lets only one of two concurrent claims win', async () => {
    const prisma = makePrisma();
    const { token } = await issuePasswordResetToken(prisma, 'user-1');

    const results = await Promise.all([
      claimPasswordResetToken(prisma, token),
      claimPasswordResetToken(prisma, token),
      claimPasswordResetToken(prisma, token),
    ]);

    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('rejects an unknown token', async () => {
    const prisma = makePrisma();

    expect(await claimPasswordResetToken(prisma, 'nope')).toBeNull();
  });

  it('rejects an expired token without burning it', async () => {
    const prisma = makePrisma();
    const { token } = await issuePasswordResetToken(prisma, 'user-1');
    resets[0].expiresAt = new Date(Date.now() - 1);

    expect(await claimPasswordResetToken(prisma, token)).toBeNull();
    expect(resets[0].usedAt).toBeNull();
  });

  it('rejects a token whose user has a different address', async () => {
    const prisma = makePrisma();
    const { token } = await issuePasswordResetToken(prisma, 'user-1');

    expect(await claimPasswordResetToken(prisma, token, 'someone@example.test')).toBeNull();
    // The mismatch must not consume the link the real user is about to click.
    expect(resets[0].usedAt).toBeNull();
    expect(await claimPasswordResetToken(prisma, token, 'user@example.test')).toEqual({ userId: 'user-1' });
  });

  it('accepts the address regardless of case and plus-addressing', async () => {
    const prisma = makePrisma();
    const { token } = await issuePasswordResetToken(prisma, 'user-1');

    expect(await claimPasswordResetToken(prisma, token, 'User+tag@Example.TEST')).toEqual({ userId: 'user-1' });
  });
});

describe('invalidatePasswordResetTokens', () => {
  it('removes pending links but keeps the used-token record', async () => {
    const prisma = makePrisma();
    const { token } = await issuePasswordResetToken(prisma, 'user-1');
    await claimPasswordResetToken(prisma, token);
    await issuePasswordResetToken(prisma, 'user-1');

    await invalidatePasswordResetTokens(prisma, 'user-1');

    expect(resets).toHaveLength(1);
    expect(resets[0].usedAt).toBeInstanceOf(Date);
  });
});
