/**
 * Tests for the desktop client-compatibility gate. Each test builds a bare
 * Express app with the real middleware in the chain, so we verify both the
 * 426 enforcement and the pass-through cases through HTTP.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { CLIENT_UPDATE_REQUIRED_CODE, MIN_ASSET_PROTOCOL_VERSION } from '@meetropolis/shared';
import { createOriginPolicy, type OriginPolicy } from './originPolicy.js';
import {
  CLIENT_UPDATE_REQUIRED_MESSAGE,
  createClientCompatibilityMiddleware,
  isMemberAssetsEnforced,
  MEMBER_ASSETS_ENFORCE_ENV_KEY,
} from './clientCompatibility.js';

const TEST_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://app.example.test'];

function makeApp(policy: OriginPolicy, isEnforced?: () => boolean): express.Application {
  const app = express();
  app.use(createClientCompatibilityMiddleware({ policy, isEnforced }));
  app.use((req, res) => {
    res.status(200).json({ ok: true, path: req.path });
  });
  return app;
}

afterEach(() => {
  delete process.env[MEMBER_ASSETS_ENFORCE_ENV_KEY];
});

describe('createClientCompatibilityMiddleware', () => {
  it('(a) enforced desktop origin without header answers 426 with code, message and no-store', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get('/world').set('Origin', 'tauri://localhost');

    expect(res.status).toBe(426);
    expect(res.body).toEqual({
      error: CLIENT_UPDATE_REQUIRED_MESSAGE,
      code: CLIENT_UPDATE_REQUIRED_CODE,
      minAssetProtocol: MIN_ASSET_PROTOCOL_VERSION,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('(b) enforced second desktop origin without header answers 426', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get('/world').set('Origin', 'http://tauri.localhost');

    expect(res.status).toBe(426);
    expect(res.body.code).toBe(CLIENT_UPDATE_REQUIRED_CODE);
  });

  it('(c) announced current protocol version passes through', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get('/world').set('Origin', 'tauri://localhost').set('X-Asset-Protocol', '1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, path: '/world' });
  });

  it.each(['0', 'abc', ''])('(d) announced version %p answers 426', async (announced) => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get('/world').set('Origin', 'tauri://localhost').set('X-Asset-Protocol', announced);

    expect(res.status).toBe(426);
    expect(res.body.code).toBe(CLIENT_UPDATE_REQUIRED_CODE);
  });

  it('(e) web origin without header passes through', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get('/world').set('Origin', 'https://app.example.test');

    expect(res.status).toBe(200);
  });

  it('(f) request without origin passes through', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get('/world');

    expect(res.status).toBe(200);
  });

  it('(g) desktop origin missing from the policy list passes through', async () => {
    const app = makeApp(createOriginPolicy(['https://app.example.test']), () => true);

    const res = await request(app).get('/world').set('Origin', 'tauri://localhost');

    expect(res.status).toBe(200);
  });

  it('(h) passes through when enforcement is off', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => false);

    const res = await request(app).get('/world').set('Origin', 'tauri://localhost');

    expect(res.status).toBe(200);
  });

  it('(i) OPTIONS passes through while enforced', async () => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).options('/world').set('Origin', 'tauri://localhost');

    expect(res.status).toBe(200);
  });

  it.each(['/desktop/x', '/healthz'])('(j) exempt path %p passes through while enforced', async (path) => {
    const app = makeApp(createOriginPolicy(TEST_ORIGINS), () => true);

    const res = await request(app).get(path).set('Origin', 'tauri://localhost');

    expect(res.status).toBe(200);
  });
});

describe('isMemberAssetsEnforced', () => {
  it("(k) only the exact value 'true' enforces", () => {
    expect(isMemberAssetsEnforced({ MEMBER_ASSETS_ENFORCE: 'true' })).toBe(true);
    expect(isMemberAssetsEnforced({ MEMBER_ASSETS_ENFORCE: 'TRUE' })).toBe(false);
    expect(isMemberAssetsEnforced({ MEMBER_ASSETS_ENFORCE: '1' })).toBe(false);
    expect(isMemberAssetsEnforced({})).toBe(false);
  });

  it('reads process.env by default', () => {
    process.env[MEMBER_ASSETS_ENFORCE_ENV_KEY] = 'true';
    expect(isMemberAssetsEnforced()).toBe(true);
  });
});
