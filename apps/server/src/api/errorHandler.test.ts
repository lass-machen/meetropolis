import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '../logger.js';
import { errorHandler } from './errorHandler.js';
import { AppError } from '../errors/AppError.js';

function buildApp() {
  const app = express();
  app.use('/raw', express.raw({ type: () => true, limit: '1kb' }));
  app.use(express.json({ limit: '1kb' }));
  app.post('/echo', (req, res) => {
    res.json({ ok: true, body: req.body });
  });
  app.post('/raw/echo', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/app-error', () => {
    throw AppError.forbidden('no');
  });
  app.get('/boom', () => {
    throw new Error('database exploded');
  });
  app.get('/http-5xx', () => {
    throw Object.assign(new Error('upstream'), { status: 502, expose: false });
  });
  app.get('/http-4xx-hidden', () => {
    throw Object.assign(new Error('secret detail'), { status: 400, expose: false });
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers a malformed JSON body with 400 INVALID_JSON and logs it as a warning', async () => {
    const res = await request(buildApp()).post('/echo').set('Content-Type', 'application/json').send('{"email":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(res.body.error.message).toBe('Malformed request body');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers an oversized JSON body with 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ v: 'a'.repeat(4096) }));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers an oversized raw body (the telemetry relay parser) with 413', async () => {
    const res = await request(buildApp())
      .post('/raw/echo')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(4096, 1));

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers an unsupported content encoding with 415', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_ENCODING');
  });

  it('does not echo the parser message, which can quote the body', async () => {
    const res = await request(buildApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"password":"hunter2"');

    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('keeps a well-formed body working', async () => {
    const res = await request(buildApp()).post('/echo').send({ a: 1 });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ a: 1 });
  });

  it('keeps AppError responses unchanged', async () => {
    const res = await request(buildApp()).get('/app-error');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('still reports an unexpected error as 500 at error level', async () => {
    const res = await request(buildApp()).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('treats an http error with a 5xx status as internal', async () => {
    const res = await request(buildApp()).get('/http-5xx');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('treats a 4xx http error that is not meant to be exposed as internal', async () => {
    const res = await request(buildApp()).get('/http-4xx-hidden');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
