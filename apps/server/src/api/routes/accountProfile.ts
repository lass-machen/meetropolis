import type express from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { displayNameSchema, invalidNameBodyFor } from '../utils/displayName.js';
import { normalizeEmailForStorage } from '../utils/authHelpers.js';
import { issueEmailProof } from '../utils/emailProof.js';
import { emailProofResponse } from './auth.verify.js';

const profileSchema = z.object({ email: z.string().email().optional(), name: displayNameSchema.nullish() });

/** Share the confirmed email-change flow between both self-update routes. */
export async function updateOwnProfile(prisma: PrismaClient, userId: string, body: unknown, res: express.Response): Promise<void> {
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json(invalidNameBodyFor(parsed.error) ?? { error: 'Invalid email address.' });
    return;
  }
  const { name, email } = parsed.data;
  if (!name && !email) { res.status(400).json({ error: 'nothing to update' }); return; }
  const current = await prisma.user.findUnique({ where: { id: userId } });
  if (!current) { res.status(404).json({ error: 'Account not found.' }); return; }
  const nextEmail = email ? normalizeEmailForStorage(email) : current.email;
  if (nextEmail !== current.email) {
    const other = await prisma.user.findFirst({ where: { id: { not: userId }, email: { equals: nextEmail, mode: 'insensitive' } }, select: { id: true } });
    if (other) { res.status(400).json({ code: 'EMAIL_IN_USE', error: 'Email address already in use.' }); return; }
    const outcome = await issueEmailProof({ prisma, userId, purpose: 'email_change', email: nextEmail });
    if (outcome.status !== 'issued') { emailProofResponse(res, outcome); return; }
    if (name) await prisma.user.update({ where: { id: userId }, data: { name } });
    res.status(202).json({ id: userId, email: current.email, name: name ?? current.name,
      emailVerified: !!current.emailVerifiedAt, emailChangePending: true, pendingEmail: nextEmail, sent: true });
    return;
  }
  const updated = await prisma.user.update({ where: { id: userId }, data: { ...(name ? { name } : {}) } });
  res.json({ id: updated.id, email: updated.email, name: updated.name });
}
