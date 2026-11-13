import net from 'node:net';
import request from 'supertest';
import { createHttpFixture } from './httpFixture.js';
import { registerAuthRoutes } from '../../src/api/routes/auth.js';

// Use a separate process with the actual loader and delivery path and isolated boot configuration.
const port = await new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('Kein Testport'));
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(port);
process.env.SMTP_FROM = 'fixture-mail@example.test';
process.env.SMTP_SECURE = 'false';
process.env.SMTP_VERIFY_ON_BOOT = 'false';
process.env.SMTP_POOL = 'false';
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.RESEND_API_KEY;
process.env.PUBLIC_BASE_URL = 'https://app.example.test';
const fixture = createHttpFixture();
try {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  await fixture.prisma.user.update({ where: { id: caller.id }, data: { emailVerifiedAt: null } });
  const app = fixture.app();
  registerAuthRoutes(app, fixture.prisma);
  const res = await request(app)
    .post('/auth/verify/request')
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${caller.session}`)
    .send({});
  const body: unknown = res.body;
  const secret = !!body && typeof body === 'object' && ('token' in body || 'verifyUrl' in body);
  process.stdout.write(`VERIFICATION_DELIVERY_RESULT:${JSON.stringify({ status: res.status, secret })}\n`);
} finally {
  await fixture.close();
}
