import type { AuthContext } from 'colyseus';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import type { RoomOptions } from '../WorldRoom.js';
import { authenticateWorldJoin, resolveRawAuthToken, type WorldAuth } from './onAuth.js';

/**
 * Static world-room auth. Colyseus calls this before it reserves a seat.
 * The raw token is the `token` argument, otherwise the `auth_token` cookie.
 * The returned `WorldAuth` is stored as seat `authData` and must not carry
 * the raw token. Matchmaking shares one Prisma client; the room keeps its
 * own client for the join.
 */
let matchmakePrisma: PrismaClient | null = null;

function getMatchmakePrisma(): PrismaClient {
  if (!matchmakePrisma) matchmakePrisma = createPrismaClient();
  return matchmakePrisma;
}

export async function authenticateWorldMatchmake(
  token: string,
  options: RoomOptions | undefined,
  context: AuthContext,
): Promise<WorldAuth> {
  const raw = resolveRawAuthToken(context, token);
  const authContext: AuthContext = raw ? { ...context, token: raw } : context;
  return authenticateWorldJoin(options, authContext, getMatchmakePrisma());
}
