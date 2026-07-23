/**
 * Regression test for the dynamic-API cache hardening: /public, /billing and
 * /admin responses must always carry `Cache-Control: no-cache` so browsers
 * revalidate via ETag instead of heuristically caching a stale response (the
 * bug this closes: a user kept seeing the old, empty pricing page after the
 * catalog had been populated). Routes outside those prefixes (e.g. /healthz,
 * /maps/*) must be unaffected, and a route handler further down the chain
 * must still be able to override the header.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';

import { dynamicApiCacheControl } from './dynamicCacheControl.js';

function makeApp(): express.Application {
  const app = express();
  app.use(dynamicApiCacheControl);

  app.get('/public/pricing-plans', (_req, res) => res.json({ plans: [] }));
  app.get('/billing/status', (_req, res) => res.json({ status: 'active' }));
  app.get('/admin/stats', (_req, res) => res.json({ users: 0 }));
  app.post('/billing/plans', (_req, res) => res.status(201).json({ ok: true }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/maps/123/chunks', (_req, res) => res.json({ chunks: {} }));

  // A route that legitimately wants a different directive must be able to
  // override the default set by the middleware.
  app.get('/public/asset-manifest', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ manifest: [] });
  });

  // Boundary check: a path that merely shares a prefix string (but not a
  // path segment) must not match, e.g. a hypothetical /administrator route.
  app.get('/administrator', (_req, res) => res.json({ ok: true }));

  return app;
}

describe('dynamicApiCacheControl', () => {
  it('sets Cache-Control: no-cache on /public/* GET responses', async () => {
    const res = await request(makeApp()).get('/public/pricing-plans');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('sets Cache-Control: no-cache on /billing/* GET responses', async () => {
    const res = await request(makeApp()).get('/billing/status');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('sets Cache-Control: no-cache on /admin/* GET responses', async () => {
    const res = await request(makeApp()).get('/admin/stats');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('applies defensively to non-GET methods on the affected prefixes', async () => {
    const res = await request(makeApp()).post('/billing/plans');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('does not set Cache-Control on unrelated routes', async () => {
    const res = await request(makeApp()).get('/healthz');
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('does not touch routes that only share a prefix string, not a path segment', async () => {
    const res = await request(makeApp()).get('/administrator');
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('leaves a differently-cached route (e.g. map data) alone', async () => {
    const res = await request(makeApp()).get('/maps/123/chunks');
    expect(res.headers['cache-control']).toBeUndefined();
  });

  it('allows a route handler to override the default directive', async () => {
    const res = await request(makeApp()).get('/public/asset-manifest');
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });
});
