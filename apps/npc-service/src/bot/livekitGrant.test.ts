import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { npcRoomConnectOptions, npcVideoGrant } from './livekitGrant.js';

const TEST_API_KEY = 'test-key';
const TEST_API_SECRET = 'test-secret-with-more-than-32-characters';

describe('npcVideoGrant', () => {
  it('sets every grant explicitly and denies publishing data', () => {
    expect(npcVideoGrant('tenant:world')).toEqual({
      room: 'tenant:world',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
  });

  it('produces a token whose verified claims deny publishing data', async () => {
    const accessToken = new AccessToken(TEST_API_KEY, TEST_API_SECRET, { identity: 'npc-test' });
    accessToken.addGrant(npcVideoGrant('tenant:world'));
    const token = await accessToken.toJwt();

    const claims = await new TokenVerifier(TEST_API_KEY, TEST_API_SECRET).verify(token);

    expect(claims.video?.canPublishData).toBe(false);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
  });
});

describe('npcRoomConnectOptions', () => {
  it('never subscribes to other participants on its own', () => {
    expect(npcRoomConnectOptions).toEqual({ autoSubscribe: false, dynacast: false });
  });
});
