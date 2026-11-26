import net from 'node:net';
import request from 'supertest';
import { createHttpFixture } from './httpFixture.js';
import { registerAdminPasswordResetRoutes } from '../../src/api/routes/admin.passwordReset.js';

delete process.env.RESEND_API_KEY;
delete process.env.SMTP_HOST;
delete process.env.SMTP_FROM;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
process.env.SMTP_POOL = 'false';
process.env.SMTP_VERIFY_ON_BOOT = 'false';
process.env.PUBLIC_BASE_URL = 'https://app.example.test';

const port = await new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      reject(new Error('No probe port'));
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = String(port);
process.env.SMTP_FROM = 'fixture-mail@example.test';
process.env.SMTP_SECURE = 'false';

const fixture = createHttpFixture();
try {
  const { tenant } = await fixture.tenant();
  const admin = await fixture.caller(tenant, 'admin');
  const target = await fixture.caller(tenant);
  const app = fixture.app();
  registerAdminPasswordResetRoutes(app, fixture.prisma);
  const response = await request(app)
    .post(`/admin/users/${target.id}/reset-token`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
  const body: unknown = response.body;
  const secret = !!body && typeof body === 'object' && ('token' in body || 'resetUrl' in body);
  const unused = await fixture.prisma.passwordReset.count({
    where: { userId: target.id, usedAt: null },
  });
  process.stdout.write(`ADMIN_RESET_DELIVERY_RESULT:${JSON.stringify({ status: response.status, secret, unused })}\n`);
  // Allow the configured provider retries for the real local SMTP failure.
  await new Promise((resolve) => setTimeout(resolve, 4000));
} finally {
  await fixture.close();
}
