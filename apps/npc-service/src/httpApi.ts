import crypto from 'crypto';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import type { NpcRoomCommand, NpcSpawnCommand } from '@meetropolis/shared';
import { despawnCommand, roomCommand, spawnCommand, tenantSlug } from './commandSchemas.js';
import { config } from './config.js';
import { botManager } from './botManager.js';
import { logger } from './index.js';

const NPC_BODY_LIMIT_BYTES = 16 * 1024;

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const distinct = req.headersDistinct?.['x-npc-secret'];
  const raw = req.headers['x-npc-secret'];
  if (!Array.isArray(distinct) || distinct.length !== 1 || typeof raw !== 'string') {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!timingSafeEqualStrings(raw, config.npcServiceSecret)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function handleSpawn(req: Request, res: Response): void {
  const parsed = spawnCommand.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  const command: NpcSpawnCommand = parsed.data;
  botManager
    .spawn(command)
    .then(() => {
      res.json({ ok: true, identity: command.npc.identity });
    })
    .catch((e: unknown) => {
      logger.error({ err: e }, '[HTTP] spawn error');
      res.status(500).json({
        error: 'spawn_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    });
}

function handleDespawn(req: Request, res: Response): void {
  const parsed = despawnCommand.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  const { identity, tenantSlug: slug } = parsed.data;
  botManager
    .despawn(slug, identity)
    .then(() => {
      res.json({ ok: true });
    })
    .catch((e: unknown) => {
      logger.error({ err: e }, '[HTTP] despawn error');
      res.status(500).json({
        error: 'despawn_failed',
        message: e instanceof Error ? e.message : String(e),
      });
    });
}

function resolveTenantSlug(req: Request): string | null {
  const queryTenant = req.query.tenant;
  if (Array.isArray(queryTenant)) return null;
  if (queryTenant !== undefined && typeof queryTenant !== 'string') return null;
  const bodyTenant = (req.body as { tenantSlug?: unknown } | undefined)?.tenantSlug;
  if (bodyTenant !== undefined && typeof bodyTenant !== 'string') return null;
  if (queryTenant !== undefined && bodyTenant !== undefined && queryTenant !== bodyTenant) {
    return null;
  }
  const merged = queryTenant ?? bodyTenant;
  if (merged === undefined || !tenantSlug.safeParse(merged).success) return null;
  return merged;
}

function handleCommand(req: Request, res: Response): void {
  const identityParam = req.params.identity;
  if (typeof identityParam !== 'string' || identityParam.length === 0) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  const slug = resolveTenantSlug(req);
  if (slug === null) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  const body = (req.body ?? {}) as { action?: unknown; payload?: unknown };
  const parsed = roomCommand.safeParse({ action: body.action, payload: body.payload });
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  const command: NpcRoomCommand = parsed.data;
  try {
    botManager.sendCommand(slug, identityParam, command);
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ err: e }, '[HTTP] command error');
    res.status(500).json({
      error: 'command_failed',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function handleGetAll(_req: Request, res: Response): void {
  res.json(botManager.getStatusAll());
}

export function registerHttpApi(app: Application): void {
  app.use('/bots', authMiddleware);
  app.use('/bots', express.json({ limit: NPC_BODY_LIMIT_BYTES }));

  app.post('/bots/spawn', handleSpawn);
  app.post('/bots/despawn', handleDespawn);
  app.post('/bots/:identity/command', handleCommand);
  app.get('/bots', handleGetAll);
}
