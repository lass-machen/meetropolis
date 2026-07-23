/**
 * LiveKit RoomServiceClient wrapper for H4 audio-zone enforcement.
 *
 * Net-new: the rest of the server only ever mints AccessTokens
 * (livekit.ts). This is the first use of LiveKit's admin API, used by
 * reconciler.ts as the defense-in-depth "updateSubscriptions(false)"
 * layer described in the H4 spec.
 *
 * Fail policy: every call is retried a bounded number of times with
 * backoff, then rejects. Callers (reconciler.ts) MUST treat a rejection
 * as "skip this correction, try again next cycle" — never as a signal to
 * widen access. The SFU-hard boundary (publisher-side
 * setTrackSubscriptionPermissions) does not depend on this client at all,
 * so an outage here only degrades the secondary/defense-in-depth layer.
 */

import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';
import { logger } from '../../logger.js';

export interface LivekitAdminClient {
  listParticipants(roomName: string): Promise<ParticipantInfo[]>;
  updateSubscriptions(
    roomName: string,
    subscriberIdentity: string,
    trackSids: string[],
    subscribe: boolean,
  ): Promise<void>;
}

interface RetryPolicy {
  attempts: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = { attempts: 3, baseDelayMs: 200 };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(label: string, fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < policy.attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      logger.debug(`[AudioZones] LiveKit admin call failed (attempt ${attempt + 1}/${policy.attempts}): ${label}`, e);
      if (attempt < policy.attempts - 1) await delay(policy.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// LIVEKIT_URL is a websocket URL (ws://.../wss://...) meant for client
// SDKs. RoomServiceClient needs an http(s) host. Pure so it's unit-testable
// without constructing a real client.
export function mapLivekitUrlToHttp(livekitUrl: string): string {
  if (livekitUrl.startsWith('wss://')) return `https://${livekitUrl.slice('wss://'.length)}`;
  if (livekitUrl.startsWith('ws://')) return `http://${livekitUrl.slice('ws://'.length)}`;
  return livekitUrl;
}

// Returns null when LiveKit admin credentials are not configured (e.g. a
// minimal OSS dev setup without LIVEKIT_API_KEY/SECRET). Callers must
// treat null as "reconciler disabled this cycle" and rely on the
// publisher-permission boundary alone — never as a reason to widen access.
export function createLivekitAdminClient(retryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY): LivekitAdminClient | null {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const rawUrl = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !rawUrl) {
    // warn, not debug: production defaults to LOG_LEVEL=info (see
    // logger.ts), so a debug-level message here would never surface to
    // ops. This disables a real defense-in-depth layer (see reconciler.ts's
    // module doc) and /readyz's `livekitAdmin` field only reports the same
    // condition on request, not proactively — this is the only startup-time
    // signal an operator gets if the omission (LIVEKIT_EXTERNAL_URL set,
    // LIVEKIT_URL forgotten) was accidental.
    logger.warn('[AudioZones] LiveKit admin client not configured (missing URL/API key/secret); reconciler disabled');
    return null;
  }
  const httpHost = mapLivekitUrlToHttp(rawUrl);
  const client = new RoomServiceClient(httpHost, apiKey, apiSecret);

  return {
    listParticipants: (roomName) =>
      withRetry(`listParticipants(${roomName})`, () => client.listParticipants(roomName), retryPolicy),
    updateSubscriptions: (roomName, subscriberIdentity, trackSids, subscribe) =>
      withRetry(
        `updateSubscriptions(${roomName}, ${subscriberIdentity}, subscribe=${subscribe})`,
        () => client.updateSubscriptions(roomName, subscriberIdentity, trackSids, subscribe),
        retryPolicy,
      ),
  };
}
