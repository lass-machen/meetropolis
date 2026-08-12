import type express from 'express';
import { logger } from '../logger.js';
import { encodeSseEvent, type MobilePlayer, type MobileServerEvent } from './protocol.js';
import { MOBILE_PROTOCOL_VERSION } from './protocol.js';
import { WorldBridge } from './worldBridge.js';

/**
 * One mobile client: an SSE response downstream, a world-room bridge
 * upstream, and the rate shaping between them.
 *
 * The world room emits a state change on every player movement — tens per
 * second with a handful of active users walking around. The mini mode has no
 * map canvas and cannot use that resolution; it needs to know who is present,
 * in which zone, and whether they are muted. Forwarding raw state changes to
 * a phone would burn battery and mobile data for information the UI throws
 * away, so this class coalesces them: at most one roster frame per
 * ROSTER_MIN_INTERVAL_MS, and only when something the app actually renders
 * has changed.
 */

/** Upper bound on roster frames. Presence is not a real-time signal. */
const ROSTER_MIN_INTERVAL_MS = 500;

/**
 * Position quantisation for change detection. Zone membership is what the
 * mini mode shows, so sub-tile jitter must not produce a frame. Coarse
 * enough to swallow walking noise, fine enough that crossing a zone border
 * always registers.
 */
const POSITION_EPSILON = 8;

/** Comment frame keeping intermediaries from reaping an idle stream. */
const PING_INTERVAL_MS = 15_000;

export interface MobileSessionOptions {
  sessionId: string;
  userId: string;
  identity: string;
  serverUrl: string;
  authToken: string;
  tenantSlug?: string;
  zonePrivacyVersion: number;
  res: express.Response;
}

export class MobileSession {
  readonly sessionId: string;
  readonly userId: string;

  private readonly res: express.Response;
  private readonly bridge: WorldBridge;
  private pingTimer: NodeJS.Timeout | null = null;
  private rosterTimer: NodeJS.Timeout | null = null;
  private pendingRoster: MobilePlayer[] | null = null;
  private lastRosterSignature = '';
  private lastRosterSentAt = 0;
  private closed = false;

  constructor(options: MobileSessionOptions) {
    this.sessionId = options.sessionId;
    this.userId = options.userId;
    this.res = options.res;

    this.bridge = new WorldBridge({
      serverUrl: options.serverUrl,
      authToken: options.authToken,
      tenantSlug: options.tenantSlug,
      zonePrivacyVersion: options.zonePrivacyVersion,
      emit: (event) => this.onBridgeEvent(event),
    });

    this.writeHeaders();
    this.emit({
      type: 'session',
      sessionId: options.sessionId,
      protocolVersion: MOBILE_PROTOCOL_VERSION,
      identity: options.identity,
    });
    this.pingTimer = setInterval(() => this.writeRaw(': ping\n\n'), PING_INTERVAL_MS);
  }

  async start(): Promise<void> {
    await this.bridge.connect();
  }

  /** Forward an app action to the world room, translating the names. */
  handleAction(action: { type: string; [key: string]: unknown }): void {
    switch (action.type) {
      case 'move':
        this.bridge.send('move', { x: action.x, y: action.y, direction: action.direction ?? 'down' });
        break;
      case 'dnd':
        this.bridge.send('dnd_status', { dnd: action.dnd });
        break;
      case 'avatar':
        this.bridge.send('avatar_change', { avatarId: action.avatarId });
        break;
      case 'change_map':
        this.bridge.send('change_map', { mapId: action.mapId });
        break;
      case 'heartbeat':
        this.bridge.send('heartbeat');
        break;
      default:
        logger.debug({ type: action.type }, '[mobile] unknown action type');
    }
  }

  private onBridgeEvent(event: MobileServerEvent): void {
    if (event.type === 'roster') {
      this.queueRoster(event.players);
      return;
    }
    this.emit(event);
  }

  /**
   * Coalesce roster frames. Drops updates that would not change what the app
   * renders, and spaces the rest out; the newest pending state always wins,
   * so a dropped frame never leaves the client behind.
   */
  private queueRoster(players: MobilePlayer[]): void {
    const signature = rosterSignature(players);
    if (signature === this.lastRosterSignature) return;

    this.pendingRoster = players;
    if (this.rosterTimer) return;

    const elapsed = Date.now() - this.lastRosterSentAt;
    const wait = Math.max(0, ROSTER_MIN_INTERVAL_MS - elapsed);
    this.rosterTimer = setTimeout(() => {
      this.rosterTimer = null;
      const pending = this.pendingRoster;
      this.pendingRoster = null;
      if (!pending) return;
      this.lastRosterSignature = rosterSignature(pending);
      this.lastRosterSentAt = Date.now();
      this.emit({ type: 'roster', players: pending });
    }, wait);
  }

  private emit(event: MobileServerEvent): void {
    this.writeRaw(encodeSseEvent(event));
  }

  private writeHeaders(): void {
    this.res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // `no-transform` is load-bearing: the global `compression()` middleware
    // (index.ts) would otherwise buffer the stream and nothing would arrive
    // until the response ends. The compression module honours this token.
    this.res.setHeader('Cache-Control', 'no-cache, no-transform');
    this.res.setHeader('Connection', 'keep-alive');
    // Same intent for reverse proxies that buffer by default.
    this.res.setHeader('X-Accel-Buffering', 'no');
    this.res.flushHeaders?.();
  }

  private writeRaw(chunk: string): void {
    if (this.closed) return;
    try {
      this.res.write(chunk);
    } catch (err) {
      logger.debug({ err, sessionId: this.sessionId }, '[mobile] write to closed stream');
      void this.close();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.rosterTimer) clearTimeout(this.rosterTimer);
    this.pingTimer = null;
    this.rosterTimer = null;
    await this.bridge.dispose();
    try {
      this.res.end();
    } catch {
      /* already ended */
    }
  }
}

/**
 * Identity of a roster frame for change detection. Positions are quantised
 * so that walking inside one zone does not produce frames, while crossing a
 * border does.
 */
export function rosterSignature(players: MobilePlayer[]): string {
  return players
    .map(
      (p) =>
        `${p.identity}:${Math.round(p.x / POSITION_EPSILON)}:${Math.round(p.y / POSITION_EPSILON)}:` +
        `${p.dnd ? 1 : 0}:${p.mapId}:${p.name}:${p.avatarId}`,
    )
    .sort()
    .join('|');
}
