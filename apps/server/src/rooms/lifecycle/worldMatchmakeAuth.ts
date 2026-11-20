import { ServerError, type AuthContext } from '@colyseus/core';
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

/**
 * Colyseus answers a failed static auth over HTTP and uses the error code
 * as the status. The world rejection codes (4401, 4426) are WebSocket close
 * codes and no valid HTTP status, so the response itself would fail and
 * reach the client as a 500. Their last three digits are the matching HTTP
 * status, which is what matchmaking answers with.
 */
function toMatchmakeError(error: unknown): unknown {
  if (error instanceof ServerError && error.code >= 4400 && error.code <= 4599) {
    return new ServerError(error.code - 4000, error.message);
  }
  return error;
}

export async function authenticateWorldMatchmake(
  token: string,
  options: RoomOptions | undefined,
  context: AuthContext,
): Promise<WorldAuth> {
  const raw = resolveRawAuthToken(context, token);
  const authContext: AuthContext = raw ? { ...context, token: raw } : context;
  try {
    return await authenticateWorldJoin(options, authContext, getMatchmakePrisma());
  } catch (error) {
    throw toMatchmakeError(error);
  }
}
