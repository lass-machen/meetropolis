import { test, expect } from '../fixtures';

test('password reset mail includes its reset link @smoke', async ({ request, stack, seed, mailpit }) => {
  test.skip(stack.edition === 'ee', 'The enterprise mail module does not forward mail to Mailpit yet.');
  const tenant = seed.tenants.default;
  const member = tenant?.users.member;
  if (!member || member.email !== 'member@default.test') {
    throw new Error('OSS seed does not contain member@default.test.');
  }

  // POST /auth/forgot is registered at apps/server/src/api/routes/auth.ts:33-36;
  // the public { email } payload is validated in auth.password.ts:15-17, 27-30.
  const response = await request.post(`${stack.apiUrl.replace(/\/+$/, '')}/auth/forgot`, {
    data: { email: member.email },
  });
  expect(response.status()).toBe(200);

  // The seeded account already has verification and invitation mail in Mailpit.
  const message = await mailpit.waitForMail({
    to: member.email,
    linkPattern: /#\/reset\?token=/,
  });
  const resetLink = mailpit.extractLinks(message).find((link) => {
    try {
      return new URL(link).hash.startsWith('#/reset?token=');
    } catch {
      return false;
    }
  });
  expect(resetLink).toBeTruthy();
});
