import crypto from 'crypto';

/** Hash an invite code for storage and lookup; the raw code never reaches the database. */
export function hashInviteCode(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Create a raw invite code together with the hash that is stored in its place. */
export function newInviteCode(): { code: string; codeHash: string } {
  const code = crypto.randomBytes(12).toString('hex');
  return { code, codeHash: hashInviteCode(code) };
}
