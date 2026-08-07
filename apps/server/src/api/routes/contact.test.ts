/**
 * Tests for the public contact form.
 *
 * The point of the endpoint is that it is unauthenticated and sends mail, so
 * the cases that matter are the ones where it must NOT send: unsolved or
 * replayed proof-of-work, a filled honeypot, a submission that arrives faster
 * than a person could type, and anything that fails the schema. The happy path
 * is checked too, but it is the cheap half.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/pbkdf2';
import type { Challenge } from 'altcha-lib/types';

const HMAC_KEY = 'test-hmac-key-not-a-production-secret';

vi.hoisted(() => {
  process.env.CONTACT_FORM_TO = 'inbox@example.test';
  process.env.ALTCHA_HMAC_KEY = 'test-hmac-key-not-a-production-secret';
  // Keep the proof-of-work cheap so the suite stays fast; the cost parameter
  // is orthogonal to every property under test.
  process.env.ALTCHA_COST = '1';
  process.env.ALTCHA_MAX_COUNTER = '20';
  process.env.RATE_LIMIT_ENABLED = 'false';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

interface SentMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

const sendRaw = vi.fn((_params: SentMail) => Promise.resolve(true));

// The real loader resolves to null under NODE_ENV=test (see email/index.ts),
// which would make every submission fail delivery. Mocking the loader keeps
// the route's own logic under test and lets us assert on what it hands over.
vi.mock('../../emailLoader.js', () => ({
  sendIfAvailable: async (fn: (mod: { sendRaw: typeof sendRaw }) => Promise<boolean>) => fn({ sendRaw }),
}));

import { registerContactRoutes } from './contact.js';
import { errorHandler } from '../errorHandler.js';
import { __resetRedeemedChallengesForTesting } from '../utils/altchaChallenge.js';

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  registerContactRoutes(app);
  app.use(errorHandler);
  return app;
}

/** The parameters of the most recent `sendRaw` call. */
function lastMail(): SentMail {
  const call = sendRaw.mock.calls.at(-1);
  if (!call) throw new Error('expected a mail to have been sent');
  return call[0];
}

let app: express.Application;

beforeEach(() => {
  sendRaw.mockClear();
  __resetRedeemedChallengesForTesting();
  app = makeApp();
});

/** Fetch a challenge and solve it the way the browser client does. */
async function solvedPayload(): Promise<unknown> {
  const res = await request(app).get('/public/contact/challenge').expect(200);
  const challenge = res.body as Challenge;
  const solution = await solveChallenge({ challenge, deriveKey });
  if (!solution) throw new Error('challenge unsolvable in test');
  return { challenge, solution };
}

const validSubmission = {
  name: 'Erika Mustermann',
  email: 'erika@example.test',
  topic: 'sales' as const,
  message: 'Wir haben zwoelf Leute im Team und wuerden das gern ausprobieren.',
  privacyAccepted: true as const,
};

/**
 * Every submission in these tests would otherwise be rejected for arriving
 * too fast, so the minimum fill time is neutralised except where it is the
 * property under test.
 */
function withoutFillTimeGate(): void {
  process.env.CONTACT_FORM_MIN_FILL_MS = '0';
}

beforeEach(withoutFillTimeGate);

