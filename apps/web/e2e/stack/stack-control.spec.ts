import { test, expect } from '../fixtures';

test('@stack mailpit pause blocks and unpause restores the mail api', async ({
  request,
  stack,
  mailpit,
  stackControl,
}) => {
  const searchUrl = `${stack.mailpitUrl.replace(/\/+$/, '')}/api/v1/search?${new URLSearchParams({
    query: 'to:stack-control-probe@invalid.test',
  }).toString()}`;

  // Reachable through the existing mailpit fixture: the search answers, only the probe address has no mail.
  await expect(mailpit.waitForMail({ to: 'stack-control-probe@invalid.test', timeoutMs: 5_000 })).rejects.toThrow(
    /no message/,
  );

  await stackControl.pause('mailpit');
  await expect(request.get(searchUrl, { timeout: 5_000 })).rejects.toThrow();

  await stackControl.unpause('mailpit');
  const restored = await request.get(searchUrl, { timeout: 15_000 });
  expect(restored.ok()).toBe(true);
});
