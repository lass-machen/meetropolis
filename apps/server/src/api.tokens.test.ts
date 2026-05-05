import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Ensure required secrets for the API layer
process.env.JWT_SECRET = process.env.JWT_SECRET || 'testsecret';
process.env.API_TOKEN_PEPPER = process.env.API_TOKEN_PEPPER || 'test-pepper';

// In-memory store to mock Prisma ApiToken model
type TokenRec = {
  id: string;
  userId: string;
  name?: string | null;
  hash: string;
  lastUsedAt?: Date | null;
  createdAt: Date;
};

const mem: { tokens: TokenRec[] } = { tokens: [] };

// Mock PrismaClient used inside api.ts. Achtung: api.ts importiert aus
// './generated/prisma/index.js' (lokal generierter Client), NICHT aus
// '@prisma/client' — daher muessen wir genau diesen Specifier mocken.
vi.mock('./generated/prisma/index.js', () => {
  class PrismaClientMock {
    apiToken = {
      async create({ data }: { data: { userId: string; name?: string; hash: string } }) {
        const rec: TokenRec = {
          id: `tok_${Math.random().toString(36).slice(2, 10)}`,
          userId: data.userId,
          name: data.name,
          hash: data.hash,
          createdAt: new Date(),
          lastUsedAt: null,
        };
        mem.tokens.unshift(rec);
        return rec as any;
      },
      async findMany({ where, orderBy }: any) {
        let list = mem.tokens.filter((t) => t.userId === where.userId);
        if (orderBy?.createdAt === 'desc') {
          list = list.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return list as any;
      },
      async findUnique({ where }: any) {
        if (where?.id) return (mem.tokens.find((t) => t.id === where.id) as any) || null;
        if (where?.hash) return (mem.tokens.find((t) => t.hash === where.hash) as any) || null;
        return null;
      },
      async delete({ where }: any) {
        const idx = mem.tokens.findIndex((t) => t.id === where.id);
        if (idx >= 0) {
          const [deleted] = mem.tokens.splice(idx, 1);
          return deleted as any;
        }
        throw new Error('not found');
      },
      async update({ where, data }: any) {
        const rec = mem.tokens.find((t) => t.hash === where.hash);
        if (!rec) throw new Error('not found');
        if (data?.lastUsedAt) rec.lastUsedAt = data.lastUsedAt;
        return rec as any;
      },
    };
  }
  return { PrismaClient: PrismaClientMock };
});

// Import after mocking
import { registerApi } from './api.js';

async function createApp() {
  const app = express();
  app.use(cookieParser() as any);
  app.use(express.json() as any);
  app.use(express.urlencoded({ extended: true }) as any);
  await registerApi(app as any);
  return app;
}

const signSession = (userId: string) => {
  const secret = process.env.JWT_SECRET!;
  return jwt.sign({}, secret, { subject: userId });
};

describe('API Tokens & Controls', () => {
  beforeEach(() => {
    mem.tokens = [];
    // Minimal stub so /controls does not 500 "game server not available"
    (globalThis as any).gameServer = { matchMaker: { query: async () => [] } };
  });

  it('creates and lists API tokens for a session user', async () => {
    const app = await createApp();
    const jwtToken = signSession('user-1');

    const createRes = await request(app)
      .post('/api-tokens')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'My Token' });
    expect(createRes.status).toBe(200);
    expect(createRes.body.token).toBeTruthy();
    const tokenId = createRes.body.id as string;

    const listRes = await request(app)
      .get('/api-tokens')
      .set('Authorization', `Bearer ${jwtToken}`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.find((t: any) => t.id === tokenId)).toBeTruthy();
  });

  it('authenticates /controls with API token and updates lastUsedAt', async () => {
    const app = await createApp();
    const jwtToken = signSession('user-1');

    const createRes = await request(app)
      .post('/api-tokens')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'Remote' });
    const rawToken = createRes.body.token as string;

    const before = mem.tokens[0];
    expect(before.lastUsedAt).toBeFalsy();

    const ctrlRes = await request(app)
      .post('/controls')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ mic: false });
    // No user online -> 409, but authentication via token worked
    expect(ctrlRes.status).toBe(409);

    const after = mem.tokens[0];
    expect(after.lastUsedAt).toBeTruthy();
  });

  it('deletes token and prevents further use', async () => {
    const app = await createApp();
    const jwtToken = signSession('user-1');

    const createRes = await request(app)
      .post('/api-tokens')
      .set('Authorization', `Bearer ${jwtToken}`)
      .send({ name: 'To be deleted' });
    const tokenId = createRes.body.id as string;
    const rawToken = createRes.body.token as string;

    const delRes = await request(app)
      .delete(`/api-tokens/${tokenId}`)
      .set('Authorization', `Bearer ${jwtToken}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    const ctrlRes = await request(app)
      .post('/controls')
      .set('Authorization', `Bearer ${rawToken}`)
      .send({ dnd: true });
    // Token no longer valid -> unauthorized
    expect(ctrlRes.status).toBe(401);
  });
});