describe('POST /public/contact', () => {
  it('delivers a valid submission to the configured recipient', async () => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha })
      .expect(200);

    expect(sendRaw).toHaveBeenCalledTimes(1);
    const mail = lastMail();
    expect(mail.to).toBe('inbox@example.test');
    expect(mail.text).toContain('Wir haben zwoelf Leute im Team');
  });

  it('uses the sender address as Reply-To, never as the envelope sender', async () => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha })
      .expect(200);

    const mail = lastMail();
    expect(mail.replyTo).toBe('erika@example.test');
    expect(mail).not.toHaveProperty('from');
  });

  it('escapes sender-controlled content in the HTML body', async () => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({
        ...validSubmission,
        name: '<script>alert(1)</script>',
        message: 'Erste Zeile\n<img src=x onerror=alert(1)>',
        altcha,
      })
      .expect(200);

    const mail = lastMail();
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('strips CRLF from the subject so a name cannot inject a header', async () => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, name: 'Eve\r\nBcc: victim@example.test', altcha })
      .expect(200);

    const mail = lastMail();
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('rejects a submission whose proof-of-work was never solved', async () => {
    const res = await request(app).get('/public/contact/challenge').expect(200);
    const challenge = res.body as Challenge;

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha: { challenge, solution: { counter: 0, derivedKey: '00'.repeat(32) } } })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('rejects a solved challenge that is submitted a second time', async () => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha })
      .expect(200);
    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha })
      .expect(400);

    expect(sendRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects a challenge whose parameters were tampered with after signing', async () => {
    const res = await request(app).get('/public/contact/challenge').expect(200);
    const challenge = res.body as Challenge;
    const solution = await solveChallenge({ challenge, deriveKey });
    // Rewrite the advertised cost after the fact. The signature covers the
    // whole parameter set, so this must not verify — and the value has to
    // actually differ from the configured cost for the case to mean anything.
    const forged = { ...challenge, parameters: { ...challenge.parameters, cost: 999 } };

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha: { challenge: forged, solution } })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('rejects a filled honeypot', async () => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, website: 'https://spam.example', altcha })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('rejects a submission that arrives faster than a person could write it', async () => {
    process.env.CONTACT_FORM_MIN_FILL_MS = '60000';
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('rejects a submission without privacy consent', async () => {
    const altcha = await solvedPayload();
    const { privacyAccepted: _omitted, ...withoutConsent } = validSubmission;

    await request(app)
      .post('/public/contact')
      .send({ ...withoutConsent, altcha })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed address', { email: 'not-an-address' }],
    ['an empty name', { name: '' }],
    ['a message below the minimum length', { message: 'zu kurz' }],
    ['a message above the maximum length', { message: 'x'.repeat(5_001) }],
    ['an unknown topic', { topic: 'anything' }],
  ])('rejects %s', async (_label, override) => {
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, ...override, altcha })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });

  it('does not disclose which check rejected the submission', async () => {
    const altcha = await solvedPayload();
    const honeypot = await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, website: 'x', altcha });
    const badSchema = await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, email: 'nope', altcha: await solvedPayload() });

    expect(honeypot.body).toEqual(badSchema.body);
  });

  it('reports a delivery failure instead of claiming the message was sent', async () => {
    sendRaw.mockResolvedValueOnce(false);
    const altcha = await solvedPayload();

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha })
      .expect(502);
  });
});

describe('GET /public/contact/challenge', () => {
  it('issues a signed challenge that must not be cached', async () => {
    const res = await request(app).get('/public/contact/challenge').expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.body as Challenge).signature).toBeTruthy();
  });

  it('issues a different challenge every time', async () => {
    const first = await request(app).get('/public/contact/challenge').expect(200);
    const second = await request(app).get('/public/contact/challenge').expect(200);

    expect((first.body as Challenge).parameters.nonce).not.toBe((second.body as Challenge).parameters.nonce);
  });
});

describe('registerContactRoutes', () => {
  it('registers nothing when no recipient is configured', async () => {
    const previous = process.env.CONTACT_FORM_TO;
    delete process.env.CONTACT_FORM_TO;
    const bare = makeApp();
    process.env.CONTACT_FORM_TO = previous;

    await request(bare).get('/public/contact/challenge').expect(404);
    await request(bare).post('/public/contact').send(validSubmission).expect(404);
  });

  it('stays disabled when a recipient is set but the HMAC key is missing', async () => {
    const previous = process.env.ALTCHA_HMAC_KEY;
    delete process.env.ALTCHA_HMAC_KEY;
    const bare = makeApp();
    process.env.ALTCHA_HMAC_KEY = previous;

    await request(bare).post('/public/contact').send(validSubmission).expect(404);
    expect(sendRaw).not.toHaveBeenCalled();
  });
});

describe('challenge signing', () => {
  it('does not accept a challenge signed with a different key', async () => {
    const { createChallenge } = await import('altcha-lib');
    const foreign = await createChallenge({
      algorithm: 'PBKDF2/SHA-256',
      cost: 1,
      deriveKey,
      counter: 3,
      expiresAt: new Date(Date.now() + 60_000),
      hmacSignatureSecret: `${HMAC_KEY}-different`,
      hmacKeySignatureSecret: `${HMAC_KEY}-different`,
      data: { issuedAt: Date.now() },
    });
    const solution = await solveChallenge({ challenge: foreign, deriveKey });

    await request(app)
      .post('/public/contact')
      .send({ ...validSubmission, altcha: { challenge: foreign, solution } })
      .expect(400);

    expect(sendRaw).not.toHaveBeenCalled();
  });
});
