import { AccessToken } from 'livekit-server-sdk';
import type { AccessTokenOptions } from 'livekit-server-sdk';

export async function createLivekitToken(params: {
  roomName: string;
  identity: string;
  name?: string;
  canPublish?: boolean;
  canPublishData?: boolean;
  canSubscribe?: boolean;
}) {
  const apiKey = process.env.LIVEKIT_API_KEY!;
  const apiSecret = process.env.LIVEKIT_API_SECRET!;
  const opts: AccessTokenOptions = { identity: params.identity };
  if (typeof params.name === 'string') opts.name = params.name;
  const at = new AccessToken(apiKey, apiSecret, opts);
  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: params.canPublish ?? true,
    canPublishData: params.canPublishData ?? true,
    canSubscribe: params.canSubscribe ?? true,
  });
  const jwt = await at.toJwt();
  return jwt;
}
