import type { Request, Response, NextFunction, Application } from 'express';
import { config } from './config.js';
import { botManager } from './botManager.js';
import { logger } from './index.js';

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-npc-secret'] as string;
  if (secret !== config.npcServiceSecret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

function handleSpawn(req: Request, res: Response): void {
  const body = req.body;
  if (!body?.npc?.identity || !body?.tenantSlug) {
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }
  botManager
    .spawn(body)
    .then(() => {
      res.json({ ok: true, identity: body.npc.identity });
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
  const { identity, tenantSlug } = req.body || {};
  if (!identity || !tenantSlug) {
    res.status(400).json({ error: 'identity and tenantSlug required' });
    return;
  }
  botManager
    .despawn(tenantSlug as string, identity as string)
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

function handleCommand(req: Request, res: Response): void {
  const identityParam = req.params.identity;
  const identity = Array.isArray(identityParam) ? identityParam[0] ?? '' : identityParam ?? '';
  const tenantSlug = (req.query.tenant as string) || req.body?.tenantSlug;
  if (!tenantSlug) {
    res.status(400).json({ error: 'tenantSlug required' });
    return;
  }
  try {
    botManager.sendCommand(tenantSlug, identity, req.body);
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

  app.post('/bots/spawn', handleSpawn);
  app.post('/bots/despawn', handleDespawn);
  app.post('/bots/:identity/command', handleCommand);
  app.get('/bots', handleGetAll);
}
