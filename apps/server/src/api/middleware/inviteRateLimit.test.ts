import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_INVITE_CREATE_MAX = '30';
  process.env.RATE_LIMIT_INVITE_CREATE_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_INVITE_RESEND_MAX = '5';
  process.env.RATE_LIMIT_INVITE_RESEND_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_INVITE_PREVIEW_MAX = '30';
  process.env.RATE_LIMIT_INVITE_PREVIEW_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_INVITE_ACCEPT_MAX = '30';
  process.env.RATE_LIMIT_INVITE_ACCEPT_WINDOW_MS = '60000';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import type { PrismaClient } from '../../generated/prisma/index.js';
import { errorHandler } from '../errorHandler.js';
import { setAuthResolution } from '../utils/authState.js';
import { registerAuthRoutes } from '../routes/auth.js';
import { registerInviteRoutes } from '../routes/invites.js';

const tenant = { id: 'invite-rate-limit-tenant', slug: 'invite-rate-limit-tenant', name: 'Invite Tenant' };

function makePrismaStub(): PrismaClient {
  return {
    invite: { findUnique: vi.fn(() => Promise.resolve(null)) },
    membership: { findUnique: vi.fn(() => Promise.resolve({ role: 'owner' })) },
  } as unknown as PrismaClient;
}

function makeApp(): express.Application {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    setAuthResolution(req, {
      auth: typeof userId === 'string' ? { userId, sessionId: `session-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    req.tenant = tenant as never;
    next();
  });
  const prisma = makePrismaStub();
  registerAuthRoutes(app, prisma);
  registerInviteRoutes(app, prisma);
  app.use(errorHandler);
  return app;
}

function createRequest(app: express.Application, userId: string) {
  return request(app).post('/auth/invite').set('x-user', userId).set('x-tenant', tenant.id).send({});
}

function resendRequest(app: express.Application, inviteId: string) {
  return request(app).post(`/invites/${inviteId}/resend`).set('x-user', 'resend-admin').set('x-tenant', tenant.id);
}

function previewRequest(app: express.Application, ip: string) {
  return request(app).post('/public/invites/preview').set('X-Forwarded-For', ip).send({ code: 'missing-preview' });
}

function acceptRequest(app: express.Application, ip: string) {
  return request(app).post('/invites/accept').set('X-Forwarded-For', ip).send({ code: 'missing-accept' });
}

describe('invite route rate limits', { retry: 2 }, () => {
  it('limits invite creation per authenticated user', async () => {
    const app = makeApp();
    const userId = `create-${crypto.randomUUID()}`;

    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await createRequest(app, userId)).status).toBe(400);
    }
    expect((await createRequest(app, userId)).status).toBe(429);
    expect((await createRequest(app, `other-${crypto.randomUUID()}`)).status).toBe(400);
  });

  it('limits resend per invite ID', async () => {
    const app = makeApp();
    const inviteId = `invite-${crypto.randomUUID()}`;

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await resendRequest(app, inviteId)).status).toBe(404);
    }
    expect((await resendRequest(app, inviteId)).status).toBe(429);
    expect((await resendRequest(app, `other-${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('limits preview per IP', async () => {
    const app = makeApp();
    const ip = '198.51.100.41';

    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await previewRequest(app, ip)).status).toBe(404);
    }
    expect((await previewRequest(app, ip)).status).toBe(429);
    expect((await previewRequest(app, '198.51.100.42')).status).toBe(404);
  });

  it('limits accept per IP', async () => {
    const app = makeApp();
    const ip = '198.51.100.51';

    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await acceptRequest(app, ip)).status).toBe(401);
    }
    expect((await acceptRequest(app, ip)).status).toBe(429);
    expect((await acceptRequest(app, '198.51.100.52')).status).toBe(401);
  });
});
