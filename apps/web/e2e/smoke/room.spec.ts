import { test } from '../fixtures';
import { waitForParticipant } from '../fixtures/helpers';

test('seed users see each other in the same room @smoke', async ({ roomUsers }) => {
  const [owner, member] = await roomUsers(2, { tenant: 'seed' });
  if (!owner || !member) throw new Error('roomUsers hat nicht beide Teilnehmer erstellt.');

  await waitForParticipant(owner.page, member.user);
  await waitForParticipant(member.page, owner.user);
});
