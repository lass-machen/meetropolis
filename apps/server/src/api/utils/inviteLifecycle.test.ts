import type { PrismaClient } from '../../generated/prisma/index.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const delivery = vi.hoisted(() => ({ context: undefined as Record<string, unknown> | undefined }));

vi.mock('../../emailLoader.js', () => ({
  sendIfAvailable: vi.fn((_send: unknown, _event: string, context: Record<string, unknown>) => {
    delivery.context = context;
    return Promise.resolve(false);
  }),
}));

import { sendIfAvailable } from '../../emailLoader.js';
import {
  deriveInviteStatus,
  deliverInvite,
  inviteEmailMatches,
  inviteExpiry,
  INVITE_NOT_DELIVERED,
  maskInviteEmail,
} from './inviteLifecycle.js';

const now = new Date('2026-11-06T12:00:00.000Z');

describe('inviteLifecycle', () => {
  beforeEach(() => {
    delivery.context = undefined;
    vi.mocked(sendIfAvailable).mockClear();
  });

  it('sets a seven-day expiry and derives pending, expired, and accepted status', () => {
    expect(inviteExpiry(now)).toEqual(new Date('2026-11-13T12:00:00.000Z'));
    expect(deriveInviteStatus({ usedAt: null, expiresAt: inviteExpiry(now) }, now)).toBe('pending');
    expect(deriveInviteStatus({ usedAt: null, expiresAt: now }, now)).toBe('expired');
    expect(deriveInviteStatus({ usedAt: null, expiresAt: null }, now)).toBe('expired');
    expect(deriveInviteStatus({ usedAt: now, expiresAt: inviteExpiry(now) }, now)).toBe('accepted');
  });

  it('masks an email address and returns null for missing or malformed input', () => {
    expect(maskInviteEmail('anna@example.test')).toBe('a***@example.test');
    expect(maskInviteEmail('malformed')).toBeNull();
    expect(maskInviteEmail(null)).toBeNull();
  });

  it('matches normalized addresses and rejects an invite without a bound email', () => {
    expect(inviteEmailMatches(' Test+invite@Example.test ', 'test@example.test')).toBe(true);
    expect(inviteEmailMatches(null, 'test@example.test')).toBe(false);
  });

  it('records a failed delivery without claiming it was sent or logging its code', async () => {
    const invite = { id: 'invite-id', email: 'person@example.test', tenantId: 'tenant-id' };
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ name: 'Inviter', email: 'inviter@example.test', locale: 'en' }) },
      invite: { update: vi.fn().mockResolvedValue(undefined) },
    } as PrismaClient;

    await expect(
      deliverInvite(prisma, {
        invite,
        inviterUserId: 'inviter-id',
        tenantName: 'Example Team',
        inviteUrl: 'https://app.example.test/#/?invite=invite-code',
      }),
    ).resolves.toBe(false);

    expect(vi.mocked(sendIfAvailable)).toHaveBeenCalledWith(expect.any(Function), 'invite.email_failed', {
      tenantId: invite.tenantId,
      inviteId: invite.id,
    });
    expect(delivery.context).toEqual({ tenantId: invite.tenantId, inviteId: invite.id });
    expect(prisma.invite.update).toHaveBeenCalledWith({
      where: { id: invite.id },
      data: { lastSendError: INVITE_NOT_DELIVERED },
    });
  });
});
