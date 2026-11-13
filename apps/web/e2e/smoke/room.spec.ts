import { test } from '../fixtures';
import { waitForParticipant } from '../fixtures/helpers';

test('seed users see each other in the same room @smoke', async ({ roomUsers }) => {
  const [admin, member] = await roomUsers(2, { tenant: 'seed' });
  if (!admin || !member) throw new Error('roomUsers did not create both participants.');

  await waitForParticipant(admin.page, member.user);
  await waitForParticipant(member.page, admin.user);
});
