import crypto from 'node:crypto';
import net from 'node:net';
import request from 'supertest';
import { createHttpFixture } from './httpFixture.js';
import { registerAuthRoutes } from '../../src/api/routes/auth.js';

const mode = process.argv[2];
delete process.env.RESEND_API_KEY;
delete process.env.SMTP_HOST;
delete process.env.SMTP_FROM;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
process.env.SMTP_POOL = 'false';
process.env.SMTP_VERIFY_ON_BOOT = 'false';
process.env.PUBLIC_BASE_URL = 'https://app.example.test';
if (mode === 'closed_smtp') {
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Kein Probe-Port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  process.env.SMTP_HOST = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  process.env.SMTP_FROM = 'fixture-mail@example.test';
  process.env.SMTP_SECURE = 'false';
}
const fixture = createHttpFixture();
try {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant, 'member', crypto.randomBytes(20).toString('hex'));
  const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  const app = fixture.app();
  registerAuthRoutes(app, fixture.prisma);
  const response = await request(app).post('/auth/forgot').send({ email: user.email });
  process.stdout.write(
    `PASSWORD_RESET_DELIVERY_RESULT:${JSON.stringify({ status: response.status, secret: 'token' in response.body || 'resetUrl' in response.body })}\n`,
  );
  // Allow the configured provider retries for the real local SMTP failure.
  if (mode === 'closed_smtp') await new Promise((resolve) => setTimeout(resolve, 4000));
  else await new Promise((resolve) => setTimeout(resolve, 100));
} finally {
  await fixture.close();
}
